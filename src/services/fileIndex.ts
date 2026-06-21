import { SimplePool, nip44, type Filter } from "nostr-tools";
import type { FileMetadata, NostrEvent } from "../types/metadata";
import { signerManager } from "../signer/manager";
import { APP_RELAYS } from "../utils/common";
import { getDriveConversationKey } from "./driveKey";

const METADATA_KIND = 34578;
const CLIENT_TAG = "formstr-drive";

const RELAYS = APP_RELAYS;

async function getSigner() {
  return signerManager.getSigner();
}

async function encryptMetadata(metadata: FileMetadata): Promise<string> {
  const conversationKey = await getDriveConversationKey();
  const json = JSON.stringify(metadata);
  return nip44.v2.encrypt(json, conversationKey);
}

/**
 * Decrypt metadata encrypted with the Drive Key (new format, tagged "t":"files").
 */
function decryptMetadataWithDriveKey(
  ciphertext: string,
  conversationKey: Uint8Array,
): FileMetadata {
  const json = nip44.v2.decrypt(ciphertext, conversationKey);
  return JSON.parse(json);
}

/**
 * Legacy fallback: decrypt metadata encrypted directly to the Main Identity Key.
 * Used for events that do NOT carry the ["t", "files"] tag.
 */
async function decryptMetadataLegacy(ciphertext: string): Promise<FileMetadata> {
  const signer = await getSigner();
  if (!signer.nip44Decrypt) {
    throw new Error("Signer does not support NIP-44 decryption");
  }

  const pubkey = await signer.getPublicKey();
  const json = await signer.nip44Decrypt(pubkey, ciphertext);
  return JSON.parse(json);
}

export async function fetchFileIndex(
  pubkey: string,
  onLegacyFilesFound?: (files: FileMetadata[]) => void
): Promise<FileMetadata[]> {
  console.log("[FileIndex] Starting fetch from relays:", RELAYS);
  console.log("[FileIndex] User pubkey:", pubkey);

  // Proactively fetch / initialise the Drive Key before the relay timer starts.
  // If this fails (e.g. signer unavailable), we fall back to legacy decryption
  // for every event — exactly the same behaviour as before this change.
  let driveConversationKey: Uint8Array | null = null;
  try {
    driveConversationKey = await getDriveConversationKey();
    console.log("[FileIndex] Drive Key ready");
  } catch (e) {
    console.warn("[FileIndex] Could not obtain Drive Key, using legacy decryption", e);
  }

  const pool = new SimplePool();

  return new Promise((resolve) => {
    const filter: Filter = {
      kinds: [METADATA_KIND],
      authors: [pubkey],
    };
    console.log("[FileIndex] Query filter:", JSON.stringify(filter));
    console.log("[FileIndex] Filter as array:", JSON.stringify([filter]));

    const events: NostrEvent[] = [];
    const seenIds = new Set<string>();

    // Subscribe to relays
    const sub = pool.subscribeMany(RELAYS, filter, {
        onevent(event) {
          if (!seenIds.has(event.id)) {
            console.log("[FileIndex] Received event:", event.id);
            seenIds.add(event.id);
            events.push(event);
          }
        },
        oneose() {
          console.log("[FileIndex] EOSE received from relay");
        },
        onclose(reasons) {
          console.log("[FileIndex] Subscription closed:", reasons);
        },
      }
    );

    // Wait 10 seconds for events to come in, then process
    setTimeout(async () => {
      console.log(`[FileIndex] Timeout reached, processing ${events.length} events`);
      sub.close();
      pool.close(RELAYS);

      const files: FileMetadata[] = [];
      const legacyFilesToMigrate: FileMetadata[] = [];
      const seenHashes = new Set<string>();

      // Sort by created_at descending to get latest versions first
      events.sort((a, b) => b.created_at - a.created_at);

      for (const event of events) {
        console.log("[FileIndex] Processing event:", event.id, "tags:", event.tags);
        const dTag = event.tags.find((t: string[]) => t[0] === "d");
        const hash = dTag?.[1];

        if (!hash) {
          console.warn("[FileIndex] Event missing d tag:", event.id);
          continue;
        }

        // Skip the Drive Key event itself — it's not a file.
        if (hash.startsWith("0:")) {
          console.log("[FileIndex] Skipping Drive Key event:", event.id);
          continue;
        }

        if (seenHashes.has(hash)) {
          console.log("[FileIndex] Skipping duplicate hash:", hash);
          continue;
        }

        seenHashes.add(hash);

        try {
          const hasFilesTag = event.tags.some(
            (t: string[]) => t[0] === "t" && t[1] === "files",
          );

          let metadata: FileMetadata;
          if (hasFilesTag && driveConversationKey) {
            // New format: decrypt natively with the Drive Key (instant, no popup).
            metadata = decryptMetadataWithDriveKey(event.content, driveConversationKey);
          } else {
            // Legacy format: fall back to the Main Identity Signer.
            metadata = await decryptMetadataLegacy(event.content);
            if (driveConversationKey && !metadata.deleted) {
              legacyFilesToMigrate.push(metadata);
            }
          }

          console.log("[FileIndex] Decrypted metadata:", metadata);
          if (!metadata.deleted) {
            files.push(metadata);
          } else {
            console.log("[FileIndex] Skipping deleted file:", metadata.name);
          }
        } catch (e) {
          console.debug("[FileIndex] Skipping incompatible event:", event.id, e);
        }
      }

      console.log(`[FileIndex] Successfully loaded ${files.length} files`);
      resolve(files);

      // Trigger callback for any legacy files encountered
      if (legacyFilesToMigrate.length > 0 && onLegacyFilesFound) {
        onLegacyFilesFound(legacyFilesToMigrate);
      }
    }, 10000); // 10 second timeout
  });
}

