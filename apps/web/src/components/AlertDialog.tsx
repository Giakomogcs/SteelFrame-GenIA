"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type DialogVariant = "default" | "danger";

interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: DialogVariant;
}

interface AlertOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  variant?: DialogVariant;
}

interface DialogState {
  id: number;
  kind: "confirm" | "alert";
  title: string;
  message?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  variant: DialogVariant;
  resolve: (value: boolean) => void;
}

interface AlertDialogContextValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  alert: (opts: AlertOptions) => Promise<void>;
}

const AlertDialogContext = createContext<AlertDialogContextValue | null>(null);

export function useAlertDialog(): AlertDialogContextValue {
  const ctx = useContext(AlertDialogContext);
  if (!ctx) {
    throw new Error("useAlertDialog must be used inside <AlertDialogProvider>");
  }
  return ctx;
}

export function AlertDialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [mounted, setMounted] = useState(false);
  const idRef = useRef(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        idRef.current += 1;
        setDialog({
          id: idRef.current,
          kind: "confirm",
          title: opts.title,
          message: opts.message,
          confirmLabel: opts.confirmLabel ?? "Confirmar",
          cancelLabel: opts.cancelLabel ?? "Cancelar",
          variant: opts.variant ?? "default",
          resolve,
        });
      }),
    [],
  );

  const alert = useCallback(
    (opts: AlertOptions) =>
      new Promise<void>((resolve) => {
        idRef.current += 1;
        setDialog({
          id: idRef.current,
          kind: "alert",
          title: opts.title,
          message: opts.message,
          confirmLabel: opts.confirmLabel ?? "OK",
          variant: opts.variant ?? "default",
          resolve: () => resolve(),
        });
      }),
    [],
  );

  const value = useMemo(() => ({ confirm, alert }), [confirm, alert]);

  const close = useCallback(
    (result: boolean) => {
      if (!dialog) return;
      dialog.resolve(result);
      setDialog(null);
    },
    [dialog],
  );

  useEffect(() => {
    if (!dialog) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        close(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, close]);

  return (
    <AlertDialogContext.Provider value={value}>
      {children}
      {mounted && dialog
        ? createPortal(
            <div
              className="alert-dialog-scrim"
              role="presentation"
              onClick={() => close(false)}
            >
              <div
                className={`alert-dialog ${dialog.variant === "danger" ? "is-danger" : ""}`}
                role="alertdialog"
                aria-modal="true"
                aria-labelledby={`alert-dialog-title-${dialog.id}`}
                onClick={(e) => e.stopPropagation()}
              >
                <h2
                  id={`alert-dialog-title-${dialog.id}`}
                  className="alert-dialog-title"
                >
                  {dialog.title}
                </h2>
                {dialog.message ? (
                  <div className="alert-dialog-body">{dialog.message}</div>
                ) : null}
                <div className="alert-dialog-actions">
                  {dialog.kind === "confirm" ? (
                    <button
                      type="button"
                      className="alert-dialog-btn"
                      onClick={() => close(false)}
                      autoFocus
                    >
                      {dialog.cancelLabel}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={`alert-dialog-btn ${dialog.variant === "danger" ? "is-danger" : "is-primary"}`}
                    onClick={() => close(true)}
                    autoFocus={dialog.kind === "alert"}
                  >
                    {dialog.confirmLabel}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </AlertDialogContext.Provider>
  );
}
