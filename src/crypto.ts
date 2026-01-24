declare global {
  interface Window {
    nostr?: {
      nip44: {
        encrypt: (pubkey: string, text: string) => Promise<string>;
        decrypt: (params: {
          pubkey: string;
          ciphertext: string;
        }) => Promise<string>;
      };
      getPublicKey: () => Promise<string>;
      signEvent?: (event: any) => Promise<any>; // NIP-07
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
  console.log("Window. nostr", window.nostr);
  if (!window.nostr) throw new Error("Nostr signer not found");
  const pubkey = await window.nostr.getPublicKey();
  const plaintextBase64 = uint8ArrayToBase64(fileBytes);
  console.log("plaintext is", plaintextBase64, "pubkey is", pubkey);
  const ciphertext = await window.nostr.nip44.encrypt(pubkey, plaintextBase64);
  console.log("ciphertext is", ciphertext);
  return ciphertext;
}

/**
 * Decrypt NIP-44 ciphertext using window.nostr
 */
export async function decryptFile(ciphertext: string): Promise<Uint8Array> {
  if (!window.nostr) throw new Error("Nostr signer not found");
  const pubkey = await window.nostr.getPublicKey();
  const plaintext = await window.nostr.nip44.decrypt({ pubkey, ciphertext });
  return new TextEncoder().encode(plaintext);
}
