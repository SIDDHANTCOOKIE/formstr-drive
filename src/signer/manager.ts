import { nip19 } from "nostr-tools";
import { bytesToHex } from "nostr-tools/utils";
import { createDeferredLocalSigner, createLocalSigner } from "./LocalSigner";
import { createNip46ConnectUri, createNip46Signer } from "./NIP46Signer";
import { createNIP55Signer } from "./NIP55Signer";
import { nip07Signer } from "./NIP07Signer";
import type { NostrSigner } from "./types";
import {
  getStoredItem,
  getStoredSecret,
  removeStoredItem,
  removeStoredSecret,
  setStoredItem,
  setStoredSecret,
  STORAGE_KEYS,
} from "../utils/persistence";
import { isNativePlatform } from "../utils/platform";

type ChangeListener = (pubkey?: string) => void;
type StoredAuthMethod = "nip07" | "nip55" | "nip46" | "nsec";
type Nip46LoginOptions = {
  abortSignal?: AbortSignal;
};

const NATIVE_SIGNER_CONNECT_TIMEOUT_MS = 20000;
const NSEC_PERSIST_TIMEOUT_MS = 2000;
const NSEC_RESTORE_TIMEOUT_MS = 1500;
const LOGOUT_CLEANUP_TIMEOUT_MS = 1500;

