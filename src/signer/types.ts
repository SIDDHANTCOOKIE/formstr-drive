import type { Event, EventTemplate } from "nostr-tools";

export interface NostrSigner {
  getPublicKey: () => Promise<string>;
  signEvent: (event: EventTemplate) => Promise<Event>;
  nip44Encrypt?: (pubkey: string, plaintext: string) => Promise<string>;
  nip44Decrypt?: (pubkey: string, ciphertext: string) => Promise<string>;
}

export interface NativeSignerApp {
  packageName: string;
  name: string;
  iconUrl?: string;
}
