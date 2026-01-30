import { useFileIndex } from "../contexts/FileIndexContext";

export function SignIn() {
  const { signIn, error } = useFileIndex();

  return (
    <div className="sign-in-container">
      <div className="sign-in-card">
        <h1>Formstr Drive</h1>
        <p>Encrypted file storage on Nostr</p>

        <button className="sign-in-btn-large" onClick={signIn}>
          Connect with Nostr
        </button>

        <p className="sign-in-hint">
          Requires a NIP-07 signer like Alby
        </p>

        {error && <p className="sign-in-error">{error}</p>}
      </div>
    </div>
  );
}
