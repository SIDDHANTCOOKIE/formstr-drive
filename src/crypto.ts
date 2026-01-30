declare global {
  interface Window {
    nostr?: {
      nip44: {
        encrypt: (pubkey: string, text: string) => Promise<string>;
        decrypt: (params: { pubkey: string; ciphertext: string }) => Promise<string>;
      };
      getPublicKey: () => Promise<string>;
      signEvent: (event: object) => Promise<object>;
    };
  }
}

/**
 * Encrypt a file (Uint8Array) using NIP-44 with window.nostr
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

export function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function encryptFile(fileBytes: Uint8Array): Promise<string> {
  if (!window.nostr) throw new Error("Nostr signer not found");
  const pubkey = await window.nostr.getPublicKey();
  const plaintextBase64 = uint8ArrayToBase64(fileBytes);
  return window.nostr.nip44.encrypt(pubkey, plaintextBase64);
}

/**
 * Decrypt NIP-44 ciphertext using window.nostr
 */
export async function decryptFile(ciphertext: string): Promise<Uint8Array> {
  if (!window.nostr) throw new Error("Nostr signer not found");
  const pubkey = await window.nostr.getPublicKey();

  // Alby uses positional args: decrypt(peer, ciphertext)
  const plaintextBase64 = await (window.nostr.nip44.decrypt as any)(pubkey, ciphertext);

  if (!plaintextBase64) {
    throw new Error("Decryption returned empty result - did you cancel the prompt?");
  }

  return base64ToUint8Array(plaintextBase64);
}
