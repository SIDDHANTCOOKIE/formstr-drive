import { useProfileContext } from "../../hooks/useProfileContext";
export function SignIn() {
  
  const { requestPubkey } = useProfileContext();
  return (
    <div className="sign-in-container">
      <div className="sign-in-card">
        <h1><span>Formstr</span> Drive</h1>
        <p>Encrypted file storage on Nostr</p>

        <button className="sign-in-btn-large" onClick={requestPubkey}>
          Connect with Nostr
        </button>

        <p className="sign-in-hint">
          Requires a NIP-07 signer like Alby
        </p>
      </div>
    </div>
  );
}
