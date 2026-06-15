import { nip44, generateSecretKey, getPublicKey, type Filter } from "nostr-tools";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import { SimplePool } from "nostr-tools";
import { signerManager } from "../signer/manager";
import { APP_RELAYS } from "../utils/common";
import {
  getStoredItem,
  setStoredItem,
  removeStoredItem,
  STORAGE_KEYS,
} from "../utils/persistence";
import type { NostrEvent } from "../types/metadata";

const METADATA_KIND = 34578;
const RELAYS = APP_RELAYS;

// In-memory cache — the decrypted key ONLY lives here, never in persistent storage.
let cachedConversationKey: Uint8Array | null = null;
let cachedPubkey: string | null = null;

// Clear the in-memory and localStorage caches when the user logs out.
signerManager.onChange((pubkey) => {
  if (!pubkey) {
    cachedConversationKey = null;
    cachedPubkey = null;
    void removeStoredItem(STORAGE_KEYS.DRIVE_KEY_CACHE);
  }
});

function getDriveKeyDTag(pubkey: string): string {
  return `0:${pubkey}`;
}

/**
 * Get the Drive Key conversation key, initialising a new keypair if needed.
 *
 * This is the single public entry-point consumed by fileIndex.ts.
 * At most ONE signer prompt is triggered per browser session — after that the
 * conversation key is served from the in-memory cache.
 */
export async function getDriveConversationKey(): Promise<Uint8Array> {
  const signer = await signerManager.getSigner();
  const pubkey = await signer.getPublicKey();

  // 1. Fast-path: in-memory cache for the current user.
  if (cachedConversationKey && cachedPubkey === pubkey) {
    return cachedConversationKey;
  }

  // 2. Try to restore from the locally-cached encrypted event payload.
  //    This avoids a relay round-trip on page reload — the signer decrypts
  //    the cached ciphertext instantly (if "always allow" is enabled).
  const cachedEncryptedContent = await getStoredItem<string | null>(
    STORAGE_KEYS.DRIVE_KEY_CACHE,
    null,
  );

  if (cachedEncryptedContent) {
    try {
      const conversationKey = await decryptDriveKeyPayload(
        cachedEncryptedContent,
        signer,
        pubkey,
      );
      cachedConversationKey = conversationKey;
      cachedPubkey = pubkey;
      console.log("[DriveKey] Restored from local cache");
      return conversationKey;
    } catch (e) {
      // Cache belongs to a different user or is corrupt — discard it.
      console.warn("[DriveKey] Cached payload unusable, fetching from relay", e);
      await removeStoredItem(STORAGE_KEYS.DRIVE_KEY_CACHE);
    }
  }

  // 3. Fetch the Drive Key event from relays.
  const event = await fetchDriveKeyEvent(pubkey);

  if (event) {
    try {
      const conversationKey = await decryptDriveKeyPayload(
        event.content,
        signer,
        pubkey,
      );
      cachedConversationKey = conversationKey;
      cachedPubkey = pubkey;
      // Persist the raw *encrypted* payload — NOT the decrypted key.
      await setStoredItem(STORAGE_KEYS.DRIVE_KEY_CACHE, event.content);
      console.log("[DriveKey] Fetched from relay and cached");
      return conversationKey;
    } catch (e) {
      console.error("[DriveKey] Failed to decrypt relay event", e);
    }
  }

  // 4. No Drive Key exists yet — generate, publish, and cache a new one.
  return initializeDriveKey(signer, pubkey);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function decryptDriveKeyPayload(
  encryptedContent: string,
  signer: Awaited<ReturnType<typeof signerManager.getSigner>>,
  pubkey: string,
): Promise<Uint8Array> {
  if (!signer.nip44Decrypt) {
    throw new Error("Signer does not support NIP-44 decryption");
  }

  const json = await signer.nip44Decrypt(pubkey, encryptedContent);
  const tags: string[][] = JSON.parse(json);
  const encKeyTag = tags.find((t) => t[0] === "encryptionKey");

  if (!encKeyTag?.[1]) {
    throw new Error("Drive Key payload missing encryptionKey tag");
  }

  const secretKey = hexToBytes(encKeyTag[1]);
  const drivePublicKey = getPublicKey(secretKey);
  return nip44.v2.utils.getConversationKey(secretKey, drivePublicKey);
}

async function fetchDriveKeyEvent(pubkey: string): Promise<NostrEvent | null> {
  const pool = new SimplePool();
  const dTag = getDriveKeyDTag(pubkey);

  return new Promise((resolve) => {
    let resolved = false;
    let found: NostrEvent | null = null;

    const filter: Filter = {
      kinds: [METADATA_KIND],
      authors: [pubkey],
      "#d": [dTag],
    };

    const sub = pool.subscribeMany(RELAYS, filter, {
      onevent(event) {
        if (!found || event.created_at > found.created_at) {
          found = event as unknown as NostrEvent;
        }
      },
      oneose() {
        if (!resolved) {
          resolved = true;
          sub.close();
          pool.close(RELAYS);
          resolve(found);
        }
      },
    });

    // Safety timeout — don't hang forever if relays are unresponsive.
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        sub.close();
        pool.close(RELAYS);
        resolve(found);
      }
    }, 5000);
  });
}

async function initializeDriveKey(
  signer: Awaited<ReturnType<typeof signerManager.getSigner>>,
  pubkey: string,
): Promise<Uint8Array> {
  if (!signer.nip44Encrypt) {
    throw new Error("Signer does not support NIP-44 encryption");
  }

  console.log("[DriveKey] Generating new Drive Key");

  // Generate a fresh secp256k1 keypair.
  const secretKey = generateSecretKey();
  const drivePublicKey = getPublicKey(secretKey);

  // Payload format matches the spec: array-of-tags.
  const payload = JSON.stringify([["encryptionKey", bytesToHex(secretKey)]]);

  // Encrypt the payload to the user themselves using their Main Identity Signer.
  const encryptedContent = await signer.nip44Encrypt(pubkey, payload);

  // Build and publish the Drive Key event.
  const event: NostrEvent = {
    kind: METADATA_KIND,
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["d", getDriveKeyDTag(pubkey)],
      ["client", "formstr-drive"],
    ],
    content: encryptedContent,
  };

  const signedEvent = await signer.signEvent(event);
  const pool = new SimplePool();

  try {
    const publishPromises = pool.publish(RELAYS, signedEvent);
    await Promise.any(publishPromises);
    console.log("[DriveKey] Published Drive Key event");
  } finally {
    pool.close(RELAYS);
  }

  // Cache the encrypted payload locally (never the naked key).
  await setStoredItem(STORAGE_KEYS.DRIVE_KEY_CACHE, encryptedContent);

  // Cache the conversation key in memory for the rest of this session.
  const conversationKey = nip44.v2.utils.getConversationKey(secretKey, drivePublicKey);
  cachedConversationKey = conversationKey;
  cachedPubkey = pubkey;

  return conversationKey;
}
