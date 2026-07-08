import { BlossomClient } from "../blossom";
import { aesGcmEncryptBytes, deriveConversationKeyFromHex, encryptFileWithExistingKey } from "../crypto";
import { createAuthEvent } from "../auth";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export const CHUNK_SIZE = 50 * 1024 * 1024; // 50MB chunks

export interface UploadResult {
  hashes: string[];
  size: number;
}

export interface UploadProgressInfo {
  stage: string;
  progress?: number;
  currentChunk?: number;
  totalChunks?: number;
}

interface OpfsTempDir {
  dir: FileSystemDirectoryHandle;
  name: string;
}

async function tryCreateOpfsTempDir(): Promise<OpfsTempDir | null> {
  const storage = navigator.storage as StorageManager & {
    getDirectory?: () => Promise<FileSystemDirectoryHandle>;
  };
  if (!storage || typeof storage.getDirectory !== "function") {
    return null;
  }

  try {
    const root = await storage.getDirectory();
    const name = `formstr-upload-${crypto.randomUUID()}`;
    const dir = await root.getDirectoryHandle(name, { create: true });
    return { dir, name };
  } catch {
    return null;
  }
}

async function removeOpfsTempDir(name: string): Promise<void> {
  try {
    const storage = navigator.storage as StorageManager & {
      getDirectory?: () => Promise<FileSystemDirectoryHandle>;
    };
    const root = await storage.getDirectory!();
    await (root as unknown as { removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> })
      .removeEntry(name, { recursive: true });
  } catch {
    // best-effort cleanup — a leftover OPFS temp dir doesn't break anything
  }
}

function toHexHash(digest: ArrayBuffer): string {
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Upload aborted", "AbortError");
  }
}

export interface PreparedUpload {
  chunkHashes: string[];
  totalSize: number;
  previewHash?: string;
  // In-memory ciphertext (only populated when no onBlob sink is supplied).
  chunkBlobs?: Uint8Array[];
  previewBlob?: Uint8Array;
  // Sink return values (paths) when an onBlob callback stages each blob.
  chunkRefs?: string[];
  previewRef?: string;
}

/**
 * Runs pass 1 (encrypt + hash every chunk, plus the optional preview) without
 * uploading anything. The chunk hashes are exactly what today's uploadFile()
 * pass 1 produces, so callers can sign an auth/metadata event against them
 * before any network I/O happens.
 *
 * If `onBlob` is supplied, each encrypted blob is handed off (e.g. staged to
 * native storage) and then dropped, so peak memory stays around one chunk
 * instead of the whole file. Its return value is collected into chunkRefs /
 * previewRef. Without `onBlob`, blobs are retained in chunkBlobs/previewBlob.
 */
export async function prepareUpload(
  file: File,
  encryptionKeyHex: string,
  signal?: AbortSignal,
  onProgress?: (info: UploadProgressInfo) => void,
  preview?: Uint8Array | null,
  onBlob?: (index: number, bytes: Uint8Array) => Promise<string>,
): Promise<PreparedUpload> {
  const convKey = deriveConversationKeyFromHex(encryptionKeyHex);
  const totalSize = file.size;
  const numChunks = Math.max(1, Math.ceil(totalSize / CHUNK_SIZE));
  const chunkHashes: string[] = [];
  const chunkBlobs: Uint8Array[] = [];
  const chunkRefs: string[] = [];

  for (let i = 0; i < numChunks; i++) {
    throwIfAborted(signal);
    onProgress?.({
      stage: "Encrypting...",
      progress: Math.round((i / numChunks) * 45),
      currentChunk: i + 1,
      totalChunks: numChunks,
    });

    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, totalSize);
    const bytes = new Uint8Array(await file.slice(start, end).arrayBuffer());
    const encBytes = await aesGcmEncryptBytes(bytes, convKey, i);

    const hashBuffer = await crypto.subtle.digest("SHA-256", encBytes as unknown as BufferSource);
    chunkHashes.push(toHexHash(hashBuffer));

    if (onBlob) {
      chunkRefs.push(await onBlob(i, encBytes));
      // encBytes goes out of scope here — memory bounded to ~one chunk.
    } else {
      chunkBlobs.push(encBytes);
    }
  }

  const result: PreparedUpload = { chunkHashes, totalSize };
  if (onBlob) {
    result.chunkRefs = chunkRefs;
  } else {
    result.chunkBlobs = chunkBlobs;
  }

  if (preview) {
    throwIfAborted(signal);
    const encryptedPreview = await encryptFileWithExistingKey(preview, encryptionKeyHex);
    const previewBytes = new TextEncoder().encode(encryptedPreview);
    const hashBuffer = await crypto.subtle.digest("SHA-256", previewBytes as unknown as BufferSource);
    result.previewHash = toHexHash(hashBuffer);
    if (onBlob) {
      result.previewRef = await onBlob(numChunks, previewBytes);
    } else {
      result.previewBlob = previewBytes;
    }
  }

  return result;
}

