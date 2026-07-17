import { useEffect, useMemo, useState } from "react";
import { useFileIndex } from '../../hooks/useFileContext';
import { useToast } from '../../hooks/useToast';
import { FileCard } from "./FileCard";
import { UploadZone } from '../Upload/UploadZone';
import { SearchIcon, GridViewIcon, ListViewIcon, FolderIcon } from '../icons/Icons';

import { isDirectChildFolder, getFolderName } from '../../utils/folder';
import { type SortKey, SORT_LABEL } from '../../utils/constants';

export function FileList() {
  const {
    files,
    folders,
    currentFolder,
    setCurrentFolder,
    loading,
    hasHydratedIndex,
    deleteFiles,
    moveFiles,
  } = useFileIndex();
  const toast = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("newest");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [selectedFileHashes, setSelectedFileHashes] = useState<Set<string>>(new Set());
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

  const currentFiles = useMemo(() => {
    const matches = files
      .filter((f) => f.folder === currentFolder)
      .filter((f) => f.name.toLowerCase().includes(normalizedQuery));

    return [...matches].sort((a, b) => {
      switch (sortKey) {
        case "name":
          return a.name.localeCompare(b.name);
        case "oldest":
          return a.uploadedAt - b.uploadedAt;
        case "largest":
          return b.size - a.size;
        case "smallest":
          return a.size - b.size;
        case "newest":
        default:
          return b.uploadedAt - a.uploadedAt;
      }
    });
  }, [files, currentFolder, normalizedQuery, sortKey]);
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
    setSelectedFileHashes(() => {
      if (allVisibleSelected) {
        return new Set();
      }
      return new Set(currentFiles.map((file) => file.hash));
    });
  };

  const handleClearSelection = () => {
    setSelectedFileHashes(new Set());
  };

  const handleRequestBulkDelete = () => {
    if (selectedCount === 0 || bulkAction !== null) return;

    setShowDeleteDialog(true);
  };

  const handleBulkDelete = async () => {
    if (selectedCount === 0) return;

    setBulkAction("delete");

    try {
      await deleteFiles(selectedFiles.map((file) => file.hash));
      setSelectedFileHashes(new Set());
      setShowDeleteDialog(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk delete failed");
    } finally {
      setBulkAction(null);
    }
  };

  const handleBulkMove = async (folder: string) => {
    if (selectedCount === 0) return;

    setBulkAction("move");

    try {
      await moveFiles(selectedFiles.map((file) => file.hash), folder);
      setSelectedFileHashes(new Set());
      setShowMoveDialog(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk move failed");
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

  if (loading || !hasHydratedIndex) {
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

        <div className="file-list-toolbar">
          <div className="search-wrap">
            <SearchIcon className="search-icon" />
            <input
              type="text"
              className="search-input"
              placeholder="Search in Drive"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="file-list-toolbar-actions">
            <select
              className="sort-select"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              aria-label="Sort by"
            >
              {(Object.keys(SORT_LABEL) as SortKey[]).map((key) => (
                <option key={key} value={key}>
                  {SORT_LABEL[key]}
                </option>
              ))}
            </select>

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
                <GridViewIcon />
              </button>
              <button
                className={`view-btn ${viewMode === "list" ? "active" : ""}`}
                onClick={() => setViewMode("list")}
                title="List view"
              >
                <ListViewIcon />
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
                    <FolderIcon className="folder-tile-icon" />
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
                    <FolderIcon />
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
