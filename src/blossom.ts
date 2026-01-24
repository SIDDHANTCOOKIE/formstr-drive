export class BlossomClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async upload(blob: Uint8Array, authHeader: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/upload`, {
      method: "PUT",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/octet-stream",
      },
      body: blob as BodyInit, // cast fixes TS
    });

    if (!res.ok) {
      throw new Error(res.headers.get("X-Reason") || res.statusText);
    }
    return res.text();
  }

  async download(sha256: string, authHeader?: string): Promise<Uint8Array> {
    const res = await fetch(`${this.baseUrl}/${sha256}`, {
      headers: authHeader ? { Authorization: authHeader } : {},
    });

    if (!res.ok) {
      throw new Error(res.headers.get("X-Reason") || res.statusText);
    }

    return new Uint8Array(await res.arrayBuffer());
  }
}
