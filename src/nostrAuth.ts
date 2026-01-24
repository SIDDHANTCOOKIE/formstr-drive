import { finalizeEvent } from "nostr-tools";

export function createAuthEvent(params: {
  sk: Uint8Array;
  verb: "upload" | "get";
  content: string;
  sha256?: string;
  server?: string;
}) {
  const now = Math.floor(Date.now() / 1000);

  const tags: string[][] = [
    ["t", params.verb],
    ["expiration", String(now + 60)], // 1 minute validity
  ];

  if (params.sha256) {
    tags.push(["x", params.sha256]);
  }

  if (params.server) {
    tags.push(["server", params.server]);
  }

  return finalizeEvent(
    {
      kind: 24242,
      created_at: now,
      content: params.content,
      tags,
    },
    params.sk,
  );
}

export function encodeAuthHeader(event: any): string {
  const json = JSON.stringify(event);
  // Convert UTF-8 string to Base64 in browser
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return `Nostr ${b64}`;
}
