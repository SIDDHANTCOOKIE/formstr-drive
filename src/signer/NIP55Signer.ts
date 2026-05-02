import type { Event, EventTemplate } from "nostr-tools";
import { getEventHash, nip19 } from "nostr-tools";
import { NostrSignerPlugin } from "nostr-signer-capacitor-plugin";
import type { NativeSignerApp, NostrSigner } from "./types";

function decodeSignerPublicKey(value: string): { hex: string; npub: string } {
  if (value.startsWith("npub1")) {
    return {
      hex: nip19.decode(value).data as unknown as string,
      npub: value,
    };
  }

  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    const hex = value.toLowerCase();
    return {
      hex,
      npub: nip19.npubEncode(hex),
    };
  }

  throw new Error(`Unexpected signer public key format: ${value}`);
}

export async function getInstalledNativeSignerApps(): Promise<NativeSignerApp[]> {
  const result = await NostrSignerPlugin.getInstalledSignerApps();
  return result.apps ?? [];
}

export function createNIP55Signer(
  packageName: string,
  initialPubkey?: string,
): NostrSigner {
  let cachedPubkey: string | undefined = initialPubkey;
  let cachedNpub: string | undefined = initialPubkey ? nip19.npubEncode(initialPubkey) : undefined;
  let packageNameSet = false;

  const ensurePackageNameSet = async () => {
    if (!packageNameSet) {
      await NostrSignerPlugin.setPackageName(packageName);
      packageNameSet = true;
    }
  };

  const ensureCachedKeys = async () => {
    if (cachedPubkey && cachedNpub) {
      await ensurePackageNameSet();
      return;
    }

    await ensurePackageNameSet();
    const { npub } = await NostrSignerPlugin.getPublicKey();
    const decoded = decodeSignerPublicKey(npub);
    cachedPubkey = decoded.hex;
    cachedNpub = decoded.npub;
  };

  return {
    async getPublicKey(): Promise<string> {
      await ensureCachedKeys();
      return cachedPubkey!;
    },

    async signEvent(event: EventTemplate): Promise<Event> {
      await ensureCachedKeys();
      const pubkey = cachedPubkey!;
      const fullEvent = { ...event, pubkey };
      const id = getEventHash(fullEvent);
      const eventWithId = { ...fullEvent, id };

      const { event: signedEventJson } = await NostrSignerPlugin.signEvent(
        packageName,
        JSON.stringify(eventWithId),
        eventWithId.id,
        cachedNpub!,
      );

      if (!signedEventJson) {
        throw new Error("Signer did not return a signed event");
      }

      return JSON.parse(signedEventJson) as Event;
    },

    async nip44Encrypt(pubkey: string, plaintext: string): Promise<string> {
      await ensureCachedKeys();
      const { result } = await NostrSignerPlugin.nip44Encrypt(
        packageName,
        plaintext,
        "",
        pubkey,
        cachedNpub!,
      );

      if (!result) throw new Error("NIP-44 encryption failed");
      return result;
    },

    async nip44Decrypt(pubkey: string, ciphertext: string): Promise<string> {
      await ensureCachedKeys();
      const { result } = await NostrSignerPlugin.nip44Decrypt(
        packageName,
        ciphertext,
        "",
        pubkey,
        cachedNpub!,
      );

      if (!result) throw new Error("NIP-44 decryption failed");
      return result;
    },
  };
}
