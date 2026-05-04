import { useEffect, useMemo, useState } from "react";
import { useFileIndex } from "../hooks/useFileContext";
import { FileCard } from "./FileCard";
import { UploadZone } from "./UploadZone";

function getFolderName(path: string): string {
  if (path === "/") return "My Drive";
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

function isDirectChildFolder(parentFolder: string, candidateFolder: string): boolean {
  if (candidateFolder === "/" || candidateFolder === parentFolder) return false;

  if (parentFolder === "/") {
    return candidateFolder.split("/").filter(Boolean).length === 1;
  }

  if (!candidateFolder.startsWith(`${parentFolder}/`)) return false;
  const relative = candidateFolder.slice(parentFolder.length + 1);
  return relative.length > 0 && !relative.includes("/");
}

export function FileList() {
  const {
    files,
    folders,
    currentFolder,
    setCurrentFolder,
    loading,
    deleteFiles,
    moveFiles,
  } = useFileIndex();
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [selectedFileHashes, setSelectedFileHashes] = useState<Set<string>>(new Set());
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkAction, setBulkAction] = useState<"move" | "delete" | null>(null);
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const isGridView = viewMode === "grid";

  const currentFolders = useMemo(
    () =>
      folders
        .filter((folder) => isDirectChildFolder(currentFolder, folder))
        .filter((folder) => getFolderName(folder).toLowerCase().includes(normalizedQuery)),
    [folders, currentFolder, normalizedQuery]
  );

  const currentFiles = useMemo(
    () =>
      files
        .filter((f) => f.folder === currentFolder)
        .filter((f) => f.name.toLowerCase().includes(normalizedQuery)),
    [files, currentFolder, normalizedQuery]
  );
  const currentFileHashes = useMemo(
    () => new Set(currentFiles.map((file) => file.hash)),
    [currentFiles]
  );
  const selectedFiles = useMemo(
    () => currentFiles.filter((file) => selectedFileHashes.has(file.hash)),
    [currentFiles, selectedFileHashes]
  );
  const selectedCount = selectedFiles.length;
  const allVisibleSelected = currentFiles.length > 0 && selectedCount === currentFiles.length;

  const hasItems = currentFolders.length > 0 || currentFiles.length > 0;

  useEffect(() => {
    setSelectedFileHashes((prev) => {
      const next = new Set(
        Array.from(prev).filter((hash) => currentFileHashes.has(hash))
      );

      if (next.size === prev.size) {
        return prev;
      }

      return next;
    });
  }, [currentFileHashes]);

  useEffect(() => {
    if (selectedCount === 0) {
      setShowMoveDialog(false);
      setShowDeleteDialog(false);
    }
  }, [selectedCount]);

  const toggleFileSelection = (hash: string) => {
    setBulkError(null);
    setSelectedFileHashes((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) {
        next.delete(hash);
      } else {
        next.add(hash);
      }
      return next;
    });
  };

  const handleToggleSelectAll = () => {
    setBulkError(null);
    setSelectedFileHashes(() => {
      if (allVisibleSelected) {
        return new Set();
      }
      return new Set(currentFiles.map((file) => file.hash));
    });
  };

  const handleClearSelection = () => {
    setBulkError(null);
    setSelectedFileHashes(new Set());
  };

  const handleRequestBulkDelete = () => {
    if (selectedCount === 0 || bulkAction !== null) return;

    setBulkError(null);
    setShowDeleteDialog(true);
  };

  const handleBulkDelete = async () => {
    if (selectedCount === 0) return;

    setBulkAction("delete");
    setBulkError(null);

    try {
      await deleteFiles(selectedFiles.map((file) => file.hash));
      setSelectedFileHashes(new Set());
      setShowDeleteDialog(false);
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : "Bulk delete failed");
    } finally {
      setBulkAction(null);
    }
  };

  const handleBulkMove = async (folder: string) => {
    if (selectedCount === 0) return;

    setBulkAction("move");
    setBulkError(null);

    try {
      await moveFiles(selectedFiles.map((file) => file.hash), folder);
      setSelectedFileHashes(new Set());
      setShowMoveDialog(false);
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : "Bulk move failed");
    } finally {
      setBulkAction(null);
    }
  };

  const bulkMoveDialog = showMoveDialog && (
    <div className="move-dialog-overlay" onClick={() => setShowMoveDialog(false)}>
      <div className="move-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="move-dialog-header">
          <h3>Move {selectedCount} Files</h3>
          <button onClick={() => setShowMoveDialog(false)}>×</button>
        </div>
        <div className="move-dialog-body">
          <p className="bulk-action-hint">
            Selected files will be updated one by one. Your signer may ask for
            multiple approvals.
          </p>
          <div className="folder-list-move">
            {folders.map((folder) => (
              <button
                key={folder}
                className={`folder-option ${folder === currentFolder ? "current" : ""}`}
                onClick={() => handleBulkMove(folder)}
                disabled={folder === currentFolder || bulkAction === "move"}
              >
                <span className="folder-icon">📁</span>
                <span className="folder-path">{folder}</span>
                {folder === currentFolder && (
                  <span className="current-badge">Current</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const bulkDeleteDialog = showDeleteDialog && (
    <div
      className="move-dialog-overlay"
      onClick={() => {
        if (bulkAction !== "delete") {
          setShowDeleteDialog(false);
        }
      }}
    >
      <div className="move-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="move-dialog-header">
          <h3>Delete {selectedCount === 1 ? "File" : `${selectedCount} Files`}</h3>
          <button
            onClick={() => setShowDeleteDialog(false)}
            disabled={bulkAction === "delete"}
          >
            ×
          </button>
        </div>
        <div className="move-dialog-body">
          <p className="bulk-action-hint">
            These files will be deleted one by one. Your signer may ask for
            multiple approvals.
          </p>
          <ul className="bulk-delete-list">
            {selectedFiles.map((file) => (
              <li key={file.hash} className="bulk-delete-list-item">
                <span className="bulk-delete-file-name" title={file.name}>
                  {file.name}
                </span>
              </li>
            ))}
          </ul>
          <div className="rename-dialog-actions">
            <button
              onClick={() => setShowDeleteDialog(false)}
              className="cancel-btn"
              disabled={bulkAction === "delete"}
            >
              Cancel
            </button>
            <button
              onClick={handleBulkDelete}
              className="bulk-danger-btn"
              disabled={bulkAction === "delete"}
            >
              {bulkAction === "delete"
                ? "Deleting..."
                : `Delete ${selectedCount === 1 ? "file" : "files"}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-state">Hold tight while we are fetching your files...</div>
        <div className="loader"></div>
      </div>
    );
  }

  return (
    <div className="file-list-container">
      <div className="file-list-scroll" style={selectedCount > 0 ? { paddingBottom: 120 } : undefined}>
        <UploadZone />

        {bulkError && <div className="bulk-action-error">{bulkError}</div>}

        <div className="file-list-toolbar">
          <div className="search-wrap">
            <svg className="search-icon" width="14" height="14" viewBox="0 0 16 16" fill="none">
              <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              className="search-input"
              placeholder="Search in Drive"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="file-list-toolbar-actions">
            <button
              className="bulk-secondary-btn bulk-select-toggle"
              onClick={handleToggleSelectAll}
              disabled={bulkAction !== null || currentFiles.length === 0}
            >
              {allVisibleSelected ? "Deselect all" : "Select all"}
            </button>

            <div className="view-toggle">
              <button
                className={`view-btn ${viewMode === "grid" ? "active" : ""}`}
                onClick={() => setViewMode("grid")}
                title="Grid view"
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
                  <rect x="1" y="1" width="6" height="6" rx="1" />
                  <rect x="9" y="1" width="6" height="6" rx="1" />
                  <rect x="1" y="9" width="6" height="6" rx="1" />
                  <rect x="9" y="9" width="6" height="6" rx="1" />
                </svg>
              </button>
              <button
                className={`view-btn ${viewMode === "list" ? "active" : ""}`}
                onClick={() => setViewMode("list")}
                title="List view"
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
                  <rect x="1" y="2" width="14" height="2" rx="1" />
                  <rect x="1" y="7" width="14" height="2" rx="1" />
                  <rect x="1" y="12" width="14" height="2" rx="1" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {!hasItems ? (
          <div className="empty-state">
            <p>{normalizedQuery ? "No files or folders match your search" : "No files or folders in this folder"}</p>
            <p className="empty-hint">{!normalizedQuery && "Drop files above to upload"}</p>
          </div>
        ) : (
          <div className={isGridView ? "file-grid" : "file-list-view"}>
            {currentFolders.map((folderPath) =>
              isGridView ? (
                <button
                  key={folderPath}
                  type="button"
                  className="folder-tile"
                  onClick={() => setCurrentFolder(folderPath)}
                  title={`Open ${getFolderName(folderPath)}`}
                >
                  <div className="folder-tile-preview">
                    <svg className="folder-tile-icon" viewBox="0 0 24 16" fill="none" aria-hidden="true">
                      <path
                        d="M2 2.5C2 1.67 2.67 1 3.5 1H8.7C9.14 1 9.56 1.2 9.84 1.54L11.18 3.2C11.47 3.56 11.9 3.76 12.36 3.76H20.5C21.33 3.76 22 4.43 22 5.26V13.5C22 14.33 21.33 15 20.5 15H3.5C2.67 15 2 14.33 2 13.5V2.5Z"
                        fill="currentColor"
                      />
                    </svg>
                  </div>
                  <div className="folder-tile-footer">
                    <span className="folder-tile-name" title={getFolderName(folderPath)}>
                      {getFolderName(folderPath)}
                    </span>
                    <span className="folder-tile-meta">Folder</span>
                  </div>
                </button>
              ) : (
                <button
                  key={folderPath}
                  type="button"
                  className="folder-row"
                  onClick={() => setCurrentFolder(folderPath)}
                  title={`Open ${getFolderName(folderPath)}`}
                >
                  <div className="folder-row-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 16" fill="none">
                      <path
                        d="M2 2.5C2 1.67 2.67 1 3.5 1H8.7C9.14 1 9.56 1.2 9.84 1.54L11.18 3.2C11.47 3.56 11.9 3.76 12.36 3.76H20.5C21.33 3.76 22 4.43 22 5.26V13.5C22 14.33 21.33 15 20.5 15H3.5C2.67 15 2 14.33 2 13.5V2.5Z"
                        fill="currentColor"
                      />
                    </svg>
                  </div>
                  <div className="folder-row-info">
                    <span className="folder-row-name" title={getFolderName(folderPath)}>
                      {getFolderName(folderPath)}
                    </span>
                    <span className="folder-row-meta">Folder</span>
                  </div>
                </button>
              )
            )}

            {currentFiles.map((file) => (
              <FileCard
                key={file.hash}
                file={file}
                viewMode={viewMode}
                selected={selectedFileHashes.has(file.hash)}
                onToggleSelection={toggleFileSelection}
              />
            ))}
          </div>
        )}
      </div>

      {selectedCount > 0 && (
        <div className="bulk-action-bar">
          <div className="bulk-action-summary">
            <strong>{selectedCount}</strong> file{selectedCount === 1 ? "" : "s"} selected
          </div>
          <div className="bulk-action-buttons">
            <button
              className="bulk-secondary-btn"
              onClick={() => setShowMoveDialog(true)}
              disabled={bulkAction !== null}
            >
              {bulkAction === "move" ? "Moving..." : "Move selected"}
            </button>
            <button
              className="bulk-danger-btn"
              onClick={handleRequestBulkDelete}
              disabled={bulkAction !== null}
            >
              {bulkAction === "delete" ? "Deleting..." : "Delete selected"}
            </button>
            <button
              className="bulk-clear-btn"
              onClick={handleClearSelection}
              disabled={bulkAction !== null}
            >
              Clear
            </button>
          </div>
        </div>
      )}
      {bulkDeleteDialog}
      {bulkMoveDialog}
    </div>
  );
}
