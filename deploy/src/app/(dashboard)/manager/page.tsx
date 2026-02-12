"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  Activity,
  Terminal,
  RefreshCw,
  Shield,
  HardDrive,
  Clock,
  Settings,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Server,
  Eye,
  EyeOff,
  Download,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/lib/auth-context";
import { BuildLogViewer } from "@/components/deploy/build-log-viewer";

interface ManagerStatus {
  container_name: string;
  container: {
    status: string;
    running: boolean;
    started_at: string;
    health: string | null;
    restart_count: number;
    networks: string[];
  } | null;
  stats: {
    cpu: string;
    mem: string;
    mem_pct: string;
    net: string;
    block: string;
    pids: string;
  } | null;
  health_check: { status: string; uptime: number } | null;
  source: { git_commit: string; git_branch: string };
  url: string;
}

interface EnvVar {
  key: string;
  value: string;
  sensitive: boolean;
}

export default function ManagerPage() {
  const { api } = useAuth();
  const [status, setStatus] = useState<ManagerStatus | null>(null);
  const [logs, setLogs] = useState<string>("");
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);
  const [showSensitive, setShowSensitive] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [buildLogs, setBuildLogs] = useState<string[]>([]);
  const [buildPhase, setBuildPhase] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadStatus = useCallback(async () => {
    try {
      const [s, l, e] = await Promise.all([
        api("/api/manager/status"),
        api("/api/manager/logs?tail=100"),
        api("/api/manager/env"),
      ]);
      setStatus(s as unknown as ManagerStatus);
      setLogs((l as { output?: string }).output || "");
      setEnvVars((e as { vars?: EnvVar[] }).vars || []);
    } catch (err) {
      console.error("Failed to load manager status:", err);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 30000);
    return () => clearInterval(interval);
  }, [loadStatus]);

  async function handleRebuild() {
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

      if (!reader) throw new Error("No response stream");

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
              else if (eventType === "phase") {
                setBuildPhase(data.phase);
                setBuildLogs((prev) => [...prev, `── ${data.message} ──`]);
              } else if (eventType === "done") {
                toast.success(data.message || "Server Manager rebuilt successfully");
                setBuildPhase("done");
              } else if (eventType === "error") {
                toast.error(`Failed: ${data.error}`);
                setBuildPhase("error");
              }
            } catch { /* skip */ }
          }
        }
      }
    } catch {
      toast.info("Server Manager is rebuilding. Connection may drop as it restarts.");
      setBuildPhase("done");
    } finally {
      setRebuilding(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isRunning = status?.container?.running;
  const isHealthy = status?.health_check?.status === "ok";
  const uptime = status?.health_check?.uptime;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Server Manager Control Panel</h1>
          <p className="text-muted-foreground">
            Emergency operations console for the Server Manager
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadStatus}>
            <RefreshCw className="size-4 mr-2" /> Refresh
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleRebuild}
            disabled={rebuilding}
          >
            {rebuilding ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <Settings className="size-4 mr-2" />
            )}
            Rebuild Manager
          </Button>
        </div>
      </div>

      {/* Status Dashboard */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              {isRunning ? (
                <CheckCircle2 className="size-5 text-green-500" />
              ) : (
                <AlertTriangle className="size-5 text-red-500" />
              )}
              <div>
                <p className="text-sm font-medium text-muted-foreground">Status</p>
                <p className="text-lg font-semibold">
                  {status?.container?.status || "Unknown"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Activity className="size-5 text-blue-500" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Health</p>
                <p className="text-lg font-semibold">
                  {isHealthy ? "Healthy" : status?.container?.health || "Unknown"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Clock className="size-5 text-purple-500" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Uptime</p>
                <p className="text-lg font-semibold">
                  {uptime ? `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m` : "N/A"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <HardDrive className="size-5 text-orange-500" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">Resources</p>
                <p className="text-sm font-semibold">
                  {status?.stats ? `${status.stats.cpu} CPU / ${status.stats.mem_pct} Mem` : "N/A"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Resource details */}
      {status?.stats && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Server className="size-4" /> Resource Usage
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <p className="text-sm text-muted-foreground">Memory</p>
                <p className="font-mono text-sm">{status.stats.mem}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Network I/O</p>
                <p className="font-mono text-sm">{status.stats.net}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Block I/O</p>
                <p className="font-mono text-sm">{status.stats.block}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Container info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="size-4" /> Container Info
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            <div>
              <p className="text-muted-foreground">Container</p>
              <p className="font-mono">{status?.container_name}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Restarts</p>
              <p className="font-mono">{status?.container?.restart_count ?? "N/A"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Git</p>
              <p className="font-mono">
                {status?.source?.git_branch}@{status?.source?.git_commit}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Networks</p>
              <p className="font-mono">{status?.container?.networks?.join(", ") || "N/A"}</p>
            </div>
          </div>
          <Separator className="my-4" />
          <div className="flex gap-2">
            <a
              href="https://manager.dev.codematrx.com/admin"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" size="sm">
                Open Manager Admin
              </Button>
            </a>
            <a
              href="https://manager.dev.codematrx.com/health"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" size="sm">
                Health Endpoint
              </Button>
            </a>
          </div>
        </CardContent>
      </Card>

      {/* Environment Variables */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="size-4" /> Environment Variables
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowSensitive(!showSensitive)}
            >
              {showSensitive ? (
                <EyeOff className="size-4 mr-1" />
              ) : (
                <Eye className="size-4 mr-1" />
              )}
              {showSensitive ? "Hide" : "Show"} Sensitive
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {envVars.map((v) => (
              <div key={v.key} className="flex items-center gap-2 font-mono text-sm">
                <span className="text-muted-foreground min-w-48">{v.key}</span>
                <span>=</span>
                <span>
                  {v.sensitive && !showSensitive ? "****" : v.value || "(empty)"}
                </span>
                {v.sensitive && (
                  <Badge variant="outline" className="text-[10px] h-4">
                    sensitive
                  </Badge>
                )}
              </div>
            ))}
            {envVars.length === 0 && (
              <p className="text-sm text-muted-foreground">No environment variables found</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Live Logs */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Terminal className="size-4" /> Recent Logs
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={loadStatus}
            >
              <RefreshCw className="size-3.5 mr-1" /> Refresh
            </Button>
          </div>
          <CardDescription>Last 100 log lines from the Server Manager container</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-80 rounded-md border bg-muted/30">
            <pre className="p-4 text-xs font-mono leading-relaxed whitespace-pre-wrap break-all">
              {logs || "No logs available"}
            </pre>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Build Log Viewer (when rebuilding) */}
      {(buildLogs.length > 0 || rebuilding) && (
        <BuildLogViewer
          buildLogs={buildLogs}
          buildPhase={buildPhase}
          deploying={false}
          deployingMgr={rebuilding}
          onClear={() => {
            setBuildLogs([]);
            setBuildPhase(null);
          }}
        />
      )}
    </div>
  );
}
