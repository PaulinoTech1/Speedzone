"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

export type ToastTone = "success" | "error" | "info";
type ToastEntry = { id: number; tone: ToastTone; message: string };

type ToastContextValue = {
  notify: (tone: ToastTone, message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);
const toastLifetimeMs = 6000;

export function useToast(): ToastContextValue["notify"] {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within a ToastProvider");
  return context.notify;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (tone: ToastTone, message: string) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, tone, message }]);
      setTimeout(() => dismiss(id), toastLifetimeMs);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="admin-toast-stack" aria-label="Notifications">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`admin-toast admin-toast-${toast.tone}`}
            role={toast.tone === "error" ? "alert" : "status"}
          >
            <span>{toast.message}</span>
            <button type="button" aria-label="Dismiss notification" onClick={() => dismiss(toast.id)}>
              &times;
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
