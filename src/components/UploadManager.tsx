import { useFileIndex } from "../hooks/useFileContext";
import { TransferManager } from "./TransferManager";

export function UploadManager() {
  const { uploadProgress, cancelUpload } = useFileIndex();
  return <TransferManager type="upload" progress={uploadProgress} onCancel={cancelUpload} />;
}
