import { useContext } from "react";
import { FileIndexContext, type FileIndexContextType } from "../Provider/FileIndexProvider";

export function useFileIndex(): FileIndexContextType {
  const context = useContext(FileIndexContext);
  if (!context) {
    throw new Error("useFileIndex must be used within a FileIndexProvider");
  }
  return context;
}

export default useFileIndex;