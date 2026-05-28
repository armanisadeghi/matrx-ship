"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Loader2, CheckCircle2, AlertTriangle, Terminal, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@matrx/admin-ui/ui/dialog";
import { Button } from "@matrx/admin-ui/ui/button";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** SSE endpoint to POST + stream from (path includes any query string). */
  url: string;
  title: string;
  description?: string;
  /** Called after the stream finishes (success or failure) so the host page can refresh. */
  onComplete?: (success: boolean) => void;
}

// Modal dialog that POSTs to a server-sent-events build endpoint and streams
// the output into an in-modal terminal. The user can close it once `done` or
// `error` fires; can't accidentally dismiss it mid-build. Replaces the previous
// flow of "navigate to a separate page, click another button, hope it's the
// right one".
//
// Event protocol (matches the Manager's existing streamSpawn / rebuild-missing):
//   event: phase  data: {phase, message}     ── section header line
//   event: log    data: {message}            ── individual log line
//   event: done   data: {success, message}   ── build finished OK
//   event: error  data: {success:false, message} ── build failed
export function BuildStreamDialog({ open, onOpenChange, url, title, description, onComplete }: Props) {
  const [logs, setLogs] = useState<string[]>([]);
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [copied, setCopied] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const startedRef = useRef(false);

  // Copy the entire log buffer to the clipboard. Errors are most useful when
  // the operator can paste them somewhere — into a ticket, a chat with an
  // agent, etc. The user explicitly asked for this after a build failure
  // they couldn't easily share.
  const copyLogs = useCallback(async () => {
    try {
      const text = logs.join("\n");
      // Prefer the async clipboard API; fall back to a hidden textarea for
      // environments where the secure context isn't satisfied (shouldn't
      // happen behind HTTPS but harmless).
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      toast.success(`Copied ${logs.length} log line(s) to clipboard.`);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      toast.error(`Copy failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [logs]);

  useEffect(() => {
    // Auto-scroll to bottom on every new line.
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    if (!open) {
      // Reset state when closed so the next open starts clean.
      setLogs([]);
      setPhase("idle");
      setCopied(false);
      startedRef.current = false;
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;

    const token = typeof window !== "undefined" ? localStorage.getItem("manager_token") || "" : "";
    const ac = new AbortController();
    setPhase("running");
    setLogs([`── ${title} ──`]);

    (async () => {
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          signal: ac.signal,
        });
        if (!resp.ok && resp.headers.get("content-type")?.includes("application/json")) {
          const j = await resp.json();
          throw new Error(j.error || `HTTP ${resp.status}`);
        }
        const reader = resp.body?.getReader();
        if (!reader) throw new Error("No response stream");
        const decoder = new TextDecoder();
        let buffer = "";
        let eventType = "";
        let finalOk: boolean | null = null;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (line.startsWith("event: ")) eventType = line.slice(7).trim();
            else if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (eventType === "log") setLogs((p) => [...p, String(data.message ?? "")]);
                else if (eventType === "phase") setLogs((p) => [...p, `── ${data.message ?? data.phase ?? ""} ──`]);
                else if (eventType === "done") { setLogs((p) => [...p, `✓ ${data.message || "done"}`]); finalOk = true; }
                else if (eventType === "error") { setLogs((p) => [...p, `✗ ${data.message || "failed"}`]); finalOk = false; }
              } catch { /* skip malformed */ }
            }
          }
        }
        setPhase(finalOk === false ? "error" : "done");
        onComplete?.(finalOk !== false);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setLogs((p) => [...p, `✗ ${msg}`]);
        setPhase("error");
        onComplete?.(false);
      }
    })();

    return () => {
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, url]);

  const running = phase === "running";
  return (
    <Dialog open={open} onOpenChange={(v) => !running && onOpenChange(v)}>
      <DialogContent className="sm:max-w-3xl" showCloseButton={!running}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {running ? <Loader2 className="size-5 animate-spin text-primary" /> : phase === "done" ? <CheckCircle2 className="size-5 text-success" /> : phase === "error" ? <AlertTriangle className="size-5 text-destructive" /> : <Terminal className="size-5" />}
            {title}
          </DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div
          ref={logRef}
          className="bg-zinc-950 text-zinc-300 rounded-lg p-3 font-mono text-[11px] leading-relaxed max-h-[55vh] overflow-y-auto whitespace-pre-wrap"
        >
          {logs.length === 0 ? (
            <span className="text-zinc-500">Starting…</span>
          ) : (
            logs.map((line, i) => (
              <div key={i} className={line.startsWith("✗") ? "text-red-400" : line.startsWith("✓") ? "text-green-400" : line.startsWith("──") ? "text-zinc-500" : ""}>{line}</div>
            ))
          )}
        </div>
        <DialogFooter>
          <div className="text-xs text-muted-foreground mr-auto">
            {running ? "Build in progress — close disabled until it finishes." : phase === "done" ? "Build finished successfully." : phase === "error" ? "Build failed — see logs above." : ""}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={copyLogs}
            disabled={logs.length === 0}
            title="Copy the entire log output to your clipboard"
          >
            {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
            {copied ? "Copied" : "Copy logs"}
          </Button>
          <Button variant="outline" disabled={running} onClick={() => onOpenChange(false)}>
            {phase === "error" ? "Close" : "Done"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
