"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import "@xterm/xterm/css/xterm.css";
import { Server, Box, Plug, PlugZap, Loader2 } from "lucide-react";
import { Button } from "@matrx/admin-ui/ui/button";
import { Card, CardContent } from "@matrx/admin-ui/ui/card";
import { Badge } from "@matrx/admin-ui/ui/badge";
import { PageShell } from "@matrx/admin-ui/components/page-shell";
import { useAuth } from "@/lib/auth-context";
import { api, API } from "@/lib/api";

interface Container { name: string; image: string; status: string; state: string }
type Status = "idle" | "connecting" | "connected" | "closed";

function tokenFromStorage(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("manager_token") || "";
}

export default function TerminalPage() {
  const { authed, role } = useAuth();
  const isAdmin = role === "admin";

  const [containers, setContainers] = useState<Container[]>([]);
  const [target, setTarget] = useState("host");
  const [status, setStatus] = useState<Status>("idle");

  const mountRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const termRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fitRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!authed) return;
    api<{ containers: Container[] }>(API.CONTAINERS)
      .then((d) => setContainers((d.containers || []).filter((c) => c.state === "running")))
      .catch(() => {});
  }, [authed]);

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
    const fit = fitRef.current;
    fit.fit();

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
    ws.onclose = () => { setStatus("closed"); term.write("\r\n\x1b[90m[disconnected]\x1b[0m\r\n"); };
    ws.onerror = () => { setStatus("closed"); };
  }, [target, disconnect]);

  // Refit on container resize while connected.
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

  // Clean up on unmount.
  useEffect(() => () => { disconnect(); if (termRef.current) { try { termRef.current.dispose(); } catch { /* */ } } }, [disconnect]);

  const connected = status === "connected";

  return (
    <PageShell
      title="Terminal"
      description="A live, interactive shell into the server or any container — straight from the browser, no SSH. Pick a target and connect."
    >
      {!isAdmin && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="pt-5 text-sm">Interactive terminals require the admin role.</CardContent>
        </Card>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          disabled={!isAdmin || connected}
          onClick={() => setTarget("host")}
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${target === "host" ? "border-primary bg-primary/10" : "border-border hover:bg-muted"} disabled:opacity-50`}
        >
          <Server className="size-4" /> Server (/srv)
        </button>
        {containers.map((c) => {
          const t = `container:${c.name}`;
          return (
            <button
              key={c.name}
              type="button"
              disabled={!isAdmin || connected}
              onClick={() => setTarget(t)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-mono ${target === t ? "border-primary bg-primary/10" : "border-border hover:bg-muted"} disabled:opacity-50`}
            >
              <Box className="size-4" /> {c.name}
            </button>
          );
        })}
        <div className="flex-1" />
        <Badge variant={connected ? "success" : status === "connecting" ? "secondary" : "outline"} className="text-[10px]">
          {status}
        </Badge>
        {connected ? (
          <Button size="sm" variant="destructive" onClick={disconnect}>
            <PlugZap className="size-4" /> Disconnect
          </Button>
        ) : (
          <Button size="sm" disabled={!isAdmin || status === "connecting"} onClick={connect}>
            {status === "connecting" ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />} Connect
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-2">
          <div ref={mountRef} className="h-[60vh] w-full rounded-md bg-[#09090b] overflow-hidden" />
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        Connected to <span className="font-mono">{target}</span>. Sessions are capped at 4 hours and every open is logged in Activity.
      </p>
    </PageShell>
  );
}
