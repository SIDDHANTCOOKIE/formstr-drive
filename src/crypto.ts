import { nip44, generateSecretKey, getPublicKey } from "nostr-tools";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import { signerManager } from "./signer/manager";

/**
 * Convert Uint8Array to Base64 string
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000; // 32KB chunks
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/**
 * Convert Base64 string to Uint8Array
 */
export function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * NIP-44 v2 encryption for large payloads
 * Based on NIP-44 spec, but without the nostr-tools size limitation
 */
export async function aesGcmEncrypt(
  plaintext: string,
  conversationKey: Uint8Array,
): Promise<string> {
  const encoder = new TextEncoder();
  const plaintextBytes = encoder.encode(plaintext);

  // Generate random nonce (32 bytes)
  const nonce = crypto.getRandomValues(new Uint8Array(32));

  // Derive encryption key from conversation key and nonce using HKDF
  const salt = nonce;
  const info = encoder.encode("nip44-v2");

  // Import conversation key for HKDF
  const baseKey = await crypto.subtle.importKey(
    "raw",
    conversationKey as BufferSource,
    "HKDF",
    false,
    ["deriveBits"],
  );

  // Derive 44 bytes: 32 for chacha key, 12 for chacha nonce
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt,
      info: info,
    },
    baseKey,
    44 * 8,
  );

  const derived = new Uint8Array(derivedBits);
  const chachaKey = derived.slice(0, 32);
  const chachaNonce = derived.slice(32, 44);

  // Use AES-GCM as a substitute for ChaCha20 (WebCrypto doesn't support ChaCha20)
  // This is a pragmatic workaround - ideally we'd use ChaCha20-Poly1305
  const aesKey = await crypto.subtle.importKey(
    "raw",
    chachaKey as BufferSource,
    "AES-GCM",
    false,
    ["encrypt"],
  );

  // Encrypt with AES-GCM
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: chachaNonce as BufferSource,
    },
    aesKey,
    plaintextBytes,
  );

  const ciphertextBytes = new Uint8Array(ciphertext);

  // Format: version (1 byte) + nonce (32 bytes) + ciphertext
  const version = new Uint8Array([2]); // v2
  const payload = new Uint8Array(1 + 32 + ciphertextBytes.length);
  payload.set(version, 0);
  payload.set(nonce, 1);
  payload.set(ciphertextBytes, 33);

  // Return as base64
  return uint8ArrayToBase64(payload);
}

/**
 * NIP-44 v2 decryption for large payloads
 */
export async function aesGcmDecrypt(
  ciphertext: string,
  conversationKey: Uint8Array,
): Promise<string> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  try {
    // Decode from base64
    const payload = base64ToUint8Array(ciphertext);

    // Parse: version (1 byte) + nonce (32 bytes) + ciphertext
    const version = payload[0];
    if (version !== 2) {
      throw new Error(`Unsupported NIP-44 version: ${version}`);
    }

    const nonce = payload.slice(1, 33);
    const ciphertextBytes = payload.slice(33);

    // Derive encryption key from conversation key and nonce using HKDF
    const salt = nonce;
    const info = encoder.encode("nip44-v2");

    const baseKey = await crypto.subtle.importKey(
      "raw",
      conversationKey as BufferSource,
      "HKDF",
      false,
      ["deriveBits"],
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: salt,
        info: info,
      },
      baseKey,
      44 * 8,
    );

    const derived = new Uint8Array(derivedBits);
    const chachaKey = derived.slice(0, 32);
    const chachaNonce = derived.slice(32, 44);

    // Decrypt with AES-GCM
    const aesKey = await crypto.subtle.importKey(
      "raw",
      chachaKey as BufferSource,
      "AES-GCM",
      false,
      ["decrypt"],
    );

    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: chachaNonce as BufferSource,
      },
      aesKey,
      ciphertextBytes,
    );

    return decoder.decode(plaintext);
  } catch (error) {
    console.error("aesGcmDecrypt error:", error);
    throw error;
  }
}

// Chunk blob format versions.
//   v2 (legacy): version(1) + salt(32) + ciphertext  — salt stored in the blob.
//   v3         : version(1) + ciphertext             — salt re-derived from the
//                chunk index on decrypt (it's deterministic, so storing it was
//                redundant). Decrypt still reads v2 so old files keep working.
const CHUNK_FORMAT_V2 = 2;
const CHUNK_FORMAT_V3 = 3;