function createTimeoutError(message: string) {
  const error = new Error(message);
  error.name = "TimeoutError";
  return error;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(createTimeoutError(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function decodeNsecBytes(nsec: string): Uint8Array {
  try {
    const decoded = nip19.decode(nsec.trim());
    if (decoded.type !== "nsec" || !(decoded.data instanceof Uint8Array)) {
      throw new Error("Invalid nsec");
    }

    return decoded.data;
  } catch {
    throw new Error("Invalid nsec");
  }
}

class SignerManager {
  private signer: NostrSigner | null = null;
  private pubkey?: string;
  private listeners = new Set<ChangeListener>();

  getPubkey() {
    return this.pubkey;
  }

  onChange(listener: ChangeListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) {
      listener(this.pubkey);
    }
  }

  private async runBackgroundCleanup(tasks: Promise<unknown>[], label: string) {
    const results = await Promise.allSettled(tasks);
    const rejected = results.filter((result) => result.status === "rejected");

    if (rejected.length > 0) {
      console.error(`Background cleanup failed after ${label}`, rejected);
    }
  }

  async createNip46ConnectUri(): Promise<string> {
    return createNip46ConnectUri();
  }

  async restoreFromStorage(): Promise<string | undefined> {
    const authMethod = await getStoredItem<StoredAuthMethod | null>(
      STORAGE_KEYS.AUTH_METHOD,
      null,
    );
    const storedProfile = await getStoredItem<{ pubkey?: string } | null>(
      STORAGE_KEYS.PROFILE,
      null,
    );

    try {
      if (isNativePlatform && (authMethod === "nsec" || authMethod === null)) {
        const cachedPubkey = storedProfile?.pubkey;

        if (cachedPubkey) {
          this.signer = createDeferredLocalSigner(cachedPubkey, async () => {
            const nsec = await withTimeout(
              getStoredSecret(STORAGE_KEYS.NSEC),
              NSEC_RESTORE_TIMEOUT_MS,
              "Timed out while restoring secure nsec",
            );

            if (!nsec) {
              throw new Error("Stored nsec not found");
            }

            return bytesToHex(decodeNsecBytes(nsec));
          });
          this.pubkey = cachedPubkey;
          await setStoredItem(STORAGE_KEYS.PROFILE, { pubkey: cachedPubkey });
          await setStoredItem(STORAGE_KEYS.AUTH_METHOD, "nsec");
          this.notify();
          return cachedPubkey;
        }

        const nsec = await withTimeout(
          getStoredSecret(STORAGE_KEYS.NSEC),
          NSEC_RESTORE_TIMEOUT_MS,
          "Timed out while restoring secure nsec",
        );

        if (nsec) {
          const signer = createLocalSigner(bytesToHex(decodeNsecBytes(nsec)));
          const pubkey = await signer.getPublicKey();
          this.signer = signer;
          this.pubkey = pubkey;
          await setStoredItem(STORAGE_KEYS.PROFILE, { pubkey });
          await setStoredItem(STORAGE_KEYS.AUTH_METHOD, "nsec");
          this.notify();
          return pubkey;
        }
      }

      if (isNativePlatform && (authMethod === "nip55" || authMethod === null)) {
        const packageName = await getStoredItem<string | null>(
          STORAGE_KEYS.NIP55_PACKAGE_NAME,
          null,
        );
        const pubkey = await getStoredItem<string | null>(
          STORAGE_KEYS.NIP55_PUBKEY,
          null,
        );

        if (packageName && pubkey) {
          this.signer = createNIP55Signer(packageName, pubkey);
          this.pubkey = pubkey;
          await setStoredItem(STORAGE_KEYS.PROFILE, { pubkey });
          await setStoredItem(STORAGE_KEYS.AUTH_METHOD, "nip55");
          this.notify();
          return pubkey;
        }
      }

      if (authMethod === "nip46" || authMethod === null) {
        const uri = await getStoredItem<string | null>(STORAGE_KEYS.NIP46_URI, null);

        if (uri) {
          const signer = await createNip46Signer(uri, { maxWaitMs: 5000 });
          const pubkey = await signer.getPublicKey();
          this.signer = signer;
          this.pubkey = pubkey;
          await setStoredItem(STORAGE_KEYS.PROFILE, { pubkey });
          await setStoredItem(STORAGE_KEYS.AUTH_METHOD, "nip46");
          await setStoredItem(STORAGE_KEYS.NIP46_PUBKEY, pubkey);
          this.notify();
          return pubkey;
        }
      }

      if (!isNativePlatform && (authMethod === "nip07" || authMethod === null)) {
        const profile = await getStoredItem<{ pubkey?: string } | null>(
          STORAGE_KEYS.PROFILE,
          null,
        );

        if (profile?.pubkey && window.nostr) {
          this.signer = nip07Signer;
          this.pubkey = profile.pubkey;
          await setStoredItem(STORAGE_KEYS.AUTH_METHOD, "nip07");
          this.notify();
          return profile.pubkey;
        }
      }
    } catch (error) {
      console.error("Failed to restore signer session", error);
    }

    this.signer = null;
    this.pubkey = undefined;
    this.notify();
    return undefined;
  }

  async requestPubkey(packageName?: string): Promise<string> {
    if (isNativePlatform) {
      if (!packageName) {
        throw new Error("Please select an Android signer app");
      }

      const signer = createNIP55Signer(packageName);
      const pubkey = await withTimeout(
        signer.getPublicKey(),
        NATIVE_SIGNER_CONNECT_TIMEOUT_MS,
        "Android signer did not respond. Please approve the request in Amber and try again.",
      );
      this.signer = signer;
      this.pubkey = pubkey;

      await setStoredItem(STORAGE_KEYS.PROFILE, { pubkey });
      await setStoredItem(STORAGE_KEYS.AUTH_METHOD, "nip55");
      await setStoredItem(STORAGE_KEYS.NIP55_PACKAGE_NAME, packageName);
      await setStoredItem(STORAGE_KEYS.NIP55_PUBKEY, pubkey);
      this.notify();

      void this.runBackgroundCleanup(
        [
          removeStoredItem(STORAGE_KEYS.NIP46_URI),
          removeStoredItem(STORAGE_KEYS.NIP46_PUBKEY),
          removeStoredSecret(STORAGE_KEYS.NSEC),
        ],
        "nip55 login",
      );

      return pubkey;
    }

    if (!window.nostr) throw new Error("NIP-07 extension not found");

    const pubkey = await nip07Signer.getPublicKey();
    this.signer = nip07Signer;
    this.pubkey = pubkey;
    await setStoredItem(STORAGE_KEYS.PROFILE, { pubkey });
    await setStoredItem(STORAGE_KEYS.AUTH_METHOD, "nip07");
    await removeStoredItem(STORAGE_KEYS.NIP46_URI);
    await removeStoredItem(STORAGE_KEYS.NIP46_PUBKEY);
    await removeStoredSecret(STORAGE_KEYS.NSEC);

    this.notify();
    return pubkey;
  }

  async loginWithNip46(uri: string, options: Nip46LoginOptions = {}): Promise<string> {
    const signer = await createNip46Signer(uri, options);
    const pubkey = await signer.getPublicKey();

    this.signer = signer;
    this.pubkey = pubkey;

    await setStoredItem(STORAGE_KEYS.PROFILE, { pubkey });
    await setStoredItem(STORAGE_KEYS.AUTH_METHOD, "nip46");
    await setStoredItem(STORAGE_KEYS.NIP46_URI, uri);
    await setStoredItem(STORAGE_KEYS.NIP46_PUBKEY, pubkey);
    this.notify();

    void this.runBackgroundCleanup(
      [
        removeStoredItem(STORAGE_KEYS.NIP55_PACKAGE_NAME),
        removeStoredItem(STORAGE_KEYS.NIP55_PUBKEY),
        removeStoredSecret(STORAGE_KEYS.NSEC),
      ],
      "nip46 login",
    );

    return pubkey;
  }

  async loginWithNsec(nsec: string): Promise<string> {
    if (!isNativePlatform) {
      throw new Error("nsec login is only available in the Android app");
    }

    const signer = createLocalSigner(bytesToHex(decodeNsecBytes(nsec)));
    const pubkey = await signer.getPublicKey();

    this.signer = signer;
    this.pubkey = pubkey;
    await setStoredItem(STORAGE_KEYS.PROFILE, { pubkey });
    await setStoredItem(STORAGE_KEYS.AUTH_METHOD, "nsec");
    await removeStoredItem(STORAGE_KEYS.NIP46_URI);
    await removeStoredItem(STORAGE_KEYS.NIP46_PUBKEY);
    await removeStoredItem(STORAGE_KEYS.NIP55_PACKAGE_NAME);
    await removeStoredItem(STORAGE_KEYS.NIP55_PUBKEY);

    this.notify();

    try {
      await withTimeout(
        setStoredSecret(STORAGE_KEYS.NSEC, nsec.trim()),
        NSEC_PERSIST_TIMEOUT_MS,
        "Timed out while storing nsec securely",
      );
    } catch (error) {
      console.error("Failed to persist nsec in secure storage", error);
    }

    return pubkey;
  }

  async logout(): Promise<void> {
    this.signer = null;
    this.pubkey = undefined;
    this.notify();

    await Promise.allSettled([
      withTimeout(
        removeStoredItem(STORAGE_KEYS.PROFILE),
        LOGOUT_CLEANUP_TIMEOUT_MS,
        "Timed out while clearing stored profile",
      ),
      withTimeout(
        removeStoredItem(STORAGE_KEYS.AUTH_METHOD),
        LOGOUT_CLEANUP_TIMEOUT_MS,
        "Timed out while clearing auth method",
      ),
      withTimeout(
        removeStoredItem(STORAGE_KEYS.NIP55_PACKAGE_NAME),
        LOGOUT_CLEANUP_TIMEOUT_MS,
        "Timed out while clearing signer package name",
      ),
      withTimeout(
        removeStoredItem(STORAGE_KEYS.NIP55_PUBKEY),
        LOGOUT_CLEANUP_TIMEOUT_MS,
        "Timed out while clearing signer pubkey",
      ),
      withTimeout(
        removeStoredItem(STORAGE_KEYS.NIP46_URI),
        LOGOUT_CLEANUP_TIMEOUT_MS,
        "Timed out while clearing bunker URI",
      ),
      withTimeout(
        removeStoredItem(STORAGE_KEYS.NIP46_PUBKEY),
        LOGOUT_CLEANUP_TIMEOUT_MS,
        "Timed out while clearing bunker pubkey",
      ),
      withTimeout(
        removeStoredSecret(STORAGE_KEYS.NSEC),
        LOGOUT_CLEANUP_TIMEOUT_MS,
        "Timed out while clearing secure nsec",
      ),
    ]);
  }

  async getSigner(): Promise<NostrSigner> {
    if (this.signer) {
      return this.signer;
    }

    throw new Error("No signer available");
  }
}

export const signerManager = new SignerManager();
