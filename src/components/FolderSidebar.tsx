import { useState } from "react";
import { useFileIndex } from "../contexts/FileIndexContext";

export function FolderSidebar() {
  const { folders, currentFolder, setCurrentFolder, files } = useFileIndex();
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);

  const handleCreateFolder = () => {
    if (newFolderName.trim()) {
      const path = currentFolder === "/"
        ? "/" + newFolderName.trim()
        : currentFolder + "/" + newFolderName.trim();
      setCurrentFolder(path);
      setNewFolderName("");
      setShowNewFolder(false);
    }
  };

  const getFileCount = (folder: string) => {
    return files.filter((f) => f.folder === folder).length;
  };

  const getFolderName = (path: string) => {
    if (path === "/") return "My Drive";
    const parts = path.split("/");
    return parts[parts.length - 1];
  };

  const getIndent = (path: string) => {
    if (path === "/") return 0;
    return (path.split("/").length - 1) * 16;
  };

  return (
    <aside className="folder-sidebar">
      <div className="sidebar-header">
        <span>Folders</span>
        <button
          className="new-folder-btn"
          onClick={() => setShowNewFolder(!showNewFolder)}
          title="New folder"
        >
          +
        </button>
      </div>

      {showNewFolder && (
        <div className="new-folder-input">
          <input
            type="text"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateFolder();
              if (e.key === "Escape") setShowNewFolder(false);
            }}
            placeholder="Folder name"
            autoFocus
          />
          <button onClick={handleCreateFolder}>Create</button>
        </div>
      )}

      <nav className="folder-list">
        {folders.map((folder) => (
          <button
            key={folder}
            className={`folder-item ${currentFolder === folder ? "active" : ""}`}
            onClick={() => setCurrentFolder(folder)}
            style={{ paddingLeft: 12 + getIndent(folder) }}
          >
            <span className="folder-icon">
              {folder === "/" ? "◊" : "▸"}
            </span>
            <span className="folder-name">{getFolderName(folder)}</span>
            <span className="folder-count">{getFileCount(folder)}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
