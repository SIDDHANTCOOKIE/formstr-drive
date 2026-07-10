import { useFileIndex } from "../hooks/useFileContext";
import { TransferManager } from "./TransferManager";

export function DownloadManager() {
  const { downloadProgress, cancelDownload } = useFileIndex();
  return <TransferManager type="download" progress={downloadProgress} onCancel={cancelDownload} />;
}
