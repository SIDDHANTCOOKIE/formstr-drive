import { useCallback, useEffect, useRef, useState } from "react";
import type { PluginListenerHandle } from "@capacitor/core";
import type { FileMetadata } from "../types/metadata";
import { downloadFileStreaming } from "../services/downloadFile";
import {
  cancelNativeDownload,
  downloadFileToDownloads,
  ensureNotificationPermission,
  getActiveDownloads,
  subscribeNativeDownloadEvents,
} from "../native/driveManifest";
import { isAndroidPlatform } from "../utils/platform";
import { useToast } from "./useToast";
import { isAbortError } from "../utils/abortError";

export interface DownloadProgress {
  fileName: string;
  stage: string;
  progress?: number;
  currentChunk?: number;
  totalChunks?: number;
}

interface Cancellable {
  abort: () => void;
}

/**
 * Owns the file-download flow (native Android foreground service on device, or
 * the streaming web path elsewhere) plus its in-app progress state and cancel
 * affordance. Extracted from FileIndexProvider to keep that provider focused on
 * index/state management.
 */
export function useDownloader() {
  const toast = useToast();
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const downloadAbortRef = useRef<Cancellable | null>(null);
  const rehydrateListenerRef = useRef<PluginListenerHandle | null>(null);

  const downloadFile = useCallback(
    async (file: FileMetadata): Promise<{ uri: string | null }> => {
      if (isAndroidPlatform) {
        // Runs in a native foreground service — still surface progress and a
        // cancel affordance in-app in addition to the OS notification.
        await ensureNotificationPermission();
        setDownloadProgress({ fileName: file.name, stage: "Downloading...", progress: 0 });
        try {
          return await downloadFileToDownloads(
            file,
            (percent) => setDownloadProgress({ fileName: file.name, stage: "Downloading...", progress: percent }),
            (cancel) => {
              downloadAbortRef.current = { abort: cancel };
            },
          );
        } catch (e) {
          if (isAbortError(e)) {
            toast.info("Download cancelled");
          }
          throw e;
        } finally {
          setDownloadProgress(null);
          downloadAbortRef.current = null;
        }
      }

      const controller = new AbortController();
      downloadAbortRef.current = controller;

      setDownloadProgress({ fileName: file.name, stage: "Downloading...", progress: 0 });
      try {
        return await downloadFileStreaming(
          file,
          (info) => setDownloadProgress({ fileName: file.name, ...info }),
          controller.signal,
        );
      } catch (e) {
        if (isAbortError(e)) {
          toast.info("Download cancelled");
        }
        throw e;
      } finally {
        setDownloadProgress(null);
        downloadAbortRef.current = null;
      }
    },
    [toast],
  );

  const cancelDownload = useCallback(() => {
    downloadAbortRef.current?.abort();
  }, []);

  // Rehydrate in-app progress for a download still running in the native
  // foreground service after the app was reopened (React state was lost but the
  // service kept going). Skips if we're already tracking a download in-app.
  const rehydrateActiveDownload = useCallback(async () => {
    if (!isAndroidPlatform || downloadAbortRef.current) return;

    let active;
    try {
      active = await getActiveDownloads();
    } catch {
      return;
    }
    if (active.length === 0 || downloadAbortRef.current) return;

    const download = active[0];
    setDownloadProgress({
      fileName: download.fileName,
      stage: "Downloading...",
      progress: download.percent,
    });
    downloadAbortRef.current = { abort: () => void cancelNativeDownload(download.id) };

    await rehydrateListenerRef.current?.remove();
    rehydrateListenerRef.current = await subscribeNativeDownloadEvents((event) => {
      if (event.id !== download.id) return;
      if (event.type === "progress" && typeof event.percent === "number") {
        setDownloadProgress({ fileName: download.fileName, stage: "Downloading...", progress: event.percent });
      } else {
        // complete / error / cancelled — stop tracking the rehydrated download.
        setDownloadProgress(null);
        downloadAbortRef.current = null;
        void rehydrateListenerRef.current?.remove();
        rehydrateListenerRef.current = null;
      }
    });
  }, []);

  useEffect(() => {
    if (!isAndroidPlatform) return;
    void rehydrateActiveDownload();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void rehydrateActiveDownload();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      void rehydrateListenerRef.current?.remove();
      rehydrateListenerRef.current = null;
    };
  }, [rehydrateActiveDownload]);

  return { downloadProgress, downloadFile, cancelDownload };
}
