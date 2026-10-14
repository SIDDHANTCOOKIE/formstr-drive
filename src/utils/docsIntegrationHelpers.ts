import type { FileMetadata } from "../types/metadata";

export function isOfficeDoc(file: { type?: string; name?: string }): boolean {
  const normalizedType = (file.type || "").toLowerCase();
  const lowerName = (file.name || "").toLowerCase();

  return (
    normalizedType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    normalizedType === "application/msword" ||
    normalizedType === "application/vnd.oasis.opendocument.text" ||
    lowerName.endsWith(".docx") ||
    lowerName.endsWith(".doc") ||
    lowerName.endsWith(".odt")
  );
}

export function isTextDoc(file: { type?: string; name?: string }): boolean {
  const normalizedType = (file.type || "").toLowerCase();
  const lowerName = (file.name || "").toLowerCase();

  return (
    normalizedType === "text/markdown" ||
    normalizedType === "text/plain" ||
    lowerName.endsWith(".md") ||
    lowerName.endsWith(".markdown") ||
    lowerName.endsWith(".txt")
  );
}

export function canOpenInPages(file: { type?: string; name?: string; chunks?: unknown[]; blobHash?: string }): boolean {
  return isOfficeDoc(file) || isTextDoc(file) || canOpenInNostrDocs(file);
}

export function canOpenInNostrDocs(file: { type?: string; name?: string; chunks?: unknown[]; blobHash?: string }): boolean {
  if (file.chunks && file.chunks.length > 0) {
    return false; // chunked payloads are not supported by the current Nostr Docs app
  }
  return isOfficeDoc(file);
}

export function openInNostrDocs(file: {
  server: string;
  blobHash?: string;
  chunks?: { hash: string }[];
  encryptionKey: string;
  type: string;
  name: string;
}) {
  const hash = file.blobHash ?? file.chunks?.[0]?.hash ?? "";
  const payload = {
    server: file.server,
    hash,
    encryptionKey: file.encryptionKey,
    type: file.type,
    name: file.name,
  };
  const encodedPayload = btoa(JSON.stringify(payload));
  // Hash routing instead of query params to avoid exposing the secret key to the server logs
  const url = `https://pages.formstr.app/#payload=${encodeURIComponent(encodedPayload)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function openInFormstrPages(textContent: string, setPagesHint: (hint: string) => void) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(textContent);
      setPagesHint("Document copied. Paste into Formstr Pages.");
    } else {
      setPagesHint("Opened Formstr Pages. Copy/paste is not available in this browser.");
    }
  } catch {
    setPagesHint("Opened Formstr Pages. Clipboard permission was not granted.");
  } finally {
    window.open("https://pages.formstr.app/", "_blank", "noopener,noreferrer");
  }
}

export function openFileInPages(
  file: FileMetadata,
  options?: {
    textContent?: string | null;
    notify?: (hint: string) => void;
  }
): void {
  const notify = options?.notify ?? (() => {});

  const hash = file.blobHash ?? file.chunks?.[0]?.hash;
  if (file.server && hash && file.encryptionKey) {
    openInNostrDocs(file);
    notify("Opening document in Formstr Pages...");
    return;
  }

  // Fallback if missing blob metadata: open Formstr Pages
  notify("Opening Formstr Pages...");
  window.open("https://pages.formstr.app/", "_blank", "noopener,noreferrer");
}
