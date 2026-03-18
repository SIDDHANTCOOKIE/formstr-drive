import { useFileIndex } from "../hooks/useFileContext";
import { useIsMobile } from "../hooks/useIsMobile";
import FormstrLogo from "../assets/formstr.svg";
import { NostrAvatar } from "../components/Header/NostrAvatar";
import { useProfileContext } from "../hooks/useProfileContext";
import { MenuOutlined } from "@ant-design/icons";
import { Dropdown, type MenuProps } from "antd";
interface HeaderProps {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const { isSignedIn , logout , requestPubkey } = useProfileContext();
  const { refresh, loading, currentFolder } = useFileIndex();
  const isMobile = useIsMobile();
  const { pubkey } = useProfileContext();
  const getBreadcrumb = () => {
    if (currentFolder === "/") return "My Drive";
    const parts = currentFolder.split("/").filter(Boolean);
    return "My Drive / " + parts.join(" / ");
  };
  const dropdownMenuItems: MenuProps["items"] = [
    pubkey
      ? {
        key: "logout",
        label: <a onClick={logout}>Logout</a>,
      }
      : {
        key: "login",
        label: <a onClick={requestPubkey}>Login</a>,
      }
  ]
  return (
    <header className="app-header">
      <div className="header-left">
        {isMobile && (
            <MenuOutlined 
              onClick={onMenuClick}
            />
        )}
        {/* <h1 className="app-title">Formstr Drive</h1> */}
        <img src={FormstrLogo} alt="Formstr Logo" className="app-logo" />
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
          <button className="sign-in-btn" onClick={requestPubkey}>
            Connect Wallet
          </button>
        )}
        <div>
          <Dropdown
            menu={{
              items: dropdownMenuItems,
            }}
            trigger={["click"]}
          >
            <div
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <NostrAvatar pubkey={pubkey} />
          </div>
          </Dropdown>
        </div>
      </div>
    </header>
  );
}
