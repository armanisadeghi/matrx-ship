"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { DeployTab } from "@/components/deploy/deploy-tab";
import { BuildLogViewer } from "@/components/deploy/build-log-viewer";
import type { BuildInfo, BuildRecord } from "@/lib/types";

export default function DeployPage() {
  const { api } = useAuth();
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployingMgr, setDeployingMgr] = useState(false);
  const [rollingBack, setRollingBack] = useState<string | null>(null);
  const [buildLogs, setBuildLogs] = useState<string[]>([]);
  const [buildPhase, setBuildPhase] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const info = await api("/api/build-info");
      setBuildInfo(info as BuildInfo);
    } catch { /* handled by auth context */ }
    finally { setLoading(false); }
  }, [api]);

  useEffect(() => { loadData(); }, [loadData]);

  async function readStream(url: string, body?: Record<string, unknown>) {
    const token = typeof window !== "undefined" ? localStorage.getItem("deploy_token") || "" : "";
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
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
            else if (eventType === "phase") { setBuildPhase(data.phase); setBuildLogs((prev) => [...prev, `── ${data.message} ──`]); }
            else if (eventType === "done") { toast.success(data.instances_restarted ? `Deploy complete — ${data.instances_restarted.length} instance(s) restarted in ${Math.round((data.duration_ms || 0) / 1000)}s` : data.message || "Operation complete"); setBuildPhase("done"); }
            else if (eventType === "error") { toast.error(`Failed: ${data.error}`); setBuildPhase("error"); }
          } catch { /* skip */ }
        }
      }
    }
  }

  async function handleDeploy(name?: string) {
    setDeploying(true);
    setBuildLogs([]);
    setBuildPhase("starting");
    try { await readStream("/api/rebuild/stream", name ? { name } : {}); loadData(); }
    catch (e) { toast.error(`Deploy failed: ${(e as Error).message}`); setBuildPhase("error"); }
    finally { setDeploying(false); }
  }

  async function handleRollback(tag: string) {
    setRollingBack(tag);
    const toastId = toast.loading(`Rolling back to ${tag}...`);
    try {
      const result = await api("/api/rollback", { method: "POST", body: JSON.stringify({ tag }) });
      const r = result as { success?: boolean; error?: string; instances_restarted?: string[] };
      if (r.success) toast.success(`Rolled back to ${tag} — ${r.instances_restarted?.length || 0} instance(s) restarted`, { id: toastId });
      else toast.error(`Rollback failed: ${r.error}`, { id: toastId });
      loadData();
    } catch (e) { toast.error(`Rollback failed: ${(e as Error).message}`, { id: toastId }); }
    finally { setRollingBack(null); }
  }

  async function handleRebuildManager() {
    setDeployingMgr(true);
    setBuildLogs([]);
    setBuildPhase("self-rebuild");
    try { await readStream("/api/self-rebuild/stream"); }
    catch { toast.info("Server Manager is rebuilding. Connection may drop."); setBuildPhase("done"); }
    finally { setDeployingMgr(false); }
  }

  async function handleCleanup() {
    const toastId = toast.loading("Running image cleanup...");
    try {
      const result = await api("/api/build-cleanup", { method: "POST" });
      const r = result as { removed?: string[]; kept?: string[] };
      toast.success(`Cleanup done: removed ${r.removed?.length || 0} tag(s)`, { id: toastId });
      loadData();
    } catch (e) { toast.error(`Cleanup failed: ${(e as Error).message}`, { id: toastId }); }
  }

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="size-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-6">
      {buildInfo && (
        <DeployTab
          buildInfo={buildInfo}
          deploying={deploying}
          deployingMgr={deployingMgr}
          rollingBack={rollingBack}
          onDeploy={handleDeploy}
          onRollback={handleRollback}
          onRebuildManager={handleRebuildManager}
          onCleanup={handleCleanup}
        />
      )}
      <BuildLogViewer
        buildLogs={buildLogs}
        buildPhase={buildPhase}
        deploying={deploying}
        deployingMgr={deployingMgr}
        onClear={() => { setBuildLogs([]); setBuildPhase(null); }}
      />
    </div>
  );
}
