import { useState, useCallback, useRef } from "react";
import { useFileIndex } from '../../hooks/useFileContext';
import { useBlossomServer } from '../../hooks/useBlossomServer';
import { isAbortError } from '../../utils/abortError';

export function UploadZone() {
  const { uploadFile } = useFileIndex();
  const { selectedServer } = useBlossomServer();
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: FileList) => {
      setError(null);
      setUploading(true);
      const fileArray = Array.from(files);
      const errors: string[] = [];

      for (const file of fileArray) {
        try {
          await uploadFile(file, selectedServer);
        } catch (e) {
          if (isAbortError(e)) {
            break;
          }
          errors.push(`${file.name}: ${e instanceof Error ? e.message : "Upload failed"}`);
        }
      }

      if (errors.length > 0) {
        setError(errors.join("\n"));
      }
      setUploading(false);
    },
    [uploadFile, selectedServer]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
      e.target.value = "";
    }
  };

  return (
    <div className="upload-zone-wrapper">
      <div
        className={`upload-zone ${isDragging ? "dragging" : ""} ${uploading ? "uploading" : ""}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={handleClick}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileChange}
          style={{ display: "none" }}
        />
        {uploading ? (
          <span className="upload-status">
            Uploading...
          </span>
        ) : (
          <span className="upload-prompt">
            Drop files here or click to upload
          </span>
        )}
        {error && <span className="upload-error">{error}</span>}
      </div>
    </div>
  );
}