export async function autoMigrateLegacyFiles(files: FileMetadata[]) {
  console.log(`[FileIndex] Auto-migrating ${files.length} legacy files to Drive Key format...`);
  for (const file of files) {
    try {
      // Re-saving encrypts with Drive Key and updates the relay event (replacing the legacy one)
      await saveFileMetadata(file);
      console.log(`[FileIndex] Auto-migrated: ${file.name}`);
    } catch (e) {
      console.error(`[FileIndex] Failed to auto-migrate file: ${file.name}`, e);
    }
  }
}

export async function saveFileMetadata(metadata: FileMetadata): Promise<void> {
  console.log("[FileIndex] Saving metadata:", metadata);
  const signer = await getSigner();
  const pubkey = await signer.getPublicKey();
  const pool = new SimplePool();

  try {
    const encrypted = await encryptMetadata(metadata);
    console.log("[FileIndex] Encrypted metadata length:", encrypted.length);

    const event: NostrEvent = {
      kind: METADATA_KIND,
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["d", metadata.hash],
        ["t", "files"],
        ["client", CLIENT_TAG],
        ["encrypted", "nip44"],
      ],
      content: encrypted,
    };

    console.log("[FileIndex] Event to publish:", event);
    const signedEvent = await signer.signEvent(event);
    console.log("[FileIndex] Signed event:", signedEvent);

    const publishPromises = pool.publish(RELAYS, signedEvent);
    console.log("[FileIndex] Publishing to relays:", RELAYS);

    await Promise.any(publishPromises);
    console.log("[FileIndex] Successfully published to at least one relay");
  } catch (e) {
    console.error("[FileIndex] Failed to save metadata:", e);
    throw e;
  } finally {
    pool.close(RELAYS);
  }
}

export async function deleteFileMetadata(_hash: string, currentMetadata: FileMetadata): Promise<void> {
  const deletedMetadata: FileMetadata = {
    ...currentMetadata,
    deleted: true,
  };
  await saveFileMetadata(deletedMetadata);
}

export async function updateFileMetadata(
  hash: string,
  updates: Partial<Pick<FileMetadata, "name" | "folder">>
): Promise<void> {
  const signer = await getSigner();
  const pubkey = await signer.getPublicKey();
  const files = await fetchFileIndex(pubkey);
  const existing = files.find((f) => f.hash === hash);

  if (!existing) {
    throw new Error("File not found");
  }

  const updated: FileMetadata = {
    ...existing,
    ...updates,
  };

  await saveFileMetadata(updated);
}

export function extractFolders(files: FileMetadata[]): string[] {
  const folders = new Set<string>();
  folders.add("/");

  for (const file of files) {
    const parts = file.folder.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current += "/" + part;
      folders.add(current);
    }
  }

  return Array.from(folders).sort();
}
