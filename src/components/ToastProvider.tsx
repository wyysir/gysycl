"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";

type Toast = { id: number; message: string; type: "success" | "error" };
type ToastContextValue = {
  showToast: (message: string, type?: "success" | "error") => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const showToast = useCallback(
    (message: string, type: "success" | "error" = "success") => {
      const id = Date.now() + Math.random();
      setToasts((current) => [...current, { id, message, type }]);
      window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, 4200);
    },
    [],
  );
  const value = useMemo(() => ({ showToast }), [showToast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-root" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast toast--${toast.type}`}
          >
            <span className="toast-icon">
              {toast.type === "success" ? (
                <CheckCircle2 size={14} />
              ) : (
                <AlertCircle size={14} />
              )}
            </span>
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast 必须在 ToastProvider 内使用");
  return context;
}
