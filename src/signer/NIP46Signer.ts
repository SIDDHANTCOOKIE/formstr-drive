import type { Event, EventTemplate, UnsignedEvent } from "nostr-tools";
import { generateSecretKey, getPublicKey } from "nostr-tools";
import {
  BunkerSigner,
  createNostrConnectURI,
  type BunkerSignerParams,
  type BunkerPointer,
  parseBunkerInput,
} from "nostr-tools/nip46";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import {
  getStoredItem,
  setStoredItem,
  STORAGE_KEYS,
} from "../utils/persistence";
import type { NostrSigner } from "./types";

export const NIP46_RELAYS = ["wss://relay.nsec.app", "wss://nostr.oxtr.dev"];

type CreateNip46SignerOptions = BunkerSignerParams & {
  maxWaitMs?: number;
  abortSignal?: AbortSignal;
};

async function getOrCreateClientSecretKey(): Promise<Uint8Array> {
  const storedHex = await getStoredItem<string | null>(
    STORAGE_KEYS.NIP46_CLIENT_SECRET_HEX,
    null,
  );

  if (storedHex) {
    return hexToBytes(storedHex);
  }

  const secretKey = generateSecretKey();
  await setStoredItem(STORAGE_KEYS.NIP46_CLIENT_SECRET_HEX, bytesToHex(secretKey));
  return secretKey;
}

export async function createNip46ConnectUri(): Promise<string> {
  const clientSecretKey = await getOrCreateClientSecretKey();
  const clientPubkey = getPublicKey(clientSecretKey);
  const secretBytes = crypto.getRandomValues(new Uint8Array(16));
  const secret = bytesToHex(secretBytes);

  return createNostrConnectURI({
    clientPubkey,
    relays: NIP46_RELAYS,
    secret,
    perms: ["get_public_key", "sign_event", "nip44_encrypt", "nip44_decrypt"],
    name: "Formstr Drive",
    url: window.location.origin,
  });
}

export async function createNip46Signer(
  uri: string,
  options: CreateNip46SignerOptions = {},
): Promise<NostrSigner> {
  const clientSecretKey = await getOrCreateClientSecretKey();
  const parsedUri = new URL(uri);
  const { maxWaitMs, abortSignal, ...params } = options;

  if (parsedUri.protocol === "bunker:") {
    const bunkerPointer: BunkerPointer | null = await parseBunkerInput(uri);
    if (!bunkerPointer) {
      throw new Error("Invalid bunker URL");
    }

    const bunker = BunkerSigner.fromBunker(clientSecretKey, bunkerPointer, params);
    await bunker.connect();
    return wrapBunkerSigner(bunker);
  }

  if (parsedUri.protocol === "nostrconnect:") {
    const bunker = await BunkerSigner.fromURI(
      clientSecretKey,
      uri,
      params,
      abortSignal ?? maxWaitMs,
    );
    return wrapBunkerSigner(bunker);
  }

  throw new Error("Unsupported bunker URL");
}

function wrapBunkerSigner(bunker: BunkerSigner): NostrSigner {
  return {
    getPublicKey: async () => bunker.getPublicKey(),

    signEvent: async (event: EventTemplate): Promise<Event> => {
      return bunker.signEvent(event as UnsignedEvent);
    },

    nip44Encrypt: async (pubkey: string, plaintext: string): Promise<string> => {
      return bunker.nip44Encrypt(pubkey, plaintext);
    },

    nip44Decrypt: async (pubkey: string, ciphertext: string): Promise<string> => {
      return bunker.nip44Decrypt(pubkey, ciphertext);
    },
  };
}
