"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

type ToastTone = "success" | "error" | "info";

type ToastInput = {
  message: string;
  tone?: ToastTone;
  durationMs?: number;
};

type ToastItem = {
  id: number;
  message: string;
  tone: ToastTone;
  durationMs: number;
};

type ToastContextValue = {
  showToast: (input: ToastInput | string) => void;
  success: (message: string, durationMs?: number) => void;
  error: (message: string, durationMs?: number) => void;
  info: (message: string, durationMs?: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION_MS = 3000;
const ERROR_DURATION_MS = 5000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idCounterRef = useRef(1);
  const timeoutMapRef = useRef<Record<number, number>>({});

  const clearAllTimeouts = useCallback(() => {
    Object.values(timeoutMapRef.current).forEach((timeoutId) => {
      window.clearTimeout(timeoutId);
    });
    timeoutMapRef.current = {};
  }, []);

  const dismissToast = useCallback((id: number) => {
    const timeoutId = timeoutMapRef.current[id];
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      delete timeoutMapRef.current[id];
    }

    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (input: ToastInput | string) => {
      const payload = typeof input === "string" ? { message: input } : input;
      const tone = payload.tone || "info";
      const durationMs =
        typeof payload.durationMs === "number"
          ? payload.durationMs
          : tone === "error"
            ? ERROR_DURATION_MS
            : DEFAULT_DURATION_MS;
      const id = idCounterRef.current;
      idCounterRef.current += 1;

      setToasts((current) => [
        ...current,
        {
          id,
          message: payload.message,
          tone,
          durationMs,
        },
      ]);

      if (durationMs > 0) {
        const timeoutId = window.setTimeout(() => {
          dismissToast(id);
        }, durationMs);
        timeoutMapRef.current[id] = timeoutId;
      }
    },
    [dismissToast]
  );

  useEffect(() => {
    return () => {
      clearAllTimeouts();
    };
  }, [clearAllTimeouts]);

  const success = useCallback(
    (message: string, durationMs?: number) => {
      showToast({ message, tone: "success", durationMs });
    },
    [showToast]
  );

  const error = useCallback(
    (message: string, durationMs?: number) => {
      showToast({ message, tone: "error", durationMs });
    },
    [showToast]
  );

  const info = useCallback(
    (message: string, durationMs?: number) => {
      showToast({ message, tone: "info", durationMs });
    },
    [showToast]
  );

  const value = useMemo(
    () => ({
      showToast,
      success,
      error,
      info,
    }),
    [showToast, success, error, info]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region toast-region--bottom-right" aria-live="polite" aria-atomic="true">
        {toasts.map((toast) => (
          <div className={`toast toast--${toast.tone}`} key={toast.id} role={toast.tone === "error" ? "alert" : "status"}>
            <p className="toast__message">{toast.message}</p>
            <button
              type="button"
              className="toast__close"
              aria-label="Dismiss notification"
              onClick={() => dismissToast(toast.id)}
            >
              x
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider.");
  }

  return context;
}
