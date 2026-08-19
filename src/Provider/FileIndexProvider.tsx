import {
  createContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { type FileMetadata } from "../types/metadata";
import {
  observeFileIndex,
  extractFolders,
  clearFileIndexStore,
} from "../services/fileIndex";
import {
  getRelayRefresh,
  subscribeRelayRefresh,
} from "../dataLayer/relayRefresh";
import { useProfileContext } from "../hooks/useProfileContext";
import { getStoredItem, setStoredItem, STORAGE_KEYS } from "../utils/persistence";
import { useBlossomServer } from "../hooks/useBlossomServer";
import { useFileMutations } from "../hooks/useFileMutations";
import { useMetadataOutboxDrain } from "../hooks/useMetadataOutboxDrain";
import { useNativeManifestSync } from "../hooks/useNativeManifestSync";
import { useNativeTransferAdoption } from "../hooks/useNativeTransferAdoption";
import { usePendingNativeImports } from "../hooks/usePendingNativeImports";
import { useTransferExitWarning } from "../hooks/useTransferExitWarning";

// Re-export type if needed anywhere else
export type { FileMetadata };

export interface FileIndexContextType {
  files: FileMetadata[];
  folders: string[];
  customFolders: string[];
  addCustomFolder: (path: string) => void;
  currentFolder: string;
  setCurrentFolder: (folder: string) => void;
  loading: boolean;
  hasHydratedIndex: boolean;
  /** True once the Drive Key is ready — the file list UI should gate only on
   *  this, rendering `files` as they stream in rather than waiting for
   *  hasHydratedIndex (full replay). */
  keyReady: boolean;
  error: string | null;
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

  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [currentFolder, setCurrentFolder] = useState("/");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customFolders, setCustomFolders] = useState<string[]>([]);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [hasHydratedIndex, setHasHydratedIndex] = useState(false);
  // True once the Drive Key keyring has resolved (or definitively failed) —
  // fires well before hasHydratedIndex (which waits for the full relay
  // replay/EOSE). The file list UI should only block on this: once the key
  // is ready, files render as they stream in via onFiles rather than waiting
  // for the whole index to finish hydrating. hasHydratedIndex keeps its
  // existing meaning for the things that genuinely need a complete picture
  // (pending-import processing, native manifest sync) — unaffected by this.
  const [keyReady, setKeyReady] = useState(false);
  const [manualRefreshCount, setManualRefreshCount] = useState(0);

  // Bumps when the relay worker can newly serve cached data it couldn't a
  // moment ago (IndexedDB hydration finished, or the worker restarted after a
  // mobile suspend and lost its interests) — the effect below re-declares the
  // file-index observe against the now-populated store.
  const relayRefresh = useSyncExternalStore(subscribeRelayRefresh, getRelayRefresh);

  // Memoized so `folders` keeps a stable reference across re-renders that
  // don't actually touch files/customFolders — without this, every render
  // (uploadProgress ticks, unrelated parent re-renders, etc.) built a brand
  // new array, which cascaded into a brand new context value below and
  // forced every consumer (sidebar, file list, header) to re-render too.
  const folders = useMemo(() => {
    const foldersFromFiles = extractFolders(files);
    return Array.from(new Set([...foldersFromFiles, ...customFolders])).sort();
  }, [files, customFolders]);

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

  const addCustomFolder = useCallback((path: string) => {
    setCustomFolders((prev) => {
      if (prev.includes(path)) return prev;
      return [...prev, path];
    });
  }, []);

  // Standing file-index interest: cache replay streams files in instantly on a
  // warm start, EOSE (onReady) replaces the old 10-second timeout, and the live
  // tail keeps the list updated as metadata events arrive — including our own
  // publishes, which the local relay stores before any upstream ack.
  useEffect(() => {
    if (restoring) return;
    if (!isSignedIn || !pubkey) {
      // Drop the shared store's state too — otherwise a subsequent sign-in
      // (possibly a different account) would see the previous account's
      // files replayed immediately on subscribe.
      clearFileIndexStore();
      setFiles([]);
      setHasHydratedIndex(false);
      setKeyReady(false);
      return;
    }

    setLoading(true);
    setError(null);

    const unobserve = observeFileIndex(pubkey, {
      onFiles: setFiles,
      onKeyReady: () => setKeyReady(true),
      onReady: () => {
        setHasHydratedIndex(true);
        setLoading(false);
      },
    });

    return unobserve;
  }, [isSignedIn, pubkey, restoring, relayRefresh, manualRefreshCount]);

  // With a standing observe the worker keeps the index synced on its own;
  // a manual refresh just re-declares the interest (cache replay + re-sync).
  const refresh = useCallback(async () => {
    if (!isSignedIn || !pubkey) return;
    setManualRefreshCount((n) => n + 1);
  }, [isSignedIn, pubkey]);

  const { deleteFile, deleteFiles, moveFile, moveFiles, renameFile } =
    useFileMutations(files);

  useTransferExitWarning();
  useNativeTransferAdoption();
  useMetadataOutboxDrain({ isSignedIn, pubkey, restoring, relayRefresh });
  useNativeManifestSync({
    files,
    customFolders,
    isSignedIn,
    pubkey,
    restoring,
    settingsLoaded,
    loading,
    hasHydratedIndex,
  });
  usePendingNativeImports({
    isSignedIn,
    pubkey,
    restoring,
    settingsLoaded,
    loading,
    hasHydratedIndex,
    selectedServer,
    onError: setError,
  });

  // Memoized so the context value's identity only changes when something in
  // it actually changed — otherwise every re-render of this provider (for
  // any reason) handed every consumer a brand new object, forcing them all
  // to re-render too.
  const value = useMemo(
    () => ({
      files,
      folders,
      customFolders,
      addCustomFolder,
      currentFolder,
      setCurrentFolder,
      loading,
      hasHydratedIndex,
      keyReady,
      error,
      deleteFile,
      deleteFiles,
      moveFile,
      moveFiles,
      renameFile,
      refresh,
    }),
    [
      files,
      folders,
      customFolders,
      addCustomFolder,
      currentFolder,
      loading,
      hasHydratedIndex,
      keyReady,
      error,
      deleteFile,
      deleteFiles,
      moveFile,
      moveFiles,
      renameFile,
      refresh,
    ],
  );

  return (
    <FileIndexContext.Provider value={value}>
      {children}
    </FileIndexContext.Provider>
  );
}
