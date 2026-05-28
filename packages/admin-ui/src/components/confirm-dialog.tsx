"use client";

import * as React from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";

// Modal confirmation dialog. Replaces native window.confirm() across the admin
// UI. Use via `useConfirm()` (imperative) or render `<ConfirmDialog>` directly.
//
// Variants:
//   - "default" (blue confirm) — benign actions (refresh, redeploy, migrate)
//   - "destructive" (red confirm) — anything that destroys or wipes data
//   - "warning" (amber confirm) — irreversible-but-not-destructive (recreate)
export type ConfirmVariant = "default" | "warning" | "destructive";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  /** Extra body content rendered between description and footer. */
  children?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  busy = false,
  onConfirm,
}: ConfirmDialogProps) {
  const handleConfirm = async () => {
    try {
      await onConfirm();
    } finally {
      // Caller controls open state explicitly via `busy`; don't auto-close on
      // throw, so they can show the error inline.
    }
  };

  const confirmVariant: React.ComponentProps<typeof Button>["variant"] =
    variant === "destructive" ? "destructive" : variant === "warning" ? "default" : "default";

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="sm:max-w-md" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {variant !== "default" && (
              <AlertTriangle
                className={
                  variant === "destructive" ? "size-5 text-destructive" : "size-5 text-amber-500"
                }
              />
            )}
            {title}
          </DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children && <div className="text-sm text-muted-foreground">{children}</div>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button variant={confirmVariant} disabled={busy} onClick={handleConfirm}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null} {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Imperative confirm() replacement ────────────────────────────────────────
// Drop-in for callers that just want `if (!(await confirm(...))) return;`:
//
//   const confirm = useConfirm();
//   if (!(await confirm({ title: "...", description: "..." }))) return;
//
// Renders one shared dialog and resolves to true/false.

interface ConfirmRequest extends Omit<ConfirmDialogProps, "open" | "onOpenChange" | "onConfirm" | "busy"> {
  /** Resolves true on Confirm, false on Cancel/close. */
}

interface ConfirmContextValue {
  ask: (req: ConfirmRequest) => Promise<boolean>;
}

const ConfirmContext = React.createContext<ConfirmContextValue | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [req, setReq] = React.useState<ConfirmRequest | null>(null);
  const resolverRef = React.useRef<((v: boolean) => void) | null>(null);

  const ask = React.useCallback((r: ConfirmRequest) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setReq(r);
    });
  }, []);

  const close = (result: boolean) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setReq(null);
  };

  return (
    <ConfirmContext.Provider value={{ ask }}>
      {children}
      {req && (
        <ConfirmDialog
          {...req}
          open={true}
          onOpenChange={(v) => { if (!v) close(false); }}
          onConfirm={() => close(true)}
        />
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = React.useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx.ask;
}
