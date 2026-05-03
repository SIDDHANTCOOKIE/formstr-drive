import type { Event, EventTemplate } from "nostr-tools";
import type { NostrSigner } from "./types";

export const nip07Signer: NostrSigner = {
  getPublicKey: async (): Promise<string> => {
    if (!window.nostr) throw new Error("NIP-07 signer not found");
    return window.nostr.getPublicKey();
  },

  signEvent: async (event: EventTemplate): Promise<Event> => {
    if (!window.nostr) throw new Error("NIP-07 signer not found");
    return window.nostr.signEvent(event);
  },

  nip44Encrypt: async (pubkey: string, plaintext: string): Promise<string> => {
    if (!window.nostr?.nip44?.encrypt) {
      throw new Error("NIP-44 encryption not supported");
    }

    return window.nostr.nip44.encrypt(pubkey, plaintext);
  },

  nip44Decrypt: async (pubkey: string, ciphertext: string): Promise<string> => {
    if (!window.nostr?.nip44?.decrypt) {
      throw new Error("NIP-44 decryption not supported");
    }

    try {
      return await (window.nostr.nip44.decrypt as (peerPubkey: string, value: string) => Promise<string>)(
        pubkey,
        ciphertext,
      );
    } catch {
      return (window.nostr.nip44.decrypt as (params: { pubkey: string; ciphertext: string }) => Promise<string>)({
        pubkey,
        ciphertext,
      });
    }
  },
};
