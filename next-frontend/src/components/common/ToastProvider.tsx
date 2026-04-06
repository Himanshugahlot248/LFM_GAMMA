"use client";

import React, { createContext, useContext, useMemo, useRef, useState } from "react";

type ToastVariant = "success" | "error" | "info" | "warning";

export type ToastInput = {
  title: string;
  message?: string;
  variant?: ToastVariant;
  durationMs?: number;
};

type Toast = ToastInput & { id: string };

type ToastContextValue = {
  push: (t: ToastInput) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

/** High-contrast toasts: near-opaque dark panel, light yellow border, yellow text. */
function variantStyles() {
  return {
    wrapper: "border-yellow-200/60 bg-zinc-950/98 shadow-lg ring-1 ring-yellow-200/25",
    title: "text-yellow-200",
    message: "text-yellow-100/90",
    dismiss: "text-yellow-300/90 hover:bg-yellow-400/15 hover:text-yellow-200",
  };
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, number>());

  function remove(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
  }

  const api = useMemo<ToastContextValue>(
    () => ({
      push: (t) => {
        const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
        const toast: Toast = {
          id,
          variant: t.variant ?? "info",
          title: t.title,
          message: t.message,
          durationMs: t.durationMs ?? 3500,
        };
        setToasts((prev) => [toast, ...prev].slice(0, 5));

        const timer = window.setTimeout(() => remove(id), toast.durationMs);
        timers.current.set(id, timer);
      },
    }),
    [],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[110] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2">
        {toasts.map((t) => {
          const styles = variantStyles();
          return (
            <div
              key={t.id}
              className={["pointer-events-auto rounded-xl border p-3", styles.wrapper].join(" ")}
              role="status"
              aria-live="polite"
            >
              <div className={["text-sm font-bold", styles.title].join(" ")}>{t.title}</div>
              {t.message ? <div className={["mt-1 text-xs", styles.message].join(" ")}>{t.message}</div> : null}
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => remove(t.id)}
                  className={["rounded-md px-2 py-1 text-[11px] font-semibold transition", styles.dismiss].join(" ")}
                >
                  Dismiss
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}

