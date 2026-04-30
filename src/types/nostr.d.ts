import type { Event, EventTemplate } from "nostr-tools";

declare global {
  interface Window {
    nostr?: {
      nip04?: {
        encrypt: (pubkey: string, plaintext: string) => Promise<string>;
        decrypt: (pubkey: string, ciphertext: string) => Promise<string>;
      };
      nip44?: {
        encrypt: (pubkey: string, plaintext: string) => Promise<string>;
        decrypt:
          | ((pubkey: string, ciphertext: string) => Promise<string>)
          | ((params: { pubkey: string; ciphertext: string }) => Promise<string>);
      };
      getPublicKey: () => Promise<string>;
      signEvent: (event: EventTemplate) => Promise<Event>;
    };
  }
}

export {};
