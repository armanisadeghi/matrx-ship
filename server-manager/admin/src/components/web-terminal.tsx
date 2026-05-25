"use client";

// Reusable interactive terminal — xterm.js over the Manager's /api/terminal
// WebSocket → PTY bridge. Drop it anywhere with a `target`:
//   "host" | "container:<name>" | "sandbox:<sandbox_id>"
// (sandbox:* shells in AS THE AGENT USER, in /home/agent.)
//
// Extracted from the standalone /terminal page so the box-detail page (and any
// future surface) gets the exact same native shell without duplicating the
// xterm/WebSocket plumbing.

import { useEffect, useRef, useState, useCallback } from "react";
import "@xterm/xterm/css/xterm.css";
import { Plug, PlugZap, Loader2 } from "lucide-react";
import { Button } from "@matrx/admin-ui/ui/button";
import { Badge } from "@matrx/admin-ui/ui/badge";

type Status = "idle" | "connecting" | "connected" | "closed";

function tokenFromStorage(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("manager_token") || "";
}

export function WebTerminal({
  target,
  heightClass = "h-[60vh]",
  autoConnect = false,
  disabled = false,
  disabledReason,
}: {
  target: string;
  heightClass?: string;
  autoConnect?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const mountRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const termRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fitRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const disconnect = useCallback(() => {
    if (wsRef.current) { try { wsRef.current.close(); } catch { /* */ } wsRef.current = null; }
  }, []);

  const connect = useCallback(async () => {
    disconnect();
    setStatus("connecting");

    const { Terminal } = await import("@xterm/xterm");
    const { FitAddon } = await import("@xterm/addon-fit");

    if (!termRef.current) {
      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        theme: { background: "#09090b", foreground: "#e4e4e7" },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      if (mountRef.current) term.open(mountRef.current);
      fit.fit();
      term.onData((d: string) => { if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(d); });
      termRef.current = term;
      fitRef.current = fit;
    } else {
      termRef.current.reset();
    }
    const term = termRef.current;
    fitRef.current.fit();

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${location.host}/api/terminal?target=${encodeURIComponent(target)}&cols=${term.cols}&rows=${term.rows}`;
    const ws = new WebSocket(url, ["matrx-token", tokenFromStorage()]);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("connected");
      term.focus();
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    };
    ws.onmessage = (e: MessageEvent) => { term.write(typeof e.data === "string" ? e.data : new Uint8Array(e.data)); };
    ws.onclose = () => { setStatus("closed"); try { term.write("\r\n\x1b[90m[disconnected]\x1b[0m\r\n"); } catch { /* */ } };
    ws.onerror = () => { setStatus("closed"); };
  }, [target, disconnect]);

  // Refit on window resize while connected.
  useEffect(() => {
    function onResize() {
      if (fitRef.current && termRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
        fitRef.current.fit();
        wsRef.current.send(JSON.stringify({ type: "resize", cols: termRef.current.cols, rows: termRef.current.rows }));
      }
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Auto-connect once when asked (e.g. when the Terminal tab opens).
  useEffect(() => {
    if (autoConnect && !disabled && status === "idle") void connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnect, disabled]);

  // Clean up on unmount.
  useEffect(() => () => {
    disconnect();
    if (termRef.current) { try { termRef.current.dispose(); } catch { /* */ } termRef.current = null; }
  }, [disconnect]);

  const connected = status === "connected";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Badge variant={connected ? "success" : status === "connecting" ? "secondary" : "outline"} className="text-[10px]">
          {status}
        </Badge>
        <span className="text-xs text-muted-foreground font-mono">{target}</span>
        <div className="flex-1" />
        {connected ? (
          <Button size="sm" variant="destructive" onClick={disconnect}>
            <PlugZap className="size-4" /> Disconnect
          </Button>
        ) : (
          <Button size="sm" disabled={disabled || status === "connecting"} onClick={connect}>
            {status === "connecting" ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />}
            {status === "closed" ? "Reconnect" : "Connect"}
          </Button>
        )}
      </div>
      {disabled && disabledReason && (
        <p className="text-xs text-amber-600 dark:text-amber-400">{disabledReason}</p>
      )}
      <div ref={mountRef} className={`${heightClass} w-full rounded-md bg-[#09090b] overflow-hidden`} />
      <p className="text-xs text-muted-foreground">
        Live shell — sessions are capped at 4 hours and every open is logged in Activity.
      </p>
    </div>
  );
}
