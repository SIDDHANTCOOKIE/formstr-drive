/**
 * A reference to one encrypted chunk of a file. `server` is optional and only
 * set when the chunk lives on a different Blossom server than the file's
 * primary `server` (per-chunk routing). Older metadata stored chunks as a bare
 * array of hash strings — see {@link chunkHashes} for reading either shape.
 */
export interface ChunkRef {
  hash: string;
  server?: string;
}

export interface FileMetadata {
  name: string;
  hash: string;
  size: number;
  type: string;
  folder: string;
  uploadedAt: number;
  server: string;
  encryptionKey: string; // Hex-encoded private key used to encrypt this file
  encryptionAlgorithm: string;
  deleted?: boolean;
  previewHash?: string;
  chunks?: ChunkRef[];
}

/**
 * Normalizes a file's `chunks` to a list of hash strings, accepting both the
 * current object form (`{ hash, server? }[]`) and the legacy string form
 * (`string[]`) that older published metadata still carries. Keeping this
 * coercion in one place is what makes the object-array migration non-breaking.
 */
export function chunkHashes(
  chunks: ReadonlyArray<ChunkRef | string> | undefined,
): string[] {
  if (!chunks) return [];
  return chunks.map((chunk) => (typeof chunk === "string" ? chunk : chunk.hash));
}

export interface FolderInfo {
  path: string;
  name: string;
  fileCount: number;
}

export interface NostrEvent {
  id?: string;
  kind: number;
  pubkey: string;
  created_at: number;
  tags: string[][];
  content: string;
  sig?: string;
}
