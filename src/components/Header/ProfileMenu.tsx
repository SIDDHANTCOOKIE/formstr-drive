import { useEffect, useRef, useState } from "react";
import { NostrAvatar } from "./NostrAvatar";
import { AddAccountModal } from "./AddAccountModal";
import { useProfileContext } from "../../hooks/useProfileContext";
import { useTheme } from "../../hooks/useTheme";
import { useBlossomServer } from "../../hooks/useBlossomServer";
import { PALETTES, type Palette } from "../../context/ThemeProvider";
import { SunIcon, MoonIcon } from "../ui/ThemeIcons";
import "./ProfileMenu.css";

const PALETTE_LABEL: Record<Palette, string> = {
  ember: "Ember",
  violet: "Violet",
  ocean: "Ocean",
  forest: "Forest",
};

// Swatch preview colors only — the app itself reads --fs-accent-500 under
// the matching [data-palette] block, not these literals.
const PALETTE_SWATCH: Record<Palette, string> = {
  ember: "#FF5733",
  violet: "#8B5CF6",
  ocean: "#0066CC",
  forest: "#1E8E3E",
};

function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function truncateNpub(npub: string): string {
  return npub.length > 20 ? `${npub.slice(0, 12)}…${npub.slice(-4)}` : npub;
}

export function ProfileMenu() {
  const { pubkey, logout, requestPubkey, accounts, switchAccount, removeAccount } =
    useProfileContext();
  const { theme, toggleTheme, palette, setPalette } = useTheme();
  const { servers, selectedServer, setSelectedServer, addCustomServer } = useBlossomServer();
  const [open, setOpen] = useState(false);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [customUrl, setCustomUrl] = useState("");
  const [customServerError, setCustomServerError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const handleAddCustomServer = () => {
    if (!customUrl.trim()) return;
    try {
      addCustomServer(customUrl);
      setCustomUrl("");
      setCustomServerError(null);
    } catch (e) {
      setCustomServerError(e instanceof Error ? e.message : "Invalid server URL");
    }
  };

  return (
    <div className="profile-menu" ref={rootRef}>
      <button
        className="profile-menu-trigger"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-label="Account menu"
        aria-expanded={open}
      >
        <NostrAvatar pubkey={pubkey} />
      </button>

      {open && (
        <div className="profile-menu-panel" role="menu">
          {pubkey && accounts.length > 0 ? (
            <div className="profile-menu-section">
              <p className="profile-menu-label">Accounts</p>
              <div className="profile-menu-accounts">
                {accounts.map((account) => (
                  <div
                    key={account.pubkey}
                    className={`profile-menu-account${account.pubkey === pubkey ? " is-active" : ""}`}
                  >
                    <button
                      className="profile-menu-row-btn profile-menu-account-switch"
                      onClick={() => {
                        if (account.pubkey !== pubkey) {
                          void switchAccount(account.pubkey);
                        }
                        setOpen(false);
                      }}
                      title={account.npub}
                    >
                      {account.pubkey === pubkey && <span className="profile-menu-account-dot" />}
                      <span>{truncateNpub(account.npub)}</span>
                    </button>
                    <button
                      className="profile-menu-account-remove"
                      onClick={() => void removeAccount(account.pubkey)}
                      aria-label={`Remove ${truncateNpub(account.npub)}`}
                      title="Remove account"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <div className="profile-menu-account-actions">
                <button
                  className="profile-menu-row-btn"
                  onClick={() => {
                    setShowAddAccount(true);
                    setOpen(false);
                  }}
                >
                  + Add account
                </button>
                <button
                  className="profile-menu-row-btn profile-menu-row-btn--danger"
                  onClick={() => {
                    void logout();
                    setOpen(false);
                  }}
                >
                  Logout
                </button>
              </div>
            </div>
          ) : (
            <div className="profile-menu-section">
              {pubkey ? (
                <button
                  className="profile-menu-row-btn"
                  onClick={() => {
                    void logout();
                    setOpen(false);
                  }}
                >
                  Logout
                </button>
              ) : (
                <button
                  className="profile-menu-row-btn"
                  onClick={() => {
                    void requestPubkey();
                    setOpen(false);
                  }}
                >
                  Login
                </button>
              )}
            </div>
          )}

          <div className="profile-menu-section">
            <div className="profile-menu-appearance">
              <button
                className="profile-menu-theme-toggle"
                onClick={toggleTheme}
                title={theme === "dark" ? "Switch to light" : "Switch to dark"}
                aria-label={theme === "dark" ? "Switch to light" : "Switch to dark"}
              >
                {theme === "dark" ? <MoonIcon /> : <SunIcon />}
              </button>
              <div className="profile-menu-appearance-divider" />
              <div className="profile-menu-row">
                {PALETTES.map((p) => (
                  <button
                    key={p}
                    className={`profile-menu-swatch${palette === p ? " is-active" : ""}`}
                    style={{ background: PALETTE_SWATCH[p] }}
                    title={PALETTE_LABEL[p]}
                    aria-label={PALETTE_LABEL[p]}
                    onClick={() => setPalette(p)}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="profile-menu-section">
            <p className="profile-menu-label">Upload to</p>
            <select
              className="profile-menu-row-btn profile-menu-select"
              value={selectedServer}
              onChange={(e) => setSelectedServer(e.target.value)}
            >
              {servers.map((s) => (
                <option key={s.url} value={s.url}>
                  {getHostname(s.url)}
                  {s.source !== "default" ? ` (${s.source})` : ""}
                </option>
              ))}
            </select>
            <div className="profile-menu-add-server">
              <input
                className="profile-menu-row-btn"
                type="text"
                value={customUrl}
                onChange={(e) => {
                  setCustomUrl(e.target.value);
                  setCustomServerError(null);
                }}
                placeholder="Add server..."
                onKeyDown={(e) => e.key === "Enter" && handleAddCustomServer()}
              />
              <button className="profile-menu-add-server-btn" onClick={handleAddCustomServer}>
                +
              </button>
            </div>
            {customServerError && (
              <p className="profile-menu-error">{customServerError}</p>
            )}
          </div>
        </div>
      )}

      {showAddAccount && <AddAccountModal onClose={() => setShowAddAccount(false)} />}
    </div>
  );
}
