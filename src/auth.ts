async function computeSha256Hex(data: Uint8Array | Blob): Promise<string> {
  const buffer = data instanceof Blob ? await data.arrayBuffer() : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createAuthEvent(
  verb: "upload" | "get",
  content: string,
  fileOrHash?: Uint8Array | Blob | string,
  expirationSeconds = 60,
) {
  if (!window.nostr || !window.nostr.signEvent)
    throw new Error("No Nostr signer with signEvent");

  const pubkey = await window.nostr.getPublicKey();
  const now = Math.floor(Date.now() / 1000);

  const tags: string[][] = [
    ["t", verb],
    ["expiration", String(now + expirationSeconds)],
  ];

  if (fileOrHash !== undefined) {
    const sha256hex =
      typeof fileOrHash === "string"
        ? fileOrHash
        : await computeSha256Hex(fileOrHash);
    tags.push(["x", sha256hex]);
    tags.push(["payload", sha256hex]);
  }

  const event = {
    kind: 24242,
    pubkey,
    content,
    created_at: now,
    tags,
  };

  const signedEvent = await window.nostr.signEvent(event);
  const b64 = btoa(JSON.stringify(signedEvent));
  return `Nostr ${b64}`;
}