async function uploadChunkWithRetry(
  client: BlossomClient,
  encBytes: Uint8Array,
  authHeader: string,
  chunkIndex: number,
  numChunks: number,
  startProgress: number,
  chunkWeight: number,
  onProgress?: (info: UploadProgressInfo) => void,
  signal?: AbortSignal,
): Promise<void> {
  let retries = 3;
  let lastErr;

  while (retries > 0) {
    throwIfAborted(signal);
    try {
      await client.upload(encBytes, authHeader, (percent) => {
        onProgress?.({
          stage: "Uploading...",
          progress: Math.round(startProgress + (percent / 100) * chunkWeight),
          currentChunk: chunkIndex + 1,
          totalChunks: numChunks,
        });
      }, signal);
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw err;
      }
      lastErr = err;
      retries--;
      if (retries > 0) {
        onProgress?.({
          stage: "Retrying...",
          progress: Math.round(startProgress),
          currentChunk: chunkIndex + 1,
          totalChunks: numChunks,
        });
        await sleep(3000);
      }
    }
  }

  throw lastErr;
}

export async function uploadFile(
  file: File,
  serverUrl: string,
  encryptionKeyHex: string,
  onProgress?: (info: UploadProgressInfo) => void,
  signal?: AbortSignal,
): Promise<UploadResult> {
  const client = new BlossomClient(serverUrl);
  const convKey = deriveConversationKeyFromHex(encryptionKeyHex);
  const totalSize = file.size;

  if (totalSize <= CHUNK_SIZE) {
    // Single chunk — no chunking needed
    throwIfAborted(signal);
    onProgress?.({ stage: "Encrypting file...", progress: 0, currentChunk: 1, totalChunks: 1 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const encBytes = await aesGcmEncryptBytes(bytes, convKey, 0);
    throwIfAborted(signal);
    onProgress?.({ stage: "Waiting for signature approval...", progress: 50, currentChunk: 1, totalChunks: 1 });
    const auth = await createAuthEvent("upload", `Upload ${file.name}`, encBytes);
    const hash = await client.upload(encBytes, auth, undefined, signal);
    onProgress?.({ stage: "Upload complete", progress: 100, currentChunk: 1, totalChunks: 1 });
    return { hashes: [hash], size: totalSize };
  }

  const numChunks = Math.ceil(totalSize / CHUNK_SIZE);
  const hashes: string[] = [];
  const opfsTemp = await tryCreateOpfsTempDir();

  try {
    if (opfsTemp) {
      // Pass 1: encrypt each chunk once, persist ciphertext to OPFS (off the JS
      // heap), and hash from those bytes. The in-memory encBytes is discarded
      // immediately after the write.
      for (let i = 0; i < numChunks; i++) {
        throwIfAborted(signal);
        onProgress?.({
          stage: "Encrypting...",
          progress: Math.round((i / numChunks) * 45), // first pass is 45%
          currentChunk: i + 1,
          totalChunks: numChunks,
        });

        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, totalSize);
        const bytes = new Uint8Array(await file.slice(start, end).arrayBuffer());
        const encBytes = await aesGcmEncryptBytes(bytes, convKey, i);

        const hashBuffer = await crypto.subtle.digest("SHA-256", encBytes as unknown as BufferSource);
        hashes.push(toHexHash(hashBuffer));

        const chunkHandle = await opfsTemp.dir.getFileHandle(`chunk-${i}.bin`, { create: true });
        const writable = await chunkHandle.createWritable();
        await writable.write(encBytes as unknown as BufferSource);
        await writable.close();
      }

      onProgress?.({
        stage: "Waiting for signature approval...",
        progress: 45,
        currentChunk: numChunks,
        totalChunks: numChunks,
      });
      const authHeader = await createAuthEvent("upload", `Upload ${file.name}`, hashes, 1800);

      // Pass 2: read the already-encrypted ciphertext back from OPFS and
      // upload it directly — no re-encryption needed.
      for (let i = 0; i < numChunks; i++) {
        throwIfAborted(signal);
        const startProgress = 50 + (i / numChunks) * 50;
        const chunkWeight = 50 / numChunks;

        onProgress?.({
          stage: "Uploading...",
          progress: Math.round(startProgress),
          currentChunk: i + 1,
          totalChunks: numChunks,
        });

        const chunkHandle = await opfsTemp.dir.getFileHandle(`chunk-${i}.bin`);
        const chunkFile = await chunkHandle.getFile();
        const encBytes = new Uint8Array(await chunkFile.arrayBuffer());

        await uploadChunkWithRetry(
          client, encBytes, authHeader, i, numChunks, startProgress, chunkWeight, onProgress, signal
        );

        if (i < numChunks - 1) {
          await sleep(1000);
        }
      }

      return { hashes, size: totalSize };
    }

    // Fallback (OPFS unavailable): encrypt twice — deterministic encryption
    // means pass 2 produces identical ciphertext to pass 1, so this is
    // correct, just slower.
    for (let i = 0; i < numChunks; i++) {
      throwIfAborted(signal);
      onProgress?.({
        stage: "Encrypting...",
        progress: Math.round((i / numChunks) * 45),
        currentChunk: i + 1,
        totalChunks: numChunks,
      });
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, totalSize);
      const bytes = new Uint8Array(await file.slice(start, end).arrayBuffer());
      const encBytes = await aesGcmEncryptBytes(bytes, convKey, i);

      const hashBuffer = await crypto.subtle.digest("SHA-256", encBytes as unknown as BufferSource);
      hashes.push(toHexHash(hashBuffer));
    }

    onProgress?.({
      stage: "Waiting for signature approval...",
      progress: 45,
      currentChunk: numChunks,
      totalChunks: numChunks,
    });
    const authHeader = await createAuthEvent("upload", `Upload ${file.name}`, hashes, 1800);

    for (let i = 0; i < numChunks; i++) {
      throwIfAborted(signal);
      const startProgress = 50 + (i / numChunks) * 50;
      const chunkWeight = 50 / numChunks;

      onProgress?.({
        stage: "Uploading...",
        progress: Math.round(startProgress),
        currentChunk: i + 1,
        totalChunks: numChunks,
      });

      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, totalSize);
      const bytes = new Uint8Array(await file.slice(start, end).arrayBuffer());
      const encBytes = await aesGcmEncryptBytes(bytes, convKey, i);

      await uploadChunkWithRetry(
        client, encBytes, authHeader, i, numChunks, startProgress, chunkWeight, onProgress, signal
      );

      if (i < numChunks - 1) {
        await sleep(1000);
      }
    }

    return { hashes, size: totalSize };
  } finally {
    if (opfsTemp) {
      await removeOpfsTempDir(opfsTemp.name);
    }
  }
}
