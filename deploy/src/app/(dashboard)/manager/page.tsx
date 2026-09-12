"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Settings, Wrench, Loader2, ExternalLink,
  CheckCircle2, AlertTriangle, Globe, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@matrx/admin-ui/ui/card";
import { Button } from "@matrx/admin-ui/ui/button";
import { Badge } from "@matrx/admin-ui/ui/badge";
import { BuildLogViewer } from "@matrx/admin-ui/components/build-log-viewer";
import { PageShell } from "@matrx/admin-ui/components/page-shell";
import { useAuth } from "@/lib/auth-context";
import { startManagerRecoveryPoll } from "@/lib/manager-recovery-poll";
import { consumeOperationSseEvents } from "@/lib/sse-events";

// Reuses the operation's existing 180s pull, 60s compose, and 90s health
// bounds, plus a small delivery margin.  A lost SSE connection cannot pin UI.
const MANAGER_STREAM_TIMEOUT_MS = 180_000 + 60_000 + 90_000 + 30_000;

export default function ManagerPage() {
  const { api } = useAuth();
  const [managerStatus, setManagerStatus] = useState<"unknown" | "running" | "down">("unknown");
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [buildLogs, setBuildLogs] = useState<string[]>([]);
  const [buildPhase, setBuildPhase] = useState<string | null>(null);
  const recoveryPoll = useRef<ReturnType<typeof startManagerRecoveryPoll> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    // React Strict Mode replays setup → cleanup → setup in development.
    mounted.current = true;
    return () => {
      mounted.current = false;
      recoveryPoll.current?.dispose();
    };
  }, []);

  const checkManagerStatus = useCallback(async () => {
    try {
      const body = await api("/api/manager/status", { cache: "no-store" }) as { health_status?: "unknown" | "running" | "down" };
      setManagerStatus(body.health_status ?? "unknown");
    } catch {
      setManagerStatus("unknown");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { checkManagerStatus(); }, [checkManagerStatus]);

  async function handleRebuildManager() {
    setRebuilding(true);
    setBuildLogs([]);
    setBuildPhase("self-rebuild");

    const token = typeof window !== "undefined" ? localStorage.getItem("deploy_token") || "" : "";
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), MANAGER_STREAM_TIMEOUT_MS);

    try {
      const response = await fetch("/api/self-rebuild/stream", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        signal: controller.signal,
      });

      if (!response.ok) throw new Error(`Stream request failed (${response.status})`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response stream");
      let terminal = false;
      let streamError: string | null = null;
      await consumeOperationSseEvents(reader, ({ event, data }) => {
        if (!mounted.current) return;
        if (event === "log") setBuildLogs((prev) => [...prev, String(data.message)]);
        else if (event === "phase") { setBuildPhase(String(data.phase)); setBuildLogs((prev) => [...prev, `── ${String(data.message)} ──`]); }
        else if (event === "done") { terminal = true; toast.success("Manager updated + recreated (env reloaded)."); setBuildPhase("done"); }
        else if (event === "error") { terminal = true; streamError = String(data.error || "rebuild failed"); setBuildPhase("error"); }
      });

      if (!mounted.current) return;
      if (streamError) throw new Error(streamError);
      if (!terminal) throw new Error("Manager rebuild stream ended without a completion result");
      recoveryPoll.current?.dispose();
      recoveryPoll.current = startManagerRecoveryPoll({
        request: (signal) => api("/api/manager/status", { cache: "no-store", signal }) as Promise<{ health_status?: string }>,
        onRunning: () => { if (mounted.current) { toast.success("Server Manager is back online!"); setRebuilding(false); setManagerStatus("running"); } },
        onDeadline: () => { if (mounted.current) { setRebuilding(false); toast.error("Server Manager didn't come back. Check manually."); } },
      });
    } catch (error) {
      if (!mounted.current) return;
      setBuildPhase("error");
      toast.error(`Manager rebuild was not confirmed: ${(error as Error).message}. Checking availability.`);
      recoveryPoll.current?.dispose();
      recoveryPoll.current = startManagerRecoveryPoll({
        request: (signal) => api("/api/manager/status", { cache: "no-store", signal }) as Promise<{ health_status?: string }>,
        onRunning: () => { if (mounted.current) { toast.info("Server Manager is responding after an interrupted rebuild stream. Verify its update state."); setRebuilding(false); setManagerStatus("running"); } },
        onDeadline: () => { if (mounted.current) { setRebuilding(false); toast.error("Server Manager could not be verified after the interrupted rebuild stream."); } },
      });
    } finally {
      window.clearTimeout(timeout);
    }
  }

  return (
    <PageShell
      title="Manager Control"
      description="Monitor and rebuild the Matrx Server Manager from this emergency interface"
      icon={Settings}
    >
      {/* Manager status */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Server Manager Status</CardTitle>
              <CardDescription className="mt-1">
                <a href="https://manager.dev.codematrx.com/admin/" target="_blank" rel="noopener" className="text-primary hover:underline flex items-center gap-1 mt-1">
                  <ExternalLink className="size-3" /> manager.dev.codematrx.com
                </a>
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={checkManagerStatus}>
                <RefreshCw className="size-4" /> Check
              </Button>
              {loading ? (
                <Badge variant="secondary"><Loader2 className="size-3 animate-spin mr-1" /> checking...</Badge>
              ) : managerStatus === "running" ? (
                <Badge variant="success"><CheckCircle2 className="size-3 mr-1" /> running</Badge>
              ) : managerStatus === "unknown" ? (
                <Badge variant="secondary"><AlertTriangle className="size-3 mr-1" /> unable to verify</Badge>
              ) : (
                <Badge variant="destructive"><AlertTriangle className="size-3 mr-1" /> down</Badge>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Rebuild action */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Wrench className="size-4" /> Update &amp; Restart Server Manager
              </CardTitle>
              <CardDescription>
                Pulls the latest CI-built Manager image from GHCR (best-effort) and force-recreates the container — env changes are re-read on recreate.
              </CardDescription>
            </div>
            <Button onClick={handleRebuildManager} disabled={rebuilding}>
              {rebuilding ? <Loader2 className="size-4 animate-spin" /> : <Wrench className="size-4" />}
              {rebuilding ? "Updating..." : "Update + Restart"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Use this after changing the Manager&apos;s env in Secrets (its own store has no Apply button — this page IS the apply button),
            or to roll it onto the newest CI build without waiting for the deploy poller. The previous image is kept as
            <code className="bg-muted px-1 py-0.5 rounded text-xs">matrx-ship-manager:rollback</code>; the admin UI disconnects briefly during the recreate.
          </p>
        </CardContent>
      </Card>

      {/* Build logs */}
      <BuildLogViewer
        buildLogs={buildLogs}
        buildPhase={buildPhase}
        deploying={false}
        deployingMgr={rebuilding}
        onClear={() => { setBuildLogs([]); setBuildPhase(null); }}
      />
    </PageShell>
  );
}
