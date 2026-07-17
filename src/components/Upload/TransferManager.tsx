import { isAndroidPlatform } from '../../utils/platform';
import "./UploadManager.css";

export interface TransferProgress {
  fileName: string;
  stage: string;
  progress?: number;
  currentChunk?: number;
  totalChunks?: number;
}

export type TransferType = "upload" | "download";

/**
 * Shared UI for the upload and download progress cards. Upload and download
 * were ~90% identical (icon, circular progress, chunk grid, footer); this
 * component is the single source of truth, branching on `type` only where they
 * genuinely differ (icon, chunk-state labels, and footer copy).
 */
export function TransferManager({
  type,
  progress,
  onCancel,
}: {
  type: TransferType;
  progress: TransferProgress | null;
  onCancel: () => void;
}) {
  if (!progress) return null;

  const isUpload = type === "upload";
  const verb = isUpload ? "Uploading" : "Downloading";
  const cancelLabel = isUpload ? "Cancel upload" : "Cancel download";

  const percent = progress.progress ?? 0;
  const radius = 10;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percent / 100) * circumference;

  const totalChunks = progress.totalChunks || 0;
  const currentChunk = progress.currentChunk || 0;

  // Uploads run two passes (encrypt/hash 0-45%, upload 50-100%); the first pass
  // renders "hashing" chunk states. Downloads are a single pass.
  const isPass2 =
    !isUpload || percent >= 50 || progress.stage === "Upload complete";
  const stageComplete = progress.stage === "Upload complete";

  const chunkClass = (index: number): string => {
    const idx = index + 1;
    if (isPass2) {
      if (idx < currentChunk || stageComplete) return "done";
      if (idx === currentChunk) return "uploading";
      return "pending";
    }
    if (idx < currentChunk) return "hashing-done";
    if (idx === currentChunk) return "hashing";
    return "pending";
  };

  return (
    <div className="upload-manager">
      <div className="upload-manager-header">
        <span className="upload-manager-title">{verb} 1 item</span>
        <button
          className="cancel-transfer-btn"
          onClick={onCancel}
          title={cancelLabel}
          aria-label={cancelLabel}
        >
          ×
        </button>
      </div>
      <div className="upload-manager-body">
        <div className="upload-item">
          <div className="upload-item-icon">
            {isUpload ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="12" y1="18" x2="12" y2="12"></line>
                <polyline points="9 15 12 12 15 15"></polyline>
              </svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
            )}
          </div>
          <div className="upload-item-info">
            <span className="upload-item-name">{progress.fileName}</span>
            <span className="upload-item-stage">{progress.stage}</span>

            {totalChunks > 1 && (
              <div className="chunk-grid">
                {Array.from({ length: totalChunks }).map((_, i) => (
                  <div key={i} className={`chunk-indicator ${chunkClass(i)}`} title={`Chunk ${i + 1}`} />
                ))}
              </div>
            )}
          </div>

          <div className="upload-progress-wrapper">
            <svg className="circular-progress" width="28" height="28" viewBox="0 0 24 24">
              <circle className="progress-bg" cx="12" cy="12" r={radius} strokeWidth="2" />
              <circle
                className="progress-bar"
                cx="12" cy="12" r={radius} strokeWidth="2"
                style={{ strokeDasharray: circumference, strokeDashoffset }}
              />
            </svg>
            <span className="progress-text">{percent}%</span>
          </div>
        </div>
      </div>
      {isAndroidPlatform ? (
        <div className="transfer-info">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
          </svg>
          <span>
            {isUpload
              ? "Keep the app open for best results — uploading needs it to stay active."
              : "File is downloading. You'll be notified when it completes."}
          </span>
        </div>
      ) : (
        <div className="transfer-warning">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
          <span>
            Keep this window open — closing it or navigating away will stop the {isUpload ? "upload" : "download"}.
          </span>
        </div>
      )}
    </div>
  );
}
