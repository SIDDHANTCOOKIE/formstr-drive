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
import { encryptFile } from "../crypto";
import { createAuthEvent } from "../auth";
import { BlossomClient } from "../blossom";

interface FileIndexContextType {
  files: FileMetadata[];
  folders: string[];
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

  const folders = extractFolders(files);

  const refresh = useCallback(async () => {
    if (!isSignedIn) return;

    setLoading(true);
    setError(null);
    try {
      const index = await fetchFileIndex();
      setFiles(index);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load files");
    } finally {
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
      const bytes = new Uint8Array(await file.arrayBuffer());
      const ciphertext = await encryptFile(bytes);

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
      };

      await saveFileMetadata(metadata);
      setFiles((prev) => [metadata, ...prev]);
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
