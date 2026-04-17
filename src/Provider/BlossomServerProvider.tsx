import { createContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { SimplePool } from "nostr-tools";
import { APP_RELAYS } from "../utils/common";

const PUBLIC_RELAYS = APP_RELAYS;

const DEFAULT_SERVERS = [
  "https://blossom.primal.net",
  "https://nostr.download",
  "https://blossom.oxtr.dev",
];

interface ServerInfo {
  url: string;
  source: "default" | "relay" | "custom";
}

export interface BlossomServerContextType {
  servers: ServerInfo[];
  selectedServer: string;
  setSelectedServer: (url: string) => void;
  addCustomServer: (url: string) => void;
  loading: boolean;
  error: string | null;
}

export const BlossomServerContext = createContext<BlossomServerContextType | null>(null);

export function BlossomServerProvider({ children }: { children: ReactNode }) {
  const [servers, setServers] = useState<ServerInfo[]>(
    DEFAULT_SERVERS.map((url) => ({ url, source: "default" }))
  );
  const [selectedServer, setSelectedServer] = useState(DEFAULT_SERVERS[0]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const pool = new SimplePool();

    const queryServers = async () => {
      try {
        const events = await pool.querySync(PUBLIC_RELAYS, {
          kinds: [36363],
          limit: 50,
        });

        const relayServers: ServerInfo[] = [];
        const seenUrls = new Set(DEFAULT_SERVERS);

        for (const event of events) {
          const dTag = event.tags.find((t) => t[0] === "d");
          if (dTag && dTag[1]) {
            let url = dTag[1];
            // Normalize URL
            if (!url.startsWith("http://") && !url.startsWith("https://")) {
              url = "https://" + url;
            }
            // Remove trailing slash
            url = url.replace(/\/$/, "");

            if (!seenUrls.has(url)) {
              seenUrls.add(url);
              relayServers.push({ url, source: "relay" });
            }
          }
        }

        setServers((prev) => [
          ...prev.filter((s) => s.source !== "relay"),
          ...relayServers,
        ]);
      } catch (e) {
        console.error("Failed to query relay servers:", e);
        setError("Failed to fetch servers from relays");
      } finally {
        setLoading(false);
        pool.close(PUBLIC_RELAYS);
      }
    };

    queryServers();
  }, []);

  const addCustomServer = useCallback((url: string) => {
    let normalizedUrl = url.trim();
    if (!normalizedUrl.startsWith("http://") && !normalizedUrl.startsWith("https://")) {
      normalizedUrl = "https://" + normalizedUrl;
    }
    normalizedUrl = normalizedUrl.replace(/\/$/, "");

    setServers((prev) => {
      if (prev.some((s) => s.url === normalizedUrl)) {
        return prev;
      }
      return [...prev, { url: normalizedUrl, source: "custom" }];
    });
    setSelectedServer(normalizedUrl);
  }, []);

  return (
    <BlossomServerContext.Provider
      value={{
        servers,
        selectedServer,
        setSelectedServer,
        addCustomServer,
        loading,
        error,
      }}
    >
      {children}
    </BlossomServerContext.Provider>
  );
}
