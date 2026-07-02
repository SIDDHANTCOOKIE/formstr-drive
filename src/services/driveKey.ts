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

// A single decrypted Drive Key: the secp256k1 secret plus its derived
// conversation key (used directly by NIP-44 v2). Keeping the secret hex lets us
// re-encrypt with it when saving new file metadata.
interface DriveKeyEntry {
  secretKeyHex: string;
  conversationKey: Uint8Array;
}

// In-memory cache — the decrypted keys ONLY live here, never in persistent storage.
let cachedKeyring: DriveKeyEntry[] | null = null;
let cachedPubkey: string | null = null;

// The hex of the newest Drive Key secret — used when encrypting new file
// metadata so that all new uploads share a single, consistent key.
let activeSecretKeyHex: string | null = null;

// Clear the in-memory and localStorage caches when the user logs out.
signerManager.onChange((pubkey) => {
  if (!pubkey) {
    cachedKeyring = null;
    cachedPubkey = null;
    activeSecretKeyHex = null;
    void removeStoredItem(STORAGE_KEYS.DRIVE_KEY_CACHE);
  }
});

function getDriveKeyDTag(pubkey: string): string {
  return `0:${pubkey}`;
}

function buildConversationKey(secretKeyHex: string): Uint8Array {
  const secretKey = hexToBytes(secretKeyHex);
  const drivePublicKey = getPublicKey(secretKey);
  return nip44.v2.utils.getConversationKey(secretKey, drivePublicKey);
}

/**
 * Decrypt a single Drive Key payload (array-of-tags form) into its secret hex.
 * Returns null if the payload is malformed or can't be decrypted.
 */
async function decryptDriveKeyPayload(
  encryptedContent: string,
  signer: Awaited<ReturnType<typeof signerManager.getSigner>>,
  pubkey: string,
): Promise<string | null> {
  if (!signer.nip44Decrypt) {
    throw new Error("Signer does not support NIP-44 decryption");
  }

  const json = await signer.nip44Decrypt(pubkey, encryptedContent);

  let tags: unknown;
  try {
    tags = JSON.parse(json);
  } catch {
    return null;
  }

  if (!Array.isArray(tags)) {
    return null;
  }

  const encKeyTag = tags.find(
    (t): t is string[] =>
      Array.isArray(t) && t.length >= 2 && t[0] === "encryptionKey",
  );

  if (!encKeyTag?.[1]) {
    return null;
  }

  // Validate it looks like a 32-byte hex secret before trusting it.
  const secretKeyHex = encKeyTag[1];
  if (!/^[0-9a-fA-F]{64}$/.test(secretKeyHex)) {
    return null;
  }

  return secretKeyHex;
}

/**
 * Collect every Drive Key event for the user across all relays.
 *
 * Drive Keys are immutable per-identity events (d = "0:<pubkey>"), but a device
 * that loses the relay race will publish a brand-new random key, forking the
 * keyring. Because each historical key may still unlock files encrypted under
 * it, we keep ALL of them — newest first.
 */
async function fetchDriveKeyEvents(pubkey: string): Promise<NostrEvent[]> {
  const pool = new SimplePool();

  return new Promise((resolve) => {
    let resolved = false;
    const found = new Map<string, NostrEvent>();

    const filter: Filter = {
      kinds: [METADATA_KIND],
      authors: [pubkey],
      "#d": [getDriveKeyDTag(pubkey)],
    };

    const sub = pool.subscribeMany(RELAYS, filter, {
      onevent(event) {
        // Keep the newest version of each unique event id.
        if (!found.has(event.id)) {
          found.set(event.id, event as unknown as NostrEvent);
        }
      },
      oneose() {
        if (!resolved) {
          resolved = true;
          sub.close();
          pool.close(RELAYS);
          resolve(sortNewestFirst([...found.values()]));
        }
      },
    });

    // Safety timeout — give flaky mobile relays a generous window instead of
    // giving up so fast that we mint a duplicate key (the original fork cause).
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        sub.close();
        pool.close(RELAYS);
        resolve(sortNewestFirst([...found.values()]));
      }
    }, 8000);
  });
}

function sortNewestFirst(events: NostrEvent[]): NostrEvent[] {
  return [...events].sort((a, b) => b.created_at - a.created_at);
}

/**
 * Build the full Drive Key keyring for the current user.
 *
 * This fetches every Drive Key event the user has ever published and decrypts
 * each one. Any of them may unlock older files, so the caller should try every
 * key when decrypting file metadata. Returns an empty array only if the signer
 * cannot decrypt anything at all.
 */
