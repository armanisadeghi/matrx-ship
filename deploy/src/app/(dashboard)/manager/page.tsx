"use client";

import { useState, useEffect, useCallback } from "react";
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

export default function ManagerPage() {
  const { api } = useAuth();
  const [managerStatus, setManagerStatus] = useState<"unknown" | "running" | "down">("unknown");
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [buildLogs, setBuildLogs] = useState<string[]>([]);
  const [buildPhase, setBuildPhase] = useState<string | null>(null);

  const checkManagerStatus = useCallback(async () => {
    try {
      const res = await fetch("https://manager.dev.codematrx.com/health");
      if (res.ok) {
        setManagerStatus("running");
      } else {
        setManagerStatus("down");
      }
    } catch {
      setManagerStatus("down");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { checkManagerStatus(); }, [checkManagerStatus]);

  async function handleRebuildManager() {
    setRebuilding(true);
    setBuildLogs([]);
    setBuildPhase("self-rebuild");

    const token = typeof window !== "undefined" ? localStorage.getItem("deploy_token") || "" : "";

    try {
      const response = await fetch("/api/self-rebuild/stream", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          let eventType = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) eventType = line.slice(7);
            else if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (eventType === "log") setBuildLogs((prev) => [...prev, data.message]);
                else if (eventType === "phase") { setBuildPhase(data.phase); setBuildLogs((prev) => [...prev, `── ${data.message} ──`]); }
                else if (eventType === "done") { toast.success("Server Manager rebuild complete. Container restarting..."); setBuildPhase("done"); }
                else if (eventType === "error") { toast.error(`Rebuild failed: ${data.error}`); setBuildPhase("error"); }
              } catch { /* skip */ }
            }
          }
        }
      }

      // Poll until manager comes back
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        try {
          const res = await fetch("https://manager.dev.codematrx.com/health");
          if (res.ok) {
            clearInterval(poll);
            toast.success("Server Manager is back online!");
            setRebuilding(false);
            setManagerStatus("running");
          }
        } catch {
          if (attempts > 60) {
            clearInterval(poll);
            setRebuilding(false);
            toast.error("Server Manager didn't come back. Check manually.");
          }
        }
      }, 3000);
    } catch {
      toast.info("Server Manager is rebuilding. Connection may drop as it restarts.");
      setBuildPhase("done");
      setRebuilding(false);
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
                <Wrench className="size-4" /> Rebuild Server Manager
              </CardTitle>
              <CardDescription>
                Rebuild the Server Manager from source, rebuild its Docker image, and restart the container.
              </CardDescription>
            </div>
            <Button onClick={handleRebuildManager} disabled={rebuilding}>
              {rebuilding ? <Loader2 className="size-4 animate-spin" /> : <Wrench className="size-4" />}
              {rebuilding ? "Rebuilding..." : "Rebuild Manager"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This rebuilds <code className="bg-muted px-1 py-0.5 rounded text-xs">/srv/apps/server-manager/</code> and restarts
            the container. The Manager admin UI will briefly disconnect during the restart.
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
