import { useContext } from "react";
import { ToastContext, type ToastApi } from "../context/ToastProvider";

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context.toast;
}

export default useToast;
