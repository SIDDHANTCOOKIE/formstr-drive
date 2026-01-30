import { SimplePool } from "nostr-tools";
import type { FileMetadata, NostrEvent } from "../types/metadata";

const METADATA_KIND = 30078;
const CLIENT_TAG = "formstr-drive";

const RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.nostr.band",
  "wss://nos.lol",
];

async function getNostr() {
  if (!window.nostr) throw new Error("Nostr signer not found");
  return window.nostr;
}

async function encryptMetadata(metadata: FileMetadata): Promise<string> {
  const nostr = await getNostr();
  const pubkey = await nostr.getPublicKey();
  const json = JSON.stringify(metadata);
  return nostr.nip44.encrypt(pubkey, json);
}

async function decryptMetadata(ciphertext: string): Promise<FileMetadata> {
  const nostr = await getNostr();
  const pubkey = await nostr.getPublicKey();
  const json = await (nostr.nip44.decrypt as any)(pubkey, ciphertext);
  return JSON.parse(json);
}

export async function fetchFileIndex(): Promise<FileMetadata[]> {
  const nostr = await getNostr();
  const pubkey = await nostr.getPublicKey();
  const pool = new SimplePool();

  try {
    const events = await pool.querySync(RELAYS, {
      kinds: [METADATA_KIND],
      authors: [pubkey],
      "#client": [CLIENT_TAG],
    });

    const files: FileMetadata[] = [];
    const seenHashes = new Set<string>();

    // Sort by created_at descending to get latest versions first
    events.sort((a, b) => b.created_at - a.created_at);

    for (const event of events) {
      const dTag = event.tags.find((t) => t[0] === "d");
      const hash = dTag?.[1];

      if (!hash || seenHashes.has(hash)) continue;
      seenHashes.add(hash);

      try {
        const metadata = await decryptMetadata(event.content);
        if (!metadata.deleted) {
          files.push(metadata);
        }
      } catch (e) {
        console.error("Failed to decrypt metadata:", e);
      }
    }

    return files;
  } finally {
    pool.close(RELAYS);
  }
}

export async function saveFileMetadata(metadata: FileMetadata): Promise<void> {
  const nostr = await getNostr();
  const pubkey = await nostr.getPublicKey();
  const pool = new SimplePool();

  try {
    const encrypted = await encryptMetadata(metadata);

    const event: NostrEvent = {
      kind: METADATA_KIND,
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["d", metadata.hash],
        ["client", CLIENT_TAG],
        ["encrypted", "nip44"],
      ],
      content: encrypted,
    };

    const signedEvent = await nostr.signEvent(event as object);
    await Promise.any(pool.publish(RELAYS, signedEvent as any));
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
  const files = await fetchFileIndex();
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
