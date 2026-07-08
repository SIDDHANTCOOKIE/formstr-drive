import {
  createContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import type { FileMetadata } from "../types/metadata";
import {
  fetchFileIndex,
  saveFileMetadata,
  buildSignedMetadataEvent,
  deleteFileMetadata,
  extractFolders,
  autoMigrateLegacyFiles,
} from "../services/fileIndex";
import { MigrationPromptModal } from "../components/MigrationPromptModal";
import { encryptFileWithExistingKey } from "../crypto";
import { createAuthEvent, BACKGROUND_UPLOAD_AUTH_EXPIRATION_SECONDS } from "../auth";
import { BlossomClient } from "../blossom";
import { useProfileContext } from "../hooks/useProfileContext";
import { generateSecretKey } from "nostr-tools";
import { bytesToHex } from "nostr-tools/utils";
import { uploadFile as chunkedUploadFile, prepareUpload } from "../services/uploadFile";
import { downloadFileStreaming } from "../services/downloadFile";
import { previewFile } from "../services/Preview/previewManager";
import { getStoredItem, setStoredItem, STORAGE_KEYS } from "../utils/persistence";
import {
  cancelNativeUpload,
  clearNativeDriveManifest,
  downloadFileToDownloads,
  ensureNotificationPermission,
  listPendingNativeImports,
  readPendingNativeImport,
  removePendingNativeImport,
  stageNativeUploadChunk,
  startNativeUpload,
  startNativeUploadService,
  subscribeNativeUploadEvents,
  syncNativeDriveManifest,
} from "../native/driveManifest";
import { useBlossomServer } from "../hooks/useBlossomServer";
import { isAndroidPlatform } from "../utils/platform";
import { useToast } from "../hooks/useToast";
import { isAbortError } from "../utils/abortError";
import { APP_RELAYS } from "../utils/common";

interface Cancellable {
  abort: () => void;
}

// Background (native) upload is temporarily DISABLED. Staging 50 MB chunks to
// native storage means shipping each as a ~67 MB base64 string across the
// Capacitor bridge, which OOMs/crashes the app on large files. Until this is
// reworked to avoid the base64 bridge (native file access + native encryption),
// Android uploads use the same in-app JS path as web (OPFS-backed, no bridge,
// no crash) — foreground-only, no background completion. All the native upload
// plumbing is left intact behind this flag so it can be re-enabled later.
const ENABLE_NATIVE_BACKGROUND_UPLOAD = false;

export interface UploadProgress {
  fileName: string;
  stage: string;
  progress?: number;
  currentChunk?: number;
  totalChunks?: number;
}

export interface DownloadProgress {
  fileName: string;
  stage: string;
  progress?: number;
  currentChunk?: number;
  totalChunks?: number;
}

export interface FileIndexContextType {
  files: FileMetadata[];
  folders: string[];
  customFolders: string[];
  addCustomFolder: (path: string) => void;
  currentFolder: string;
  setCurrentFolder: (folder: string) => void;
  loading: boolean;
  hasHydratedIndex: boolean;
  error: string | null;
  uploadProgress: UploadProgress | null;
  uploadFile: (file: File, server: string) => Promise<void>;
  cancelUpload: () => void;
  downloadProgress: DownloadProgress | null;
  downloadFile: (file: FileMetadata) => Promise<{ uri: string | null }>;
  cancelDownload: () => void;
  deleteFile: (hash: string) => Promise<void>;
  deleteFiles: (hashes: string[]) => Promise<void>;
  moveFile: (hash: string, newFolder: string) => Promise<void>;
  moveFiles: (hashes: string[], newFolder: string) => Promise<void>;
  renameFile: (hash: string, newName: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export const FileIndexContext = createContext<FileIndexContextType | null>(null);

export function FileIndexProvider({ children }: { children: ReactNode }) {
  const { isSignedIn, pubkey, restoring } = useProfileContext();
  const { selectedServer } = useBlossomServer();
  const toast = useToast();

  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [currentFolder, setCurrentFolder] = useState("/");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [customFolders, setCustomFolders] = useState<string[]>([]);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [hasHydratedIndex, setHasHydratedIndex] = useState(false);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const downloadAbortRef = useRef<Cancellable | null>(null);
  const nativeUploadIdRef = useRef<string | null>(null);
  const [legacyFiles, setLegacyFiles] = useState<FileMetadata[]>([]);
  const processingPendingImportsRef = useRef(false);

  const foldersFromFiles = extractFolders(files);
  const folders = Array.from(new Set([...foldersFromFiles, ...customFolders])).sort();

  useEffect(() => {
    // Android downloads run in a foreground service and uploads stay alive via
    // the upload service's notification, so there's nothing to warn about here.
    if (isAndroidPlatform || (!uploadProgress && !downloadProgress)) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [uploadProgress, downloadProgress]);

  useEffect(() => {
    const loadCustomFolders = async () => {
      const storedCustomFolders = await getStoredItem<string[]>(
        STORAGE_KEYS.CUSTOM_FOLDERS,
        [],
      );
      setCustomFolders(storedCustomFolders);
      setSettingsLoaded(true);
    };

    void loadCustomFolders();
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    void setStoredItem(STORAGE_KEYS.CUSTOM_FOLDERS, customFolders);
  }, [customFolders, settingsLoaded]);

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

  const addCustomFolder = useCallback((path: string) => {
    setCustomFolders((prev) => {
      if (prev.includes(path)) return prev;
      return [...prev, path];
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!isSignedIn || !pubkey) return;

    setLoading(true);
    setError(null);
    try {
      const index = await fetchFileIndex(pubkey, (foundLegacyFiles) => {
        setLegacyFiles(foundLegacyFiles);
      });
      setFiles(index);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load files");
    } finally {
      setHasHydratedIndex(true);
      setLoading(false);
    }
  }, [isSignedIn, pubkey]);

  useEffect(() => {
    if (restoring) return;
    if (isSignedIn) {
      void refresh();
    } else {
      setFiles([]);
      setHasHydratedIndex(false);
    }
  }, [isSignedIn, refresh, restoring]);

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

  /**
   * Prepares (encrypts + hashes chunks and preview) and stages a file for a
   * native background upload, then hands it off to DriveUploadService via
   * stageNativeUploadChunk/startNativeUpload. Both Nostr signatures (the
   * Blossom auth event and the file-metadata event) are produced here, in
   * the foreground, before any network I/O — the native side only ships
   * bytes and publishes an already-signed event, so it survives the app
   * being swiped away.
   */
  const uploadPreparedFileNative = useCallback(
    async (file: File, server: string, targetFolder: string, controller: AbortController): Promise<FileMetadata> => {
      const signal = controller.signal;
      const throwIfAborted = () => {
        if (signal.aborted) {
          throw new DOMException("Upload aborted", "AbortError");
        }
      };

      setUploadProgress({ fileName: file.name, stage: "Reading file...", progress: 0 });

      const previewPromise = previewFile(file).catch((e) => {
        console.warn("Background preview generation failed", e);
        return null;
      });

      const uploadId = crypto.randomUUID();
      const privateKeyHex = bytesToHex(generateSecretKey());

      // Start the foreground service now (PREPARING phase) so a persistent
      // notification is visible while we encrypt + stage, and register the id
      // before any staging so cancel/cleanup can find it.
      nativeUploadIdRef.current = uploadId;
      await startNativeUploadService(uploadId, file.name);

      // While staging (before startNativeUpload attaches its own listener), a
      // notification "Cancel" tapped mid-staging must also abort this JS loop.
      let prepareCancelListener = await subscribeNativeUploadEvents(uploadId, (event) => {
        if (event.type === "cancelled" || event.type === "error") {
          controller.abort();
        }
      });

      try {
        const preview = await previewPromise;
        throwIfAborted();

        // Encrypt + hash + stage each chunk one at a time; onBlob hands each
        // ciphertext blob straight to native storage and drops it, so peak
        // memory stays ~one chunk regardless of file size.
        const prepared = await prepareUpload(
          file,
          privateKeyHex,
          signal,
          (info) => setUploadProgress({ fileName: file.name, ...info }),
          preview,
          (index, bytes) => stageNativeUploadChunk(uploadId, index, bytes),
        );

        throwIfAborted();
      const combinedHashes = prepared.previewHash
        ? [...prepared.chunkHashes, prepared.previewHash]
        : prepared.chunkHashes;

      setUploadProgress({ fileName: file.name, stage: "Waiting for signature approval...", progress: 45 });
      const authHeader = await createAuthEvent(
        "upload",
        `Upload ${file.name}`,
        combinedHashes,
        BACKGROUND_UPLOAD_AUTH_EXPIRATION_SECONDS,
      );

      const metadata: FileMetadata = {
        name: file.name,
        hash: prepared.chunkHashes[0],
        size: file.size,
        type: file.type || "application/octet-stream",
        folder: targetFolder,
        uploadedAt: Date.now(),
        server,
        ...(prepared.previewHash ? { previewHash: prepared.previewHash } : {}),
        chunks: prepared.chunkHashes,
        encryptionKey: privateKeyHex,
        encryptionAlgorithm: "aes-gcm",
      };

      const signedMetadataEvent = await buildSignedMetadataEvent(metadata);

      throwIfAborted();

      const chunkRefs = prepared.chunkRefs ?? [];
      const blobs: { path: string; hash: string; contentType: string }[] = chunkRefs.map((path, i) => ({
        path,
        hash: prepared.chunkHashes[i],
        contentType: "application/octet-stream",
      }));
      if (prepared.previewRef && prepared.previewHash) {
        blobs.push({ path: prepared.previewRef, hash: prepared.previewHash, contentType: "application/octet-stream" });
      }

      // Staging done + both events signed. The upload phase owns event
      // handling from here (its own listener + promise), so stop the
      // prepare-phase listener to avoid it aborting the shared controller on
      // a network-phase error (which would break the JS fallback).
      await prepareCancelListener?.remove();
      prepareCancelListener = null;

      setUploadProgress({ fileName: file.name, stage: "Uploading...", progress: 50 });

      await startNativeUpload(
        {
          uploadId,
          server,
          fileName: file.name,
          authHeader,
          metadataEventJson: JSON.stringify(signedMetadataEvent),
          blobs,
          relays: APP_RELAYS,
        },
        (event) => {
          if (event.type === "progress" && typeof event.percent === "number") {
            setUploadProgress({
              fileName: file.name,
              stage: "Uploading...",
              progress: 50 + Math.round(event.percent / 2),
            });
          }
        },
      );

      setUploadProgress({ fileName: file.name, stage: "Upload complete", progress: 100 });
      setFiles((prev) => [metadata, ...prev]);
      return metadata;
      } finally {
        await prepareCancelListener?.remove();
      }
    },
    [],
  );

  const uploadPreparedFile = useCallback(
    async (file: File, server: string, targetFolder: string): Promise<FileMetadata> => {
      setError(null);

      const controller = new AbortController();
      uploadAbortRef.current = controller;
      const { signal } = controller;

      if (isAndroidPlatform && ENABLE_NATIVE_BACKGROUND_UPLOAD) {
        await ensureNotificationPermission();

        try {
          const metadata = await uploadPreparedFileNative(file, server, targetFolder, controller);
          setUploadProgress(null);
          uploadAbortRef.current = null;
          nativeUploadIdRef.current = null;
          return metadata;
        } catch (e) {
          // Tear down the foreground service if it's still in the PREPARING
          // phase (idempotent + a no-op once the worker owns the upload), so a
          // failed/aborted handoff never leaves a stuck "Preparing…" notification.
          const startedId = nativeUploadIdRef.current;
          if (startedId) {
            void cancelNativeUpload(startedId);
          }
          nativeUploadIdRef.current = null;
          if (isAbortError(e)) {
            setUploadProgress(null);
            uploadAbortRef.current = null;
            toast.info("Upload cancelled");
            throw e;
          }
          console.warn("[Upload] Native handoff failed, falling back to JS upload", e);
          // Fall through to the JS path below — uploads must not hard-break
          // just because native staging/start failed.
        }
      }

      try {
        setUploadProgress({ fileName: file.name, stage: "Reading file...", progress: 0 });

        // Start generating preview immediately in the background
        const previewPromise = previewFile(file).catch((e) => {
          console.warn("Background preview generation failed", e);
          return null;
        });

        setUploadProgress({ fileName: file.name, stage: "Encrypting & Uploading...", progress: 0 });
        const privateKeyHex = bytesToHex(generateSecretKey());
        const { hashes } = await chunkedUploadFile(
          file,
          server,
          privateKeyHex,
          (info) => {
            setUploadProgress({ fileName: file.name, ...info });
          },
          signal,
        );
        const hash = hashes[0];

        let previewHash: string | undefined;

        // Wait for preview if it's not done yet
        const preview = await previewPromise;

        if (preview) {
          setUploadProgress({ fileName: file.name, stage: "Uploading preview...", progress: 95 });
          const encrypted = await encryptFileWithExistingKey(preview, privateKeyHex);
          const encryptedPreviewBytes = new TextEncoder().encode(encrypted);
          const previewAuth = await createAuthEvent(
            "upload",
            "Upload file preview",
            encryptedPreviewBytes,
          );
          const client = new BlossomClient(server);
          previewHash = await client.upload(encryptedPreviewBytes, previewAuth, undefined, signal);
        }

        setUploadProgress({ fileName: file.name, stage: "Saving metadata...", progress: 98 });
        const metadata: FileMetadata = {
          name: file.name,
          hash,
          size: file.size,
          type: file.type || "application/octet-stream",
          folder: targetFolder,
          uploadedAt: Date.now(),
          server,
          ...(previewHash ? { previewHash } : {}),
          // Always record chunk hashes — even for a single chunk — so the download
          // path knows to use the raw-binary aesGcmDecryptBytes format that
          // aesGcmEncryptBytes produces. Files without this field (legacy uploads)
          // fall back to the base64-string decryptFileWithKey path.
          chunks: hashes,
          encryptionKey: privateKeyHex,
          encryptionAlgorithm: "aes-gcm",
        };

        await saveFileMetadata(metadata);
        setFiles((prev) => [metadata, ...prev]);
        return metadata;
      } catch (e) {
        if (isAbortError(e)) {
          toast.info("Upload cancelled");
          throw e;
        }
        const errorMsg = e instanceof Error ? e.message : "Upload failed";
        setError(errorMsg);
        toast.error(errorMsg, {
          action: { label: "Retry", onClick: () => void uploadPreparedFile(file, server, targetFolder) },
        });
        throw e;
      } finally {
        setUploadProgress(null);
        uploadAbortRef.current = null;
      }
    },
    [toast, uploadPreparedFileNative],
  );

  const uploadFile = useCallback(
    async (file: File, server: string) => {
      await uploadPreparedFile(file, server, currentFolder);
    },
    [currentFolder, uploadPreparedFile],
  );

  const cancelUpload = useCallback(() => {
    uploadAbortRef.current?.abort();
    if (nativeUploadIdRef.current) {
      void cancelNativeUpload(nativeUploadIdRef.current);
    }
  }, []);

  const downloadFile = useCallback(
    async (file: FileMetadata): Promise<{ uri: string | null }> => {
      if (isAndroidPlatform) {
        // Runs in a native foreground service — still surface progress and a
        // cancel affordance in-app in addition to the OS notification.
        await ensureNotificationPermission();
        setDownloadProgress({ fileName: file.name, stage: "Downloading...", progress: 0 });
        try {
          return await downloadFileToDownloads(
            file,
            (percent) => setDownloadProgress({ fileName: file.name, stage: "Downloading...", progress: percent }),
            (cancel) => {
              downloadAbortRef.current = { abort: cancel };
            },
          );
        } catch (e) {
          if (isAbortError(e)) {
            toast.info("Download cancelled");
          }
          throw e;
        } finally {
          setDownloadProgress(null);
          downloadAbortRef.current = null;
        }
      }

      const controller = new AbortController();
      downloadAbortRef.current = controller;

      setDownloadProgress({ fileName: file.name, stage: "Downloading...", progress: 0 });
      try {
        return await downloadFileStreaming(
          file,
          (info) => setDownloadProgress({ fileName: file.name, ...info }),
          controller.signal,
        );
      } catch (e) {
        if (isAbortError(e)) {
          toast.info("Download cancelled");
        }
        throw e;
      } finally {
        setDownloadProgress(null);
        downloadAbortRef.current = null;
      }
    },
    [toast],
  );

  const cancelDownload = useCallback(() => {
    downloadAbortRef.current?.abort();
  }, []);

  const deleteFile = useCallback(
    async (hash: string) => {
      const file = files.find((f) => f.hash === hash);
      if (!file) return;

      await deleteFileMetadata(hash, file);
      setFiles((prev) => prev.filter((f) => f.hash !== hash));
    },
    [files]
  );

  const deleteFiles = useCallback(
    async (hashes: string[]) => {
      const hashSet = new Set(hashes);
      const targetFiles = files.filter((file) => hashSet.has(file.hash));

      for (const file of targetFiles) {
        await deleteFileMetadata(file.hash, file);
      }

      setFiles((prev) => prev.filter((file) => !hashSet.has(file.hash)));
    },
    [files]
  );

  const moveFile = useCallback(
    async (hash: string, newFolder: string) => {
      const file = files.find((f) => f.hash === hash);
      if (!file) return;

      const updated: FileMetadata = { ...file, folder: newFolder };
      await saveFileMetadata(updated);
      setFiles((prev) => prev.map((f) => (f.hash === hash ? updated : f)));
    },
    [files]
  );

  const moveFiles = useCallback(
    async (hashes: string[], newFolder: string) => {
      const hashSet = new Set(hashes);
      const targetFiles = files.filter((file) => hashSet.has(file.hash));

      for (const file of targetFiles) {
        const updated: FileMetadata = { ...file, folder: newFolder };
        await saveFileMetadata(updated);
      }

      setFiles((prev) =>
        prev.map((file) =>
          hashSet.has(file.hash) ? { ...file, folder: newFolder } : file
        )
      );
    },
    [files]
  );

  const renameFile = useCallback(
    async (hash: string, newName: string) => {
      const file = files.find((f) => f.hash === hash);
      if (!file) return;

      const updated: FileMetadata = { ...file, name: newName };
      await saveFileMetadata(updated);
      setFiles((prev) => prev.map((f) => (f.hash === hash ? updated : f)));
    },
    [files]
  );

  const processPendingImports = useCallback(async () => {
    if (!isSignedIn || !pubkey || loading || !hasHydratedIndex) {
      return;
    }

    if (processingPendingImportsRef.current) {
      return;
    }

    processingPendingImportsRef.current = true;
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

          await uploadPreparedFile(
            importedFile,
            selectedServer,
            importPayload.folderPath,
          );
          await removePendingNativeImport(importPayload.id);
        } catch (pendingError) {
          console.error("Failed to process pending Android Files import", pendingError);
          setError(
            pendingError instanceof Error
              ? pendingError.message
              : "Failed to import file saved from Android Files",
          );
          continue;
        }
      }
    } finally {
      processingPendingImportsRef.current = false;
    }
  }, [
    hasHydratedIndex,
    isSignedIn,
    loading,
    pubkey,
    selectedServer,
    uploadPreparedFile,
  ]);

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

  const handleAcceptMigration = async () => {
    await autoMigrateLegacyFiles(legacyFiles);
    setLegacyFiles([]);
  };

  const handleDismissMigration = () => {
    setLegacyFiles([]);
  };

  return (
    <FileIndexContext.Provider
      value={{
        files,
        folders,
        customFolders,
        addCustomFolder,
        currentFolder,
        setCurrentFolder,
        loading,
        hasHydratedIndex,
        error,
        uploadProgress,
        uploadFile,
        cancelUpload,
        downloadProgress,
        downloadFile,
        cancelDownload,
        deleteFile,
        deleteFiles,
        moveFile,
        moveFiles,
        renameFile,
        refresh,
      }}
    >
      <MigrationPromptModal 
        files={legacyFiles} 
        onAccept={handleAcceptMigration} 
        onDismiss={handleDismissMigration} 
      />
      {children}
    </FileIndexContext.Provider>
  );
}
