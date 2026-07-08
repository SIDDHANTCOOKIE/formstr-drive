import { useFileIndex } from "../hooks/useFileContext";
import { isAndroidPlatform } from "../utils/platform";
import "./UploadManager.css";

export function DownloadManager() {
  const { downloadProgress, cancelDownload } = useFileIndex();

  if (!downloadProgress) return null;

  const progress = downloadProgress.progress ?? 0;
  const radius = 10;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  const totalChunks = downloadProgress.totalChunks || 0;
  const currentChunk = downloadProgress.currentChunk || 0;

  return (
    <div className="upload-manager">
      <div className="upload-manager-header">
        <span className="upload-manager-title">Downloading 1 item</span>
        <button className="cancel-transfer-btn" onClick={cancelDownload} title="Cancel download" aria-label="Cancel download">
          ×
        </button>
      </div>
      <div className="upload-manager-body">
        <div className="upload-item">
          <div className="upload-item-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
          </div>
          <div className="upload-item-info">
            <span className="upload-item-name">{downloadProgress.fileName}</span>
            <span className="upload-item-stage">{downloadProgress.stage}</span>

            {totalChunks > 1 && (
              <div className="chunk-grid">
                {Array.from({ length: totalChunks }).map((_, i) => {
                  let status = "pending";
                  if (i + 1 < currentChunk) status = "done";
                  else if (i + 1 === currentChunk) status = "uploading";
                  return <div key={i} className={`chunk-indicator ${status}`} title={`Chunk ${i + 1}`} />;
                })}
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
            <span className="progress-text">{progress}%</span>
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
          <span>Downloading in the background — see the notification for progress.</span>
        </div>
      ) : (
        <div className="transfer-warning">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
          <span>Keep this window open — closing it or navigating away will stop the download.</span>
        </div>
      )}
    </div>
  );
}
