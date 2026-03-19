import { useContext } from "react";
import { BlossomServerContext, type BlossomServerContextType } from "../Provider/BlossomServerProvider";

export function useBlossomServer(): BlossomServerContextType {
  const context = useContext(BlossomServerContext);
  if (!context) {
    throw new Error("useBlossomServer must be used within a BlossomServerProvider");
  }
  return context;
}