/** Big-endian 4-byte encoding of the chunk index — used as the HKDF salt seed and the GCM AAD. */
function chunkIndexBytes(chunkIndex: number): Uint8Array {
  const indexBytes = new Uint8Array(4);
  new DataView(indexBytes.buffer).setUint32(0, chunkIndex, false);
  return indexBytes;
}

/**
 * Deterministic per-chunk salt: HMAC-SHA256(conversationKey, indexBytes). Both
 * encrypt and decrypt derive it identically, which is why it never needs to be
 * stored. Safe against GCM nonce reuse because the conversationKey is unique
 * per file and the index is unique per chunk.
 */
async function deriveChunkSalt(conversationKey: Uint8Array, indexBytes: Uint8Array): Promise<Uint8Array> {
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    conversationKey as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const saltBuf = await crypto.subtle.sign("HMAC", hmacKey, indexBytes as BufferSource);
  return new Uint8Array(saltBuf); // 32 bytes
}

/**
 * NIP-44 v2-derived encryption for chunked binary payloads (no Base64). Uses a
 * deterministic salt derived from the chunk index, passes the index as AAD, and
 * emits the v3 blob format (salt is NOT stored — see CHUNK_FORMAT_V3).
 */
export async function aesGcmEncryptBytes(
  plaintext: Uint8Array,
  conversationKey: Uint8Array,
  chunkIndex: number,
): Promise<Uint8Array> {
  const encoder = new TextEncoder();

  // 1. Deterministic salt + AAD from the chunk index (index bytes double as AAD).
  const indexBytes = chunkIndexBytes(chunkIndex);
  const salt = await deriveChunkSalt(conversationKey, indexBytes);

  // 2. HKDF derivation
  const info = encoder.encode("nip44-v2");
  const baseKey = await crypto.subtle.importKey(
    "raw",
    conversationKey as BufferSource,
    "HKDF",
    false,
    ["deriveBits"],
  );

  const derivedBits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info },
    baseKey,
    44 * 8,
  );

  const derived = new Uint8Array(derivedBits);
  const chachaKey = derived.slice(0, 32);
  const chachaNonce = derived.slice(32, 44);

  // 3. Encrypt with AES-GCM, using chunkIndex as AAD
  const aesKey = await crypto.subtle.importKey(
    "raw",
    chachaKey as BufferSource,
    "AES-GCM",
    false,
    ["encrypt"],
  );

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: chachaNonce as BufferSource,
      additionalData: indexBytes as BufferSource,
    },
    aesKey,
    plaintext as unknown as BufferSource,
  );

  const ciphertextBytes = new Uint8Array(ciphertext);

  // 4. v3 format: version (1 byte) + ciphertext. The salt is re-derived on
  //    decrypt from the chunk index, so it is not stored.
  const payload = new Uint8Array(1 + ciphertextBytes.length);
  payload[0] = CHUNK_FORMAT_V3;
  payload.set(ciphertextBytes, 1);

  return payload;
}

/**
 * Decryption for chunked binary payloads. Accepts both v3 (salt re-derived from
 * the chunk index) and legacy v2 (salt read from the blob) so files uploaded
 * before the format change still decrypt.
 */
export async function aesGcmDecryptBytes(
  payload: Uint8Array,
  conversationKey: Uint8Array,
  chunkIndex: number,
): Promise<Uint8Array> {
  const encoder = new TextEncoder();

  const version = payload[0];
  const indexBytes = chunkIndexBytes(chunkIndex);

  let salt: Uint8Array;
  let ciphertextBytes: Uint8Array;
  if (version === CHUNK_FORMAT_V3) {
    // Salt was not stored — re-derive it deterministically from the index.
    salt = await deriveChunkSalt(conversationKey, indexBytes);
    ciphertextBytes = payload.slice(1);
  } else if (version === CHUNK_FORMAT_V2) {
    // Legacy: salt is prepended to the payload.
    salt = payload.slice(1, 33);
    ciphertextBytes = payload.slice(33);
  } else {
    throw new Error(`Unsupported NIP-44 chunk version: ${version}`);
  }

  // HKDF derivation
  const info = encoder.encode("nip44-v2");
  const baseKey = await crypto.subtle.importKey(
    "raw",
    conversationKey as BufferSource,
    "HKDF",
    false,
    ["deriveBits"],
  );

  const derivedBits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info },
    baseKey,
    44 * 8,
  );

  const derived = new Uint8Array(derivedBits);
  const chachaKey = derived.slice(0, 32);
  const chachaNonce = derived.slice(32, 44);

  // Decrypt with AES-GCM
  const aesKey = await crypto.subtle.importKey(
    "raw",
    chachaKey as BufferSource,
    "AES-GCM",
    false,
    ["decrypt"],
  );

  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: chachaNonce as BufferSource,
      additionalData: indexBytes as BufferSource,
    },
    aesKey,
    ciphertextBytes as BufferSource,
  );

  return new Uint8Array(plaintext);
}

