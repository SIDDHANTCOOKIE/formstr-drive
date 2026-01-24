import React, { useState } from "react";
import { encryptFile } from "../crypto";
import { createAuthEvent } from "../auth";
import { BlossomClient } from "../blossom";

const SERVER_URL = "https://blossom.primal.net";

export const FileUpload: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [sha256, setSha256] = useState<string | null>(null);

  const client = new BlossomClient(SERVER_URL);

  const handleUpload = async () => {
    console.log("is file?", file);
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ciphertext = await encryptFile(bytes);
    console.log("Encrypted file", ciphertext);
    const auth = await createAuthEvent("upload", `Upload ${file.name}`);
    console.log("Got auth as ", auth);
    const sha = await client.upload(new TextEncoder().encode(ciphertext), auth);
    console.log("Uploaded file", sha);
    setSha256(sha);
  };

  return (
    <div>
      <input
        type="file"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <button onClick={handleUpload} disabled={!file}>
        Upload
      </button>
      {sha256 && <p>Uploaded SHA256: {sha256}</p>}
    </div>
  );
};
