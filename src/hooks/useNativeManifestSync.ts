import { useEffect } from "react";
import type { FileMetadata } from "../types/metadata";
import {
  clearNativeDriveManifest,
  syncNativeDriveManifest,
} from "../native/driveManifest";

interface NativeManifestSyncOptions {
  files: FileMetadata[];
  customFolders: string[];
  isSignedIn: boolean;
  pubkey: string | undefined;
  restoring: boolean;
  settingsLoaded: boolean;
  loading: boolean;
  /** Gates on the FULL replay, not just the Drive Key: publishing a partial
   *  file list would make the Files app briefly show a half-empty drive. */
  hasHydratedIndex: boolean;
}

/**
 * Keeps the Android Files-app manifest in step with the drive: publishes the
 * current file/folder set once the index has fully hydrated, and clears it on
 * sign-out so a signed-out device doesn't keep exposing the previous account's
 * files through the system file picker.
 */
export function useNativeManifestSync({
  files,
  customFolders,
  isSignedIn,
  pubkey,
  restoring,
  settingsLoaded,
  loading,
  hasHydratedIndex,
}: NativeManifestSyncOptions): void {
  useEffect(() => {
    if (restoring) {
      return;
    }

    if (!isSignedIn || !pubkey) {
      void clearNativeDriveManifest().catch((manifestError) => {
        console.error("Failed to clear Android Drive manifest", manifestError);
      });
    }
  }, [isSignedIn, pubkey, restoring]);

  useEffect(() => {
    if (
      restoring ||
      !settingsLoaded ||
      !isSignedIn ||
      !pubkey ||
      loading ||
      !hasHydratedIndex
    ) {
      return;
    }

    void syncNativeDriveManifest(files, customFolders).catch((manifestError) => {
      console.error("Failed to sync Android Drive manifest", manifestError);
    });
  }, [
    customFolders,
    files,
    isSignedIn,
    loading,
    pubkey,
    restoring,
    settingsLoaded,
    hasHydratedIndex,
  ]);
}
