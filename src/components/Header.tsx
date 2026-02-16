import { useFileIndex } from "../contexts/FileIndexContext";

export function Header() {
  const { isSignedIn, signIn, refresh, loading, currentFolder } = useFileIndex();

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
          <button
            className="refresh-btn"
            onClick={refresh}
            disabled={loading}
            title="Refresh"
          >
            ↻
          </button>
        ) : (
          <button className="sign-in-btn" onClick={signIn}>
            Connect Wallet
          </button>
        )}
      </div>
    </header>
  );
}
