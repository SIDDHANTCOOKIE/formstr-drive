export async function createAuthEvent(
  verb: "upload" | "get",
  content: string,
  expirationSeconds = 60,
) {
  if (!window.nostr || !window.nostr.signEvent)
    throw new Error("No Nostr signer with signEvent");

  const pubkey = await window.nostr.getPublicKey();
  const now = Math.floor(Date.now() / 1000);

  const event = {
    kind: 24242,
    pubkey,
    content,
    created_at: now,
    tags: [
      ["t", verb],
      ["expiration", String(now + expirationSeconds)],
    ],
  };

  const signedEvent = await window.nostr.signEvent(event);
  const b64 = btoa(JSON.stringify(signedEvent));
  return `Nostr ${b64}`;
}
