import React, { useState } from "react";
import { useBlossomServer } from "../contexts/BlossomServerContext";

export const ServerSelector: React.FC = () => {
  const { servers, selectedServer, setSelectedServer, addCustomServer, loading, error } =
    useBlossomServer();
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customUrl, setCustomUrl] = useState("");

  const handleAddCustom = () => {
    if (customUrl.trim()) {
      addCustomServer(customUrl);
      setCustomUrl("");
      setShowCustomInput(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleAddCustom();
    } else if (e.key === "Escape") {
      setShowCustomInput(false);
      setCustomUrl("");
    }
  };

  const getSourceLabel = (source: string) => {
    switch (source) {
      case "relay":
        return " (from relay)";
      case "custom":
        return " (custom)";
      default:
        return "";
    }
  };

  return (
    <div className="server-selector">
      <label htmlFor="server-select">Blossom Server:</label>
      <div className="server-controls">
        <select
          id="server-select"
          value={selectedServer}
          onChange={(e) => setSelectedServer(e.target.value)}
          disabled={loading}
        >
          {servers.map((server) => (
            <option key={server.url} value={server.url}>
              {server.url}{getSourceLabel(server.source)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setShowCustomInput(!showCustomInput)}
          className="custom-server-button"
        >
          + Custom
        </button>
      </div>

      {showCustomInput && (
        <div className="custom-server-input">
          <input
            type="text"
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="https://your-blossom-server.com"
            autoFocus
          />
          <button type="button" onClick={handleAddCustom}>
            Add
          </button>
        </div>
      )}

      {loading && <p className="loading-text">Loading servers from relays...</p>}
      {error && <p className="error-message">{error}</p>}
    </div>
  );
};
