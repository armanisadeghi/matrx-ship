"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { DeployLayout, type DeployView } from "@/components/deploy-layout";
import { LoginScreen } from "@/components/deploy/login-screen";
import { DeployTab } from "@/components/deploy/deploy-tab";
import { HistoryTab } from "@/components/deploy/history-tab";
import { SystemTab } from "@/components/deploy/system-tab";
import { ServicesTab } from "@/components/deploy/services-tab";
import { BuildLogViewer } from "@/components/deploy/build-log-viewer";
import type { BuildInfo, BuildRecord, SystemInfo } from "@/lib/types";

function api(path: string, opts: RequestInit = {}) {
  const token = typeof window !== "undefined" ? localStorage.getItem("deploy_token") || "" : "";
  return fetch(path, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...opts.headers },
    body: opts.body ? (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body)) : undefined,
  }).then(async (r) => {
    const data = await r.json();
    if (r.status === 401) throw new Error("Unauthorized");
    return data;
  });
}

export default function DeployPage() {
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);
  const [buildHistory, setBuildHistory] = useState<BuildRecord[]>([]);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployingMgr, setDeployingMgr] = useState(false);
  const [rollingBack, setRollingBack] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<DeployView>("deploy");
  const [buildLogs, setBuildLogs] = useState<string[]>([]);
  const [buildPhase, setBuildPhase] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [info, hist, sys] = await Promise.all([
        api("/api/build-info"),
        api("/api/build-history?include_failed=true&limit=20"),
        api("/api/system"),
      ]);
      setBuildInfo(info as BuildInfo);
      setBuildHistory(((hist as { builds?: BuildRecord[] }).builds) || []);
      setSystem(sys as SystemInfo);
    } catch (e) {
      if ((e as Error).message === "Unauthorized") {
        setAuthed(false);
        localStorage.removeItem("deploy_token");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authed) {
      const token = localStorage.getItem("deploy_token");
      if (token) {
        api("/api/system")
          .then(() => setAuthed(true))
          .catch(() => setLoading(false));
      } else {
        setLoading(false);
      }
    } else {
      loadData();
    }
  }, [authed, loadData]);

  // ── SSE stream reader ──────────────────────────────────────
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
        if (line.startsWith("event: ")) {
          eventType = line.slice(7);
        } else if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            if (eventType === "log") {
              setBuildLogs((prev) => [...prev, data.message]);
            } else if (eventType === "phase") {
              setBuildPhase(data.phase);
              setBuildLogs((prev) => [...prev, `── ${data.message} ──`]);
            } else if (eventType === "done") {
              toast.success(
                data.instances_restarted
                  ? `Deploy complete — ${data.instances_restarted.length} instance(s) restarted in ${Math.round((data.duration_ms || 0) / 1000)}s`
                  : data.message || "Operation complete"
              );
              setBuildPhase("done");
            } else if (eventType === "error") {
              toast.error(`Failed: ${data.error}`);
              setBuildPhase("error");
            }
          } catch { /* skip malformed JSON */ }
        }
      }
    }
  }

  // ── Action handlers ────────────────────────────────────────
  async function handleDeploy(name?: string) {
    setDeploying(true);
    setBuildLogs([]);
    setBuildPhase("starting");
    try {
      await readStream("/api/rebuild/stream", name ? { name } : {});
      loadData();
    } catch (e) {
      toast.error(`Deploy failed: ${(e as Error).message}`);
      setBuildPhase("error");
    } finally {
      setDeploying(false);
    }
  }

  async function handleRollback(tag: string) {
    setRollingBack(tag);
    const toastId = toast.loading(`Rolling back to ${tag}...`);
    try {
      const result = await api("/api/rollback", { method: "POST", body: JSON.stringify({ tag }) });
      const r = result as { success?: boolean; error?: string; instances_restarted?: string[] };
      if (r.success) {
        toast.success(`Rolled back to ${tag} — ${r.instances_restarted?.length || 0} instance(s) restarted`, { id: toastId });
      } else {
        toast.error(`Rollback failed: ${r.error}`, { id: toastId });
      }
      loadData();
    } catch (e) {
      toast.error(`Rollback failed: ${(e as Error).message}`, { id: toastId });
    } finally {
      setRollingBack(null);
    }
  }

  async function handleRebuildManager() {
    setDeployingMgr(true);
    setBuildLogs([]);
    setBuildPhase("self-rebuild");
    try {
      await readStream("/api/self-rebuild/stream");
    } catch {
      toast.info("Server Manager is rebuilding. Connection may drop as it restarts.");
      setBuildPhase("done");
    } finally {
      setDeployingMgr(false);
    }
  }

  async function handleCleanup() {
    const toastId = toast.loading("Running image cleanup...");
    try {
      const result = await api("/api/build-cleanup", { method: "POST" });
      const r = result as { removed?: string[]; kept?: string[] };
      toast.success(`Cleanup done: removed ${r.removed?.length || 0} tag(s), kept ${r.kept?.length || 0}`, { id: toastId });
      loadData();
    } catch (e) {
      toast.error(`Cleanup failed: ${(e as Error).message}`, { id: toastId });
    }
  }

  // ── Render ─────────────────────────────────────────────────
  if (!authed && !loading) {
    return <LoginScreen onLogin={() => setAuthed(true)} api={api} />;
  }

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <DeployLayout
      activeView={activeView}
      onNavigate={setActiveView}
      onRefresh={loadData}
      onLogout={() => {
        localStorage.removeItem("deploy_token");
        setAuthed(false);
      }}
    >
      {activeView === "deploy" && buildInfo && (
        <div className="space-y-6">
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
          <BuildLogViewer
            buildLogs={buildLogs}
            buildPhase={buildPhase}
            deploying={deploying}
            deployingMgr={deployingMgr}
            onClear={() => { setBuildLogs([]); setBuildPhase(null); }}
          />
        </div>
      )}

      {activeView === "history" && (
        <HistoryTab
          buildHistory={buildHistory}
          rollingBack={rollingBack}
          onRollback={handleRollback}
        />
      )}

      {activeView === "system" && system && (
        <div className="space-y-6">
          <SystemTab
            system={system}
            deployingMgr={deployingMgr}
            onRebuildManager={handleRebuildManager}
          />
          <BuildLogViewer
            buildLogs={buildLogs}
            buildPhase={buildPhase}
            deploying={deploying}
            deployingMgr={deployingMgr}
            onClear={() => { setBuildLogs([]); setBuildPhase(null); }}
          />
        </div>
      )}

      {activeView === "services" && (
        <ServicesTab buildInfo={buildInfo} />
      )}
    </DeployLayout>
  );
}
