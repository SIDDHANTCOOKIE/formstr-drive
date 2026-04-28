import { useProfileContext } from "../../hooks/useProfileContext";
import { isNativePlatform } from "../../utils/platform";

export function SignIn() {
  const { requestPubkey } = useProfileContext();
  const nativeShellMode = isNativePlatform;

  return (
    <div className="sign-in-container">
      <div className="sign-in-card">
        <h1><span>Formstr</span> Drive</h1>
        <p>Encrypted file storage on Nostr</p>

        <button
          className="sign-in-btn-large"
          onClick={requestPubkey}
          disabled={nativeShellMode}
        >
          {nativeShellMode ? "Android signer support coming next" : "Connect with Nostr"}
        </button>

        <p className="sign-in-hint">
          {nativeShellMode
            ? "This Android shell is ready. Signer support will be added in PR 2."
            : "Requires a NIP-07 signer like Alby"}
        </p>
      </div>
    </div>
  );
}
