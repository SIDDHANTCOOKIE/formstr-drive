import { useState } from "react";
import { useBlossomServer } from "../contexts/BlossomServerContext";
import { useFileIndex } from "../contexts/FileIndexContext";

export function Header() {
  const { servers, selectedServer, setSelectedServer, addCustomServer } = useBlossomServer();
  const { isSignedIn, signIn, refresh, loading, currentFolder } = useFileIndex();
  const [showServerMenu, setShowServerMenu] = useState(false);
  const [customUrl, setCustomUrl] = useState("");

  const handleAddCustom = () => {
    if (customUrl.trim()) {
      addCustomServer(customUrl);
      setCustomUrl("");
    }
  };

  const getBreadcrumb = () => {
    if (currentFolder === "/") return "My Drive";
    const parts = currentFolder.split("/").filter(Boolean);
    return "My Drive / " + parts.join(" / ");
  };

  return (
    <header className="app-header">
      <div className="header-left">
        <h1 className="app-title">Formstr Drive</h1>
        <span className="breadcrumb">{getBreadcrumb()}</span>
      </div>

      <div className="header-right">
        {isSignedIn ? (
          <>
            <button
              className="refresh-btn"
              onClick={refresh}
              disabled={loading}
              title="Refresh"
            >
              ↻
            </button>

            <div className="server-dropdown">
              <button
                className="server-btn"
                onClick={() => setShowServerMenu(!showServerMenu)}
              >
                {new URL(selectedServer).hostname}
              </button>

              {showServerMenu && (
                <div className="server-menu">
                  {servers.map((s) => (
                    <button
                      key={s.url}
                      className={selectedServer === s.url ? "active" : ""}
                      onClick={() => {
                        setSelectedServer(s.url);
                        setShowServerMenu(false);
                      }}
                    >
                      {new URL(s.url).hostname}
                      {s.source !== "default" && (
                        <span className="server-source">{s.source}</span>
                      )}
                    </button>
                  ))}
                  <div className="server-menu-divider" />
                  <div className="custom-server-row">
                    <input
                      type="text"
                      value={customUrl}
                      onChange={(e) => setCustomUrl(e.target.value)}
                      placeholder="Add server..."
                      onKeyDown={(e) => e.key === "Enter" && handleAddCustom()}
                    />
                    <button onClick={handleAddCustom}>+</button>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <button className="sign-in-btn" onClick={signIn}>
            Connect Wallet
          </button>
        )}
      </div>
    </header>
  );
}
