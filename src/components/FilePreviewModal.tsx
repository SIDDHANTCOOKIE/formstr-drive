import { useEffect, useState } from "react";
import type { FileMetadata } from "../types/metadata";
import { createAuthEvent } from "../auth";
import { BlossomClient } from "../blossom";
import { decryptFileWithKey } from "../crypto";

type PreviewMode = "image" | "video" | "pdf" | "text" | "unsupported";

interface FilePreviewModalProps {
  file: FileMetadata;
  onClose: () => void;
}

function resolvePreviewMode(fileType: string): PreviewMode {
  const normalizedType = fileType.toLowerCase();

  if (normalizedType.startsWith("image/")) return "image";
  if (normalizedType.startsWith("video/")) return "video";
  if (normalizedType === "application/pdf") return "pdf";

  if (
    normalizedType.startsWith("text/") ||
    normalizedType === "application/json" ||
    normalizedType === "application/xml" ||
    normalizedType === "application/javascript" ||
    normalizedType === "application/x-javascript" ||
    normalizedType === "application/yaml" ||
    normalizedType === "application/x-yaml" ||
    normalizedType === "text/markdown"
  ) {
    return "text";
  }

  return "unsupported";
}

function canOpenInNostrDocs(fileType: string, filename: string): boolean {
  const normalizedType = fileType.toLowerCase();
  const lowerName = filename.toLowerCase();

  if (
    normalizedType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    normalizedType === "application/msword" ||
    normalizedType === "application/vnd.oasis.opendocument.text"
  ) {
    return true;
  }

  return lowerName.endsWith(".docx") || lowerName.endsWith(".doc") || lowerName.endsWith(".odt");
}

export function FilePreviewModal({ file, onClose }: FilePreviewModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [pagesHint, setPagesHint] = useState<string | null>(null);

  const mode = resolvePreviewMode(file.type);
  const supportsNostrDocsDeepLink = canOpenInNostrDocs(file.type, file.name);

  const openInNostrDocs = () => {
    const payload = {
      server: file.server,
      hash: file.hash,
      encryptionKey: file.encryptionKey,
      type: file.type,
      name: file.name,
    };
    const encodedPayload = btoa(JSON.stringify(payload));
    const url = `https://pages.formstr.app/drive-import?payload=${encodeURIComponent(encodedPayload)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleOpenInPages = async () => {
    if (!textContent) return;

    try {
      if (navigator.clipboard?.writeText) {
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
  };

  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;

    const loadPreview = async () => {
      setLoading(true);
      setError(null);
      setBlobUrl(null);
      setTextContent(null);

      if (mode === "unsupported") {
        setLoading(false);
        return;
      }

      try {
        const client = new BlossomClient(file.server);
        const auth = await createAuthEvent("get", `Preview ${file.hash}`);
        const encryptedBytes = await client.download(file.hash, auth);
        const ciphertext = new TextDecoder().decode(encryptedBytes);
        const decryptedBytes = await decryptFileWithKey(ciphertext, file.encryptionKey);

        if (cancelled) return;

        if (mode === "text") {
          const decoded = new TextDecoder().decode(decryptedBytes);
          setTextContent(decoded);
          return;
        }

        const blob = new Blob([decryptedBytes as BlobPart], { type: file.type || "application/octet-stream" });
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load preview");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadPreview();

    return () => {
      cancelled = true;
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [file, mode]);

  return (
    <div className="preview-modal-overlay" onClick={onClose}>
      <div className="preview-modal" onClick={(e) => e.stopPropagation()}>
        <div className="preview-modal-header">
          <div className="preview-modal-title-wrap">
            <h3 className="preview-modal-title" title={file.name}>{file.name}</h3>
            <span className="preview-modal-subtitle">{file.type || "Unknown type"}</span>
          </div>
          <button className="preview-modal-close" onClick={onClose} aria-label="Close preview">X</button>
        </div>

        <div className="preview-modal-body">
          {loading && <div className="preview-modal-state">Loading preview...</div>}

          {!loading && error && <div className="preview-modal-state error">{error}</div>}

          {!loading && !error && mode === "unsupported" && (
            <div className="preview-modal-state">
              This file type is uploaded successfully, but in-app preview is not available yet.
              {supportsNostrDocsDeepLink && (
                <>
                  <br />
                  <button className="preview-open-docs-btn" onClick={openInNostrDocs}>
                    Open in Nostr Docs
                  </button>
                </>
              )}
            </div>
          )}

          {!loading && !error && mode === "image" && blobUrl && (
            <img src={blobUrl} alt={file.name} className="preview-media-image" />
          )}

          {!loading && !error && mode === "video" && blobUrl && (
            <video src={blobUrl} className="preview-media-video" controls playsInline>
              Your browser does not support this video format.
            </video>
          )}

          {!loading && !error && mode === "pdf" && blobUrl && (
            <iframe src={blobUrl} className="preview-media-pdf" title={`PDF preview: ${file.name}`} />
          )}

          {!loading && !error && mode === "text" && textContent !== null && (
            <div className="preview-text-wrap">
              <div className="preview-doc-actions">
                <button className="preview-doc-btn" onClick={handleOpenInPages}>
                  Open in Formstr Pages
                </button>
                {pagesHint && <span className="preview-doc-hint">{pagesHint}</span>}
              </div>
              <pre className="preview-text-content">{textContent}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
