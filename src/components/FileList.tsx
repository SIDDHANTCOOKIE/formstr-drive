import { useFileIndex } from "../contexts/FileIndexContext";
import { FileCard } from "./FileCard";
import { UploadZone } from "./UploadZone";

export function FileList() {
  const { files, currentFolder, loading } = useFileIndex();

  const currentFiles = files.filter((f) => f.folder === currentFolder);

  if (loading) {
    return (
      <div className="file-list-container">
        <div className="loading-state">Loading files...</div>
      </div>
    );
  }

  return (
    <div className="file-list-container">
      <UploadZone />
      {currentFiles.length === 0 ? (
        <div className="empty-state">
          <p>No files in this folder</p>
          <p className="empty-hint">Drop files above to upload</p>
        </div>
      ) : (
        <div className="file-grid">
          {currentFiles.map((file) => (
            <FileCard key={file.hash} file={file} />
          ))}
        </div>
      )}
    </div>
  );
}
