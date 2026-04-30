import type { Event, EventTemplate } from "nostr-tools";
import { finalizeEvent, generateSecretKey, getPublicKey, nip19, nip44 } from "nostr-tools";
import { hexToBytes } from "nostr-tools/utils";
import type { NostrSigner } from "./types";

export function createNewNsec(): string {
  const secretKey = generateSecretKey();
  return nip19.nsecEncode(secretKey);
}

export function createLocalSigner(privkeyHex: string): NostrSigner {
  const secretKey = hexToBytes(privkeyHex);
  const pubkey = getPublicKey(secretKey);

  return {
    getPublicKey: async () => pubkey,

    signEvent: async (event: EventTemplate): Promise<Event> => {
      return finalizeEvent(event, secretKey);
    },

    nip44Encrypt: async (peerPubkey: string, plaintext: string): Promise<string> => {
      const conversationKey = nip44.v2.utils.getConversationKey(secretKey, peerPubkey);
      return nip44.v2.encrypt(plaintext, conversationKey);
    },

    nip44Decrypt: async (peerPubkey: string, ciphertext: string): Promise<string> => {
      const conversationKey = nip44.v2.utils.getConversationKey(secretKey, peerPubkey);
      return nip44.v2.decrypt(ciphertext, conversationKey);
    },
  };
}

export function createDeferredLocalSigner(
  cachedPubkey: string,
  loadPrivkeyHex: () => Promise<string>,
): NostrSigner {
  let signerPromise: Promise<NostrSigner> | null = null;

  const getSigner = async () => {
    if (!signerPromise) {
      signerPromise = (async () => {
        const signer = createLocalSigner(await loadPrivkeyHex());
        const actualPubkey = await signer.getPublicKey();

        if (actualPubkey !== cachedPubkey) {
          throw new Error("Stored key does not match the restored profile");
        }

        return signer;
      })();
    }

    return signerPromise;
  };

  return {
    getPublicKey: async () => cachedPubkey,

    signEvent: async (event: EventTemplate): Promise<Event> => {
      const signer = await getSigner();
      return signer.signEvent(event);
    },

    nip44Encrypt: async (peerPubkey: string, plaintext: string): Promise<string> => {
      const signer = await getSigner();

      if (!signer.nip44Encrypt) {
        throw new Error("Signer does not support NIP-44 encryption");
      }

      return signer.nip44Encrypt(peerPubkey, plaintext);
    },

    nip44Decrypt: async (peerPubkey: string, ciphertext: string): Promise<string> => {
      const signer = await getSigner();

      if (!signer.nip44Decrypt) {
        throw new Error("Signer does not support NIP-44 decryption");
      }

      return signer.nip44Decrypt(peerPubkey, ciphertext);
    },
  };
}
