import { Preferences } from "@capacitor/preferences";
import { isAndroidPlatform, isNativePlatform } from "./platform";

export const STORAGE_KEYS = {
  PROFILE: "formstr-drive-profile",
  CUSTOM_FOLDERS: "formstr-drive-custom-folders",
  CUSTOM_SERVERS: "formstr-drive-custom-servers",
  SELECTED_SERVER: "formstr-drive-selected-server",
  AUTH_METHOD: "formstr-drive-auth-method",
  NIP55_PACKAGE_NAME: "formstr-drive-nip55-package-name",
  NIP55_PUBKEY: "formstr-drive-nip55-pubkey",
  NIP46_URI: "formstr-drive-nip46-uri",
  NIP46_PUBKEY: "formstr-drive-nip46-pubkey",
  NIP46_CLIENT_SECRET_HEX: "formstr-drive-nip46-client-secret-hex",
  NSEC: "formstr-drive-nsec",
  DRIVE_KEY_CACHE: "formstr-drive-drive-key-cache",
} as const;

function parseStoredValue<T>(value: string | null, defaultValue: T): T {
  if (value === null) {
    return defaultValue;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return defaultValue;
  }
}

export async function getStoredItem<T>(key: string, defaultValue: T): Promise<T> {
  if (isNativePlatform) {
    const { value } = await Preferences.get({ key });
    return parseStoredValue(value, defaultValue);
  }

  return parseStoredValue(localStorage.getItem(key), defaultValue);
}

export async function setStoredItem(key: string, value: unknown): Promise<void> {
  const serializedValue = JSON.stringify(value);

  if (isNativePlatform) {
    await Preferences.set({ key, value: serializedValue });
    return;
  }

  localStorage.setItem(key, serializedValue);
  window.dispatchEvent(new Event("storage"));
}

export async function removeStoredItem(key: string): Promise<void> {
  if (isNativePlatform) {
    await Preferences.remove({ key });
    return;
  }

  localStorage.removeItem(key);
  window.dispatchEvent(new Event("storage"));
}

async function getSecureKeyStorage() {
  const module = await import("@khadarvsk/capacitor-secure-storage");
  return module.default;
}

export async function getStoredSecret(key: string): Promise<string | null> {
  if (isNativePlatform && isAndroidPlatform) {
    const secureStorage = await getSecureKeyStorage();
    const { value } = await secureStorage.get({ key });
    return value;
  }

  if (isNativePlatform) {
    const { value } = await Preferences.get({ key });
    return value;
  }

  return localStorage.getItem(key);
}

export async function setStoredSecret(key: string, value: string): Promise<void> {
  if (isNativePlatform && isAndroidPlatform) {
    const secureStorage = await getSecureKeyStorage();
    await secureStorage.set({ key, value });
    return;
  }

  if (isNativePlatform) {
    await Preferences.set({ key, value });
    return;
  }

  localStorage.setItem(key, value);
}

export async function removeStoredSecret(key: string): Promise<void> {
  if (isNativePlatform && isAndroidPlatform) {
    const secureStorage = await getSecureKeyStorage();
    await secureStorage.remove({ key });
    return;
  }

  if (isNativePlatform) {
    await Preferences.remove({ key });
    return;
  }

  localStorage.removeItem(key);
}
