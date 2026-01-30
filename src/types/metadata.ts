export interface FileMetadata {
  name: string;
  hash: string;
  size: number;
  type: string;
  folder: string;
  uploadedAt: number;
  server: string;
  deleted?: boolean;
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