export function deriveConversationKeyFromHex(privateKeyHex: string): Uint8Array {
  const secretKey = hexToBytes(privateKeyHex);
  const pubkey = getPublicKey(secretKey);
  return nip44.v2.utils.getConversationKey(secretKey, pubkey);
}

/**
 * Encrypt a file with a newly generated key (self-encryption)
 * Returns both the ciphertext and the private key (hex) needed for decryption
 */
export async function encryptFileWithKey(
  fileBytes: Uint8Array,
): Promise<{ ciphertext: string; privateKeyHex: string }> {
  const privateKeyHex = bytesToHex(generateSecretKey());
  const ciphertext = await encryptFileWithExistingKey(fileBytes, privateKeyHex);
  return { ciphertext, privateKeyHex };
}

/**
 * Decrypt a file using the stored private key
 */
export async function decryptFileWithKey(
  ciphertext: string,
  privateKeyHex: string,
): Promise<Uint8Array> {
  // Convert hex private key back to bytes
  const secretKey = hexToBytes(privateKeyHex);
  const pubkey = getPublicKey(secretKey);

  // Recreate conversation key (decrypt from self)
  const conversationKey = nip44.v2.utils.getConversationKey(secretKey, pubkey);

  // Decrypt using our large payload implementation
  const plaintextBase64 = await aesGcmDecrypt(ciphertext, conversationKey);

  if (!plaintextBase64) {
    throw new Error("Decryption failed");
  }

  // Convert base64 back to bytes
  return base64ToUint8Array(plaintextBase64);
}

/**
 * Encrypt a file using an existing private key
 */
export async function encryptFileWithExistingKey(
  fileBytes: Uint8Array,
  privateKeyHex: string,
): Promise<string> {
  const secretKey = hexToBytes(privateKeyHex);
  const pubkey = getPublicKey(secretKey);
  const conversationKey = nip44.v2.utils.getConversationKey(secretKey, pubkey);
  const plaintextBase64 = uint8ArrayToBase64(fileBytes);
  return aesGcmEncrypt(plaintextBase64, conversationKey);
}

/**
 * Encrypt a file (Uint8Array) using NIP-44 with window.nostr
 * DEPRECATED: Use encryptFileWithKey instead
 */
export async function encryptFile(fileBytes: Uint8Array): Promise<string> {
  const signer = await signerManager.getSigner();
  if (!signer.nip44Encrypt) {
    throw new Error("Signer does not support NIP-44 encryption");
  }

  const pubkey = await signer.getPublicKey();
  const plaintextBase64 = uint8ArrayToBase64(fileBytes);
  return signer.nip44Encrypt(pubkey, plaintextBase64);
}

/**
 * Decrypt NIP-44 ciphertext using window.nostr
 * DEPRECATED: Use decryptFileWithKey instead
 */
export async function decryptFile(ciphertext: string): Promise<Uint8Array> {
  const signer = await signerManager.getSigner();
  if (!signer.nip44Decrypt) {
    throw new Error("Signer does not support NIP-44 decryption");
  }

  const pubkey = await signer.getPublicKey();
  const plaintextBase64 = await signer.nip44Decrypt(pubkey, ciphertext);

  if (!plaintextBase64) {
    throw new Error(
      "Decryption returned empty result - did you cancel the prompt?",
    );
  }

  return base64ToUint8Array(plaintextBase64);
}
