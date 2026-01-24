import React, { useState } from "react";
import { decryptFile } from "../crypto";
import { createAuthEvent } from "../auth";
import { BlossomClient } from "../blossom";

const SERVER_URL = "http://blossom.primal.net";

export const FileDownload: React.FC = () => {
  const [sha256, setSha256] = useState("");
  const [content, setContent] = useState<Uint8Array | null>(null);

  const client = new BlossomClient(SERVER_URL);

  const handleDownload = async () => {
    const auth = await createAuthEvent("get", `Get ${sha256}`);
    const blob = await client.download(sha256, auth);
    const decrypted = await decryptFile(new TextDecoder().decode(blob));
    setContent(decrypted);
  };

  return (
    <div>
      <input
        type="text"
        value={sha256}
        onChange={(e) => setSha256(e.target.value)}
        placeholder="SHA256"
      />
      <button onClick={handleDownload} disabled={!sha256}>
        Download
      </button>
      {content && <p>Downloaded {content.length} bytes</p>}
    </div>
  );
};
