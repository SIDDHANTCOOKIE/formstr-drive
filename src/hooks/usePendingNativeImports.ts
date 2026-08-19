import { useCallback, useEffect, useRef } from "react";
import {
  listPendingNativeImports,
  readPendingNativeImport,
  removePendingNativeImport,
} from "../native/driveManifest";
import { queueUpload } from "../transfers/transferQueue";

interface PendingNativeImportsOptions {
  isSignedIn: boolean;
  pubkey: string | undefined;
  restoring: boolean;
  settingsLoaded: boolean;
  loading: boolean;
  hasHydratedIndex: boolean;
  selectedServer: string;
  onError: (message: string) => void;
}

/**
 * Picks up files handed to the app by the Android Files provider while it
 * wasn't running, and uploads them into the drive.
 *
 * At-least-once: the on-device pending import is deleted ONLY after its upload
 * confirms success. If the upload fails, is cancelled, or the app is killed
 * first, the import is retained and retried on the next launch. A still-running
 * upload with the same id dedupes, so re-scanning is always safe.
 */
export function usePendingNativeImports({
  isSignedIn,
  pubkey,
  restoring,
  settingsLoaded,
  loading,
  hasHydratedIndex,
  selectedServer,
  onError,
}: PendingNativeImportsOptions): void {
  const processingRef = useRef(false);

  const processPendingImports = useCallback(async () => {
    if (!isSignedIn || !pubkey || loading || !hasHydratedIndex) {
      return;
    }

    if (processingRef.current) {
      return;
    }

    processingRef.current = true;
    try {
      const pendingImports = await listPendingNativeImports();
      if (pendingImports.length === 0) {
        return;
      }

      for (const pendingImport of pendingImports) {
        const importPayload = await readPendingNativeImport(pendingImport.id);
        if (!importPayload) {
          continue;
        }

        try {
          const importedFileBuffer = importPayload.bytes.buffer.slice(
            importPayload.bytes.byteOffset,
            importPayload.bytes.byteOffset + importPayload.bytes.byteLength,
          ) as ArrayBuffer;

          const importedFile = new File([importedFileBuffer], importPayload.name, {
            type: importPayload.mimeType || "application/octet-stream",
          });

          queueUpload(importedFile, selectedServer, importPayload.folderPath, {
            onComplete: () => {
              void removePendingNativeImport(importPayload.id);
            },
          });
        } catch (pendingError) {
          console.error("Failed to process pending Android Files import", pendingError);
          onError(
            pendingError instanceof Error
              ? pendingError.message
              : "Failed to import file saved from Android Files",
          );
          continue;
        }
      }
    } finally {
      processingRef.current = false;
    }
  }, [hasHydratedIndex, isSignedIn, loading, onError, pubkey, selectedServer]);

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

    void processPendingImports();
  }, [
    hasHydratedIndex,
    isSignedIn,
    loading,
    processPendingImports,
    pubkey,
    restoring,
    settingsLoaded,
  ]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        isSignedIn &&
        !restoring &&
        hasHydratedIndex
      ) {
        void processPendingImports();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [hasHydratedIndex, isSignedIn, processPendingImports, restoring]);
}
