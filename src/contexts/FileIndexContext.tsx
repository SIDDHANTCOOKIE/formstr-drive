import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import type { FileMetadata } from "../types/metadata";
import {
  fetchFileIndex,
  saveFileMetadata,
  deleteFileMetadata,
  extractFolders,
} from "../services/fileIndex";
import { encryptFileWithKey } from "../crypto";
import { createAuthEvent } from "../auth";
import { BlossomClient } from "../blossom";

const CUSTOM_FOLDERS_KEY = "formstr-drive-custom-folders";

interface FileIndexContextType {
  files: FileMetadata[];
  folders: string[];
  customFolders: string[];
  addCustomFolder: (path: string) => void;
  currentFolder: string;
  setCurrentFolder: (folder: string) => void;
  loading: boolean;
  error: string | null;
  uploadFile: (file: File, server: string) => Promise<void>;
  deleteFile: (hash: string) => Promise<void>;
  moveFile: (hash: string, newFolder: string) => Promise<void>;
  renameFile: (hash: string, newName: string) => Promise<void>;
  refresh: () => Promise<void>;
  isSignedIn: boolean;
  signIn: () => Promise<void>;
}

const FileIndexContext = createContext<FileIndexContextType | null>(null);

export function FileIndexProvider({ children }: { children: ReactNode }) {
  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [currentFolder, setCurrentFolder] = useState("/");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [customFolders, setCustomFolders] = useState<string[]>(() => {
    const stored = localStorage.getItem(CUSTOM_FOLDERS_KEY);
    return stored ? JSON.parse(stored) : [];
  });

  // Merge folders from files + custom empty folders
  const foldersFromFiles = extractFolders(files);
  const folders = Array.from(new Set([...foldersFromFiles, ...customFolders])).sort();

  useEffect(() => {
    localStorage.setItem(CUSTOM_FOLDERS_KEY, JSON.stringify(customFolders));
  }, [customFolders]);

  const addCustomFolder = useCallback((path: string) => {
    setCustomFolders(prev => {
      if (prev.includes(path)) return prev;
      return [...prev, path];
    });
  }, []);

  const refresh = useCallback(async () => {
    console.log("[FileIndexContext] Refresh called, isSignedIn:", isSignedIn);
    if (!isSignedIn) return;

    console.log("[FileIndexContext] Setting loading to true");
    setLoading(true);
    setError(null);
    try {
      console.log("[FileIndexContext] Calling fetchFileIndex...");
      const index = await fetchFileIndex();
      console.log("[FileIndexContext] Fetched files:", index);
      setFiles(index);
      console.log("[FileIndexContext] Files state updated");
    } catch (e) {
      console.error("[FileIndexContext] Error during refresh:", e);
      setError(e instanceof Error ? e.message : "Failed to load files");
    } finally {
      console.log("[FileIndexContext] Setting loading to false");
      setLoading(false);
    }
  }, [isSignedIn]);

  const signIn = useCallback(async () => {
    if (!window.nostr) {
      setError("No Nostr signer found. Please install Alby or another NIP-07 extension.");
      return;
    }
    try {
      await window.nostr.getPublicKey();
      setIsSignedIn(true);
    } catch (e) {
      setError("Failed to connect to Nostr signer");
    }
  }, []);

  useEffect(() => {
    if (isSignedIn) {
      refresh();
    }
  }, [isSignedIn, refresh]);

  const uploadFile = useCallback(
    async (file: File, server: string) => {
      setError(null);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());

        // Generate new key and encrypt file
        const { ciphertext, privateKeyHex } = await encryptFileWithKey(bytes);

        const client = new BlossomClient(server);
        const auth = await createAuthEvent("upload", `Upload ${file.name}`);
        const hash = await client.upload(new TextEncoder().encode(ciphertext), auth);

        const metadata: FileMetadata = {
          name: file.name,
          hash,
          size: file.size,
          type: file.type || "application/octet-stream",
          folder: currentFolder,
          uploadedAt: Date.now(),
          server,
          encryptionKey: privateKeyHex,
        };

        await saveFileMetadata(metadata);
        setFiles((prev) => [metadata, ...prev]);
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : "Upload failed";
        setError(errorMsg);
        throw e; // Re-throw so UploadZone can handle it
      }
    },
    [currentFolder]
  );

  const deleteFile = useCallback(async (hash: string) => {
    const file = files.find((f) => f.hash === hash);
    if (!file) return;

    await deleteFileMetadata(hash, file);
    setFiles((prev) => prev.filter((f) => f.hash !== hash));
  }, [files]);

  const moveFile = useCallback(
    async (hash: string, newFolder: string) => {
      const file = files.find((f) => f.hash === hash);
      if (!file) return;

      const updated: FileMetadata = { ...file, folder: newFolder };
      await saveFileMetadata(updated);
      setFiles((prev) =>
        prev.map((f) => (f.hash === hash ? updated : f))
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
      setFiles((prev) =>
        prev.map((f) => (f.hash === hash ? updated : f))
      );
    },
    [files]
  );

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
        error,
        uploadFile,
        deleteFile,
        moveFile,
        renameFile,
        refresh,
        isSignedIn,
        signIn,
      }}
    >
      {children}
    </FileIndexContext.Provider>
  );
}

export function useFileIndex(): FileIndexContextType {
  const context = useContext(FileIndexContext);
  if (!context) {
    throw new Error("useFileIndex must be used within a FileIndexProvider");
  }
  return context;
}
