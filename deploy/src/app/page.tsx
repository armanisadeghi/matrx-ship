"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Rocket, RotateCcw, Server, GitBranch, Clock, Container,
  RefreshCw, ShieldCheck, Loader2, AlertTriangle, CheckCircle2,
  History, Trash2, Wrench, ArrowDownToLine, LogIn, ExternalLink,
  Globe, Database, Terminal, Cpu, LayoutDashboard,
} from "lucide-react";

type BuildInfo = {
  current_image: { id: string | null; created: string | null; age: string | null };
  source: { path: string; branch: string; head_commit: string; last_build_commit: string | null };
  has_changes: boolean;
  pending_commits: string[];
  diff_stats: string | null;
  instances: Array<{ name: string; display_name: string; status: string }>;
  available_tags: Array<{ tag: string; id: string; age: string }>;
  last_build: { tag: string; timestamp: string; git_commit: string; duration_ms: number } | null;
};

type BuildRecord = {
  id: string; tag: string; timestamp: string; git_commit: string; git_message: string;
  image_id: string | null; success: boolean; error: string | null; duration_ms: number;
  triggered_by: string; instances_restarted: string[];
};

type SystemInfo = {
  hostname: string; cpus: number;
  memory: { total: string; used: string; percent: string };
  disk: { total: string; used: string; percent: string };
  uptime_hours: string; docker: string;
  containers: string[];
};

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

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState(false);

  async function handleLogin() {
    try {
      localStorage.setItem("deploy_token", token);
      await api("/api/health");
      // Test auth on a protected endpoint
      await api("/api/system");
      onLogin();
    } catch {
      setError(true);
      localStorage.removeItem("deploy_token");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Card className="w-[420px]">
        <CardHeader className="text-center">
          <CardTitle className="text-xl flex items-center justify-center gap-2">
            <Rocket className="size-5" /> Matrx Deploy
          </CardTitle>
          <CardDescription>Enter your admin token to access deploy management.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <p className="text-destructive text-sm text-center">Invalid token</p>}
          <input
            type="password"
            value={token}
            onChange={(e) => { setToken(e.target.value); setError(false); }}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            placeholder="Bearer token..."
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
            autoFocus
          />
          <Button onClick={handleLogin} className="w-full">
            <LogIn className="size-4" /> Sign In
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function ServiceLink({ name, url, description, icon, badge, status }: {
  name: string;
  url: string;
  description: string;
  icon: React.ReactNode;
  badge?: string;
  status?: "running" | "stopped" | "ssh-only";
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors group"
    >
      <div className="flex items-center gap-3">
        {icon}
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{name}</span>
            {badge && <Badge variant="secondary" className="text-[10px]">{badge}</Badge>}
            {status === "running" && <Badge variant="success" className="text-[10px]">running</Badge>}
            {status === "stopped" && <Badge variant="destructive" className="text-[10px]">stopped</Badge>}
            {status === "ssh-only" && <Badge variant="outline" className="text-[10px]">SSH only</Badge>}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
        </div>
      </div>
      <ExternalLink className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
    </a>
  );
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
  const [activeTab, setActiveTab] = useState<"deploy" | "history" | "system" | "services">("deploy");
  const [buildLogs, setBuildLogs] = useState<string[]>([]);
  const [buildPhase, setBuildPhase] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [info, hist, sys] = await Promise.all([
        api("/api/build-info"),
        api("/api/build-history?include_failed=true&limit=20"),
        api("/api/system"),
      ]);
      setBuildInfo(info);
      setBuildHistory(hist.builds || []);
      setSystem(sys);
    } catch (e) {
      if ((e as Error).message === "Unauthorized") { setAuthed(false); localStorage.removeItem("deploy_token"); }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authed) {
      const token = localStorage.getItem("deploy_token");
      if (token) {
        api("/api/system").then(() => { setAuthed(true); }).catch(() => { setLoading(false); });
      } else {
        setLoading(false);
      }
    } else {
      loadData();
    }
  }, [authed, loadData]);

  if (!authed && !loading) return <LoginScreen onLogin={() => setAuthed(true)} />;
  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="size-8 animate-spin text-muted-foreground" /></div>;

  async function handleDeploy(name?: string) {
    setDeploying(true);
    setBuildLogs([]);
    setBuildPhase("starting");

    const token = typeof window !== "undefined" ? localStorage.getItem("deploy_token") || "" : "";

    try {
      const response = await fetch("/api/rebuild/stream", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(name ? { name } : {}),
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
                toast.success(`Deploy complete — ${data.instances_restarted?.length || 0} instance(s) restarted in ${Math.round((data.duration_ms || 0) / 1000)}s`);
                setBuildPhase("done");
              } else if (eventType === "error") {
                toast.error(`Deploy failed: ${data.error}`);
                setBuildPhase("error");
              }
            } catch { /* skip malformed JSON */ }
          }
        }
      }
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
      if (result.success) {
        toast.success(`Rolled back to ${tag} — ${result.instances_restarted?.length || 0} instance(s) restarted`, { id: toastId });
      } else {
        toast.error(`Rollback failed: ${result.error}`, { id: toastId });
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
                toast.success("Server Manager rebuild complete. Container will restart momentarily.");
                setBuildPhase("done");
              } else if (eventType === "error") {
                toast.error(`Rebuild failed: ${data.error}`);
                setBuildPhase("error");
              }
            } catch { /* skip malformed JSON */ }
          }
        }
      }
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
      toast.success(`Cleanup done: removed ${result.removed?.length || 0} tag(s), kept ${result.kept?.length || 0}`, { id: toastId });
      loadData();
    } catch (e) {
      toast.error(`Cleanup failed: ${(e as Error).message}`, { id: toastId });
    }
  }

  const tabs = [
    { id: "deploy" as const, label: "Deploy", icon: Rocket },
    { id: "history" as const, label: "History", icon: History },
    { id: "system" as const, label: "System", icon: Server },
    { id: "services" as const, label: "Services", icon: LayoutDashboard },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Rocket className="size-5 text-primary" />
          <h1 className="font-semibold text-lg">Matrx Deploy</h1>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={loadData}><RefreshCw className="size-4" /></Button>
          <Button variant="ghost" size="sm" onClick={() => { localStorage.removeItem("deploy_token"); setAuthed(false); }}>Logout</Button>
        </div>
      </header>

      {/* Tabs */}
      <div className="border-b bg-card px-6">
        <nav className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              <t.icon className="size-4" /> {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        {activeTab === "deploy" && buildInfo && (
          <>
            {/* Current Image Status */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="text-sm text-muted-foreground">Current Image</div>
                  <div className="text-lg font-mono font-semibold mt-1">{buildInfo.current_image.id || "none"}</div>
                  <div className="text-xs text-muted-foreground mt-1">{buildInfo.current_image.age ? `Built ${buildInfo.current_image.age} ago` : "No image"}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-sm text-muted-foreground">Source Branch</div>
                  <div className="flex items-center gap-2 mt-1">
                    <GitBranch className="size-4 text-primary" />
                    <span className="font-mono font-semibold">{buildInfo.source.branch}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 font-mono">{buildInfo.source.head_commit}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-sm text-muted-foreground">Pending Changes</div>
                  <div className="text-lg font-semibold mt-1">
                    {buildInfo.has_changes ? (
                      <span className="text-warning">{buildInfo.pending_commits.length} commit(s)</span>
                    ) : (
                      <span className="text-success">Up to date</span>
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-sm text-muted-foreground">Instances</div>
                  <div className="text-lg font-semibold mt-1">{buildInfo.instances.length}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {buildInfo.instances.filter((i) => i.status === "running").length} running
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Pending Commits */}
            {buildInfo.pending_commits.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <GitBranch className="size-4" /> Pending Changes
                  </CardTitle>
                  <CardDescription>
                    {buildInfo.pending_commits.length} commit(s) since last build ({buildInfo.source.last_build_commit || "never"})
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1 font-mono text-sm max-h-48 overflow-y-auto">
                    {buildInfo.pending_commits.map((c, i) => (
                      <div key={i} className="text-muted-foreground py-0.5">{c}</div>
                    ))}
                  </div>
                  {buildInfo.diff_stats && (
                    <pre className="mt-3 p-3 bg-muted rounded-md text-xs overflow-x-auto whitespace-pre-wrap">{buildInfo.diff_stats}</pre>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Deploy Actions */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Rocket className="size-4" /> Deploy Actions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-3">
                  <Button onClick={() => handleDeploy()} disabled={deploying} size="lg">
                    {deploying ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
                    {deploying ? "Building..." : "Deploy All Instances"}
                  </Button>
                  <Button variant="outline" onClick={handleRebuildManager} disabled={deployingMgr}>
                    {deployingMgr ? <Loader2 className="size-4 animate-spin" /> : <Wrench className="size-4" />}
                    Rebuild Server Manager
                  </Button>
                  <Button variant="outline" onClick={handleCleanup}>
                    <Trash2 className="size-4" /> Cleanup Old Images
                  </Button>
                </div>

                {/* Per-instance deploy */}
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-2">Deploy Single Instance</h4>
                  <div className="flex flex-wrap gap-2">
                    {buildInfo.instances.map((inst) => (
                      <Button key={inst.name} variant="secondary" size="sm" onClick={() => handleDeploy(inst.name)} disabled={deploying}>
                        <Container className="size-3" /> {inst.display_name}
                        <Badge variant={inst.status === "running" ? "success" : "destructive"} className="ml-1 text-[10px]">
                          {inst.status}
                        </Badge>
                      </Button>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Live Build Logs */}
            {buildLogs.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Terminal className="size-4" /> Build Output
                      {(deploying || deployingMgr) && <Loader2 className="size-4 animate-spin text-primary" />}
                      {buildPhase === "done" && <CheckCircle2 className="size-4 text-green-500" />}
                      {buildPhase === "error" && <AlertTriangle className="size-4 text-destructive" />}
                    </CardTitle>
                    {!deploying && !deployingMgr && (
                      <Button variant="ghost" size="sm" onClick={() => { setBuildLogs([]); setBuildPhase(null); }}>
                        Clear
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <div
                    ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}
                    className="bg-zinc-950 text-zinc-300 rounded-lg p-4 font-mono text-xs max-h-96 overflow-y-auto space-y-0.5"
                  >
                    {buildLogs.map((line, i) => (
                      <div
                        key={i}
                        className={
                          line.startsWith("──") ? "text-blue-400 font-semibold py-1" :
                          line.includes("error") || line.includes("ERROR") || line.includes("FAILED") ? "text-red-400" :
                          line.includes("restarted") || line.includes("success") ? "text-green-400" :
                          "text-zinc-400"
                        }
                      >
                        {line}
                      </div>
                    ))}
                    {(deploying || deployingMgr) && (
                      <div className="text-zinc-500 animate-pulse">waiting for output...</div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Available Image Tags / Rollback */}
            {buildInfo.available_tags.length > 1 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <RotateCcw className="size-4" /> Available Images & Rollback
                  </CardTitle>
                  <CardDescription>Click rollback to switch to a previous image version</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {buildInfo.available_tags.map((t) => (
                      <div key={t.tag} className="flex items-center justify-between py-2 px-3 rounded-md bg-muted/50">
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-sm font-medium">{t.tag}</span>
                          <span className="text-xs text-muted-foreground font-mono">{t.id}</span>
                          <span className="text-xs text-muted-foreground">{t.age}</span>
                          {t.tag === "latest" && <Badge variant="default" className="text-[10px]">current</Badge>}
                        </div>
                        {t.tag !== "latest" && t.tag !== "<none>" && (
                          <Button
                            variant="outline" size="sm"
                            onClick={() => handleRollback(t.tag)}
                            disabled={rollingBack === t.tag}
                          >
                            {rollingBack === t.tag ? <Loader2 className="size-3 animate-spin" /> : <ArrowDownToLine className="size-3" />}
                            Rollback
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {activeTab === "history" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <History className="size-4" /> Build History
              </CardTitle>
              <CardDescription>{buildHistory.length} build(s) recorded</CardDescription>
            </CardHeader>
            <CardContent>
              {buildHistory.length === 0 ? (
                <p className="text-muted-foreground text-sm">No builds recorded yet.</p>
              ) : (
                <div className="space-y-3">
                  {buildHistory.map((b) => (
                    <div key={b.id} className="flex items-start justify-between p-3 rounded-lg border bg-card">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          {b.success ? <CheckCircle2 className="size-4 text-success" /> : <AlertTriangle className="size-4 text-destructive" />}
                          <span className="font-mono text-sm font-medium">{b.tag}</span>
                          <Badge variant={b.success ? "success" : "destructive"} className="text-[10px]">
                            {b.success ? "success" : "failed"}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground space-x-3">
                          <span><Clock className="inline size-3 mr-1" />{new Date(b.timestamp).toLocaleString()}</span>
                          <span>{Math.round(b.duration_ms / 1000)}s</span>
                          <span className="font-mono">{b.git_commit}</span>
                          <span>by {b.triggered_by}</span>
                        </div>
                        {b.git_message && <div className="text-xs text-muted-foreground">{b.git_message}</div>}
                        {b.error && <div className="text-xs text-destructive mt-1">{b.error}</div>}
                      </div>
                      {b.success && b.tag && !b.tag.startsWith("rollback") && (
                        <Button variant="outline" size="sm" onClick={() => handleRollback(b.tag)} disabled={rollingBack === b.tag}>
                          <ArrowDownToLine className="size-3" /> Rollback
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === "system" && system && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="text-sm text-muted-foreground">Hostname</div>
                  <div className="font-mono font-semibold mt-1 text-sm">{system.hostname}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-sm text-muted-foreground">Memory</div>
                  <div className="font-semibold mt-1">{system.memory.percent}</div>
                  <div className="text-xs text-muted-foreground">{system.memory.used} / {system.memory.total}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-sm text-muted-foreground">Disk</div>
                  <div className="font-semibold mt-1">{system.disk.percent}</div>
                  <div className="text-xs text-muted-foreground">{system.disk.used} / {system.disk.total}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-sm text-muted-foreground">Uptime</div>
                  <div className="font-semibold mt-1">{system.uptime_hours}h</div>
                  <div className="text-xs text-muted-foreground">{system.cpus} CPUs</div>
                </CardContent>
              </Card>
            </div>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Container className="size-4" /> Docker
                </CardTitle>
                <CardDescription>{system.docker}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 font-mono text-sm">
                  {(system.containers ?? []).map((c, i) => (
                    <div key={i} className="py-0.5 text-muted-foreground">{c}</div>
                  ))}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <ShieldCheck className="size-4" /> Server Manager
                </CardTitle>
                <CardDescription>Rebuild the MCP Server Manager from source</CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" onClick={handleRebuildManager} disabled={deployingMgr}>
                  {deployingMgr ? <Loader2 className="size-4 animate-spin" /> : <Wrench className="size-4" />}
                  Rebuild Server Manager
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── Services Directory Tab ─────────────────────────────────── */}
        {activeTab === "services" && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold">Services Directory</h2>
            <p className="text-sm text-muted-foreground">All services running on this infrastructure, with quick-access links.</p>

            {/* Management Tools */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Wrench className="size-4" /> Management Tools
                </CardTitle>
                <CardDescription>Admin dashboards and management UIs</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <ServiceLink
                    name="Server Manager (Big Admin)"
                    url="https://mcp.dev.codematrx.com/admin/"
                    description="Central admin dashboard — instances, sandboxes, builds, tokens, and system health"
                    icon={<ShieldCheck className="size-4 text-orange-500" />}
                  />
                  <ServiceLink
                    name="Deploy App"
                    url="https://deploy.dev.codematrx.com"
                    description="Standalone deploy watcher — safe rebuilds, rollbacks, and image management"
                    icon={<Rocket className="size-4 text-blue-500" />}
                    badge="You are here"
                  />
                  <ServiceLink
                    name="Traefik Dashboard"
                    url="https://traefik.dev.codematrx.com"
                    description="Reverse proxy dashboard — routing rules, SSL certificates, and service discovery"
                    icon={<Globe className="size-4 text-green-500" />}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Database Tools */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Database className="size-4" /> Database
                </CardTitle>
                <CardDescription>Database management and access credentials</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <ServiceLink
                    name="pgAdmin"
                    url="https://pg.dev.codematrx.com"
                    description="PostgreSQL web admin for the central database"
                    icon={<Database className="size-4 text-blue-600" />}
                  />
                  <div className="mt-4 p-4 rounded-lg border bg-muted/30">
                    <h4 className="text-sm font-medium mb-2">Central Database Credentials</h4>
                    <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                      <div className="text-muted-foreground">pgAdmin Email:</div><div>admin@matrxserver.com</div>
                      <div className="text-muted-foreground">pgAdmin Password:</div><div>Dsi4t4slbdSH9hzeEu5waQ==</div>
                      <div className="text-muted-foreground">Postgres Host:</div><div>postgres (Docker network)</div>
                      <div className="text-muted-foreground">Postgres User:</div><div>matrx</div>
                      <div className="text-muted-foreground">Postgres DB:</div><div>matrx</div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-3">
                      Per-instance databases use isolated containers. Credentials are in each instance&apos;s <code>.env</code> at <code>/srv/apps/&#123;name&#125;/.env</code> (user: <code>ship</code>, db: <code>ship</code>, password is unique per instance).
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Ship Instances */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Container className="size-4" /> Ship Instances
                </CardTitle>
                <CardDescription>Deployed project instances running matrx-ship</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {buildInfo?.instances && buildInfo.instances.length > 0 ? (
                    buildInfo.instances.map((inst) => (
                      <ServiceLink
                        key={inst.name}
                        name={inst.display_name}
                        url={`https://ship-${inst.name}.dev.codematrx.com`}
                        description={`Ship instance admin portal`}
                        icon={<Server className="size-4 text-violet-500" />}
                        status={inst.status === "running" ? "running" : "stopped"}
                      />
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">No instances loaded. Refresh to see ship instances.</p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Dev Sandboxes */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Terminal className="size-4" /> Dev Sandboxes
                </CardTitle>
                <CardDescription>Isolated development environments</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <ServiceLink
                      key={n}
                      name={`Sandbox ${n}`}
                      url={`https://sandbox-${n}.dev.codematrx.com`}
                      description="Web-based development sandbox (ttyd terminal)"
                      icon={<Terminal className="size-4 text-emerald-500" />}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Other Services */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Cpu className="size-4" /> Other Services
                </CardTitle>
                <CardDescription>Additional infrastructure services</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <ServiceLink
                    name="MCP Example Server"
                    url="https://mcp-example.dev.codematrx.com"
                    description="Example MCP server (Streamable HTTP) — API only, use POST /mcp with bearer token"
                    icon={<Cpu className="size-4 text-amber-500" />}
                  />
                  <ServiceLink
                    name="Agent 1"
                    url="https://agent-1.dev.codematrx.com"
                    description="Sysbox agent container — SSH access only, no web UI (ttyd not installed)"
                    icon={<Terminal className="size-4 text-red-400" />}
                    status="ssh-only"
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