export async function getDriveKeyring(): Promise<DriveKeyEntry[]> {
  // 1. Fast-path: in-memory cache for the current user.
  if (cachedKeyring && cachedPubkey) {
    return cachedKeyring;
  }

  const signer = await signerManager.getSigner();
  const pubkey = await signer.getPublicKey();

  const keyring: DriveKeyEntry[] = [];
  const seenSecrets = new Set<string>();

  // Helper that decrypts an encrypted payload and dedupes by secret.
  const tryAdd = async (encryptedContent: string) => {
    try {
      const secretKeyHex = await decryptDriveKeyPayload(
        encryptedContent,
        signer,
        pubkey,
      );
      if (secretKeyHex && !seenSecrets.has(secretKeyHex)) {
        seenSecrets.add(secretKeyHex);
        keyring.push({
          secretKeyHex,
          conversationKey: buildConversationKey(secretKeyHex),
        });
      }
    } catch (e) {
      console.warn("[DriveKey] Failed to decrypt a Drive Key payload", e);
    }
  };

  // 2. Restore from the locally-cached encrypted payloads (avoids a relay round
  //    trip on reload). The cache may hold several historic payloads.
  const cachedContents = await getStoredItem<string[] | null>(
    STORAGE_KEYS.DRIVE_KEY_CACHE,
    null,
  );
  if (Array.isArray(cachedContents)) {
    for (const content of cachedContents) {
      if (typeof content === "string") {
        await tryAdd(content);
      }
    }
    if (keyring.length > 0) {
      console.log(`[DriveKey] Restored ${keyring.length} key(s) from local cache`);
    }
  }

  // 3. Fetch every Drive Key event from relays. This both picks up keys we don't
  //    have cached locally and reconciles forks across devices.
  const events = await fetchDriveKeyEvents(pubkey);
  for (const event of events) {
    await tryAdd(event.content);
  }

  // 4. If no key exists anywhere, generate one. This is the only time we ever
  //    create a key, and we only do it after genuinely finding nothing across
  //    the cache AND all relays — so forks can't happen from a lost race.
  if (keyring.length === 0) {
    const confirmMessage =
      "Drive key not found in relays. Do you want to create a new key?\n\nWARNING: If you were using drive before and are creating a new key, all data encrypted using the old key may be lost.";
    if (window.confirm(confirmMessage)) {
      const newEntry = await initializeDriveKey(signer, pubkey);
      keyring.push(newEntry);
    } else {
      throw new Error("User cancelled drive key creation.");
    }
  }

  // Default active key: the first in the keyring. `events` is newest-first and
  // we decrypt in that order, so this is the most recently published key — the
  // one new uploads should continue to use to avoid forking again.
  activeSecretKeyHex = keyring[0]?.secretKeyHex ?? null;

  cachedKeyring = keyring;
  cachedPubkey = pubkey;

  // Persist the raw *encrypted* payloads (from relays) so the next cold start
  // can rebuild the keyring without hitting the network.
  const encryptedPayloads = events.map((e) => e.content);
  if (encryptedPayloads.length > 0) {
    const existingCache = await getStoredItem<string[] | null>(STORAGE_KEYS.DRIVE_KEY_CACHE, null) || [];
    const merged = Array.from(new Set([...existingCache, ...encryptedPayloads]));
    await setStoredItem(STORAGE_KEYS.DRIVE_KEY_CACHE, merged);
  }

  console.log(`[DriveKey] Keyring ready with ${keyring.length} key(s)`);
  return keyring;
}

/**
 * The conversation keys for every Drive Key. Try each one when decrypting file
 * metadata until the NIP-44 MAC validates.
 */
export async function getDriveConversationKeys(): Promise<Uint8Array[]> {
  const keyring = await getDriveKeyring();
  return keyring.map((entry) => entry.conversationKey);
}

/**
 * The conversation key for the *active* (newest) Drive Key — used to encrypt
 * new file metadata so all fresh uploads share one consistent key.
 */
export async function getDriveConversationKey(): Promise<Uint8Array> {
  const keyring = await getDriveKeyring();
  if (keyring.length === 0) {
    throw new Error("No Drive Key available");
  }

  // Reuse the cached active secret if present; otherwise default to the first.
  const activeSecret =
    activeSecretKeyHex && keyring.some((k) => k.secretKeyHex === activeSecretKeyHex)
      ? activeSecretKeyHex
      : keyring[0]!.secretKeyHex;
  activeSecretKeyHex = activeSecret;

  const active = keyring.find((k) => k.secretKeyHex === activeSecret);
  if (!active) {
    throw new Error("No Drive Key available");
  }
  return active.conversationKey;
}

/**
 * The active Drive Key's secret, as raw hex. Needed by fileIndex.ts so it can
 * re-encrypt metadata with the same key during migration/edits.
 */
export async function getActiveDriveKeySecret(): Promise<string> {
  const keyring = await getDriveKeyring();
  if (keyring.length === 0) {
    throw new Error("No Drive Key available");
  }

  const activeSecret =
    activeSecretKeyHex && keyring.some((k) => k.secretKeyHex === activeSecretKeyHex)
      ? activeSecretKeyHex
      : keyring[0]!.secretKeyHex;
  activeSecretKeyHex = activeSecret;
  return activeSecret;
}

async function initializeDriveKey(
  signer: Awaited<ReturnType<typeof signerManager.getSigner>>,
  pubkey: string,
): Promise<DriveKeyEntry> {
  if (!signer.nip44Encrypt) {
    throw new Error("Signer does not support NIP-44 encryption");
  }

  console.log("[DriveKey] Generating new Drive Key");

  // Generate a fresh secp256k1 keypair.
  const secretKey = generateSecretKey();
  const secretKeyHex = bytesToHex(secretKey);

  // Payload format matches the spec: array-of-tags.
  const payload = JSON.stringify([["encryptionKey", secretKeyHex]]);

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

  activeSecretKeyHex = secretKeyHex;
  
  // Immediately cache this newly created key so it's available on next cold start
  // even if the relays were slow or the app was closed before a fetch could complete.
  try {
    const existingCache = await getStoredItem<string[] | null>(STORAGE_KEYS.DRIVE_KEY_CACHE, null) || [];
    const newCache = Array.from(new Set([...existingCache, encryptedContent]));
    await setStoredItem(STORAGE_KEYS.DRIVE_KEY_CACHE, newCache);
  } catch (e) {
    console.warn("[DriveKey] Failed to cache newly created key locally", e);
  }

  return {
    secretKeyHex,
    conversationKey: buildConversationKey(secretKeyHex),
  };
}
