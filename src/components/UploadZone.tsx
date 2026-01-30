import { useState, useCallback, useRef } from "react";
import { useFileIndex } from "../contexts/FileIndexContext";
import { useBlossomServer } from "../contexts/BlossomServerContext";

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
      try {
        for (const file of Array.from(files)) {
          await uploadFile(file, selectedServer);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading(false);
      }
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
        <span className="upload-status">Uploading...</span>
      ) : (
        <span className="upload-prompt">
          Drop files here or click to upload
        </span>
      )}
      {error && <span className="upload-error">{error}</span>}
    </div>
  );
}
