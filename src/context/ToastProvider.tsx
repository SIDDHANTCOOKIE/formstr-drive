import {
  createContext,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type ToastType = "success" | "error" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  action?: ToastAction;
  duration?: number;
}

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
  action?: ToastAction;
  duration: number;
}

export interface ToastApi {
  success: (message: string, options?: ToastOptions) => void;
  error: (message: string, options?: ToastOptions) => void;
  info: (message: string, options?: ToastOptions) => void;
}

interface ToastContextValue {
  toast: ToastApi;
}

const DEFAULT_DURATION: Record<ToastType, number> = {
  success: 4000,
  error: 6000,
  info: 4000,
};

export const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (type: ToastType, message: string, options?: ToastOptions) => {
      const id = ++idRef.current;
      const duration = options?.duration ?? DEFAULT_DURATION[type];
      setToasts((prev) => [...prev, { id, type, message, action: options?.action, duration }]);
      if (duration > 0) {
        setTimeout(() => remove(id), duration);
      }
    },
    [remove]
  );

  const toast = useMemo<ToastApi>(
    () => ({
      success: (message, options) => push("success", message, options),
      error: (message, options) => push("error", message, options),
      info: (message, options) => push("info", message, options),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {createPortal(
        <div className="toast-container">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.type}`} role="status">
              <span className="toast-message">{t.message}</span>
              {t.action && (
                <button
                  className="toast-action"
                  onClick={() => {
                    t.action!.onClick();
                    remove(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              )}
              <button
                className="toast-close"
                onClick={() => remove(t.id)}
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}
