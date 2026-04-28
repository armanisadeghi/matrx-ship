"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft, RefreshCw, CheckCircle2, XCircle, Clock, RotateCcw, ChevronRight, ChevronDown, File as FileIcon, Folder as FolderIcon, FolderOpen, Loader2 } from "lucide-react";
import { Button } from "@matrx/admin-ui/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@matrx/admin-ui/ui/card";
import { Badge } from "@matrx/admin-ui/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@matrx/admin-ui/ui/tabs";
import { Input } from "@matrx/admin-ui/ui/input";
import { useAuth } from "@/lib/auth-context";
import { api, apiText, API, ApiError } from "@/lib/api";

interface OrchSandbox {
  sandbox_id: string;
  user_id: string;
  status: string;
  container_id?: string | null;
  created_at: string;
  ssh_port?: number | null;
  tier?: string | null;
  template?: string | null;
  expires_at?: string | null;
  proxy_url?: string | null;
  config?: Record<string, unknown>;
}

interface DiagCheck {
  ok?: boolean;
  checked?: boolean;
  reason?: string;
  http_status?: number;
  latency_ms?: number;
  body_preview?: string;
  [k: string]: unknown;
}

interface DiagContainer {
  present?: boolean;
  running?: boolean;
  status?: string;
  health?: string | null;
  started_at?: string;
  exit_code?: number;
  container_ip?: string;
  image?: string;
  passthrough_landed?: string[];
  passthrough_missing_count?: number;
  passthrough_missing_sample?: string[];
  error?: string;
}

interface DiagResponse {
  sandbox_id: string;
  overall_ok: boolean;
  sandbox?: Record<string, unknown>;
  container?: DiagContainer;
  checks?: Record<string, DiagCheck>;
}

const LOG_SOURCES = [
  { value: "all", label: "All" },
  { value: "docker", label: "Container (docker logs)" },
  { value: "matrx_agent", label: "matrx_agent (8000)" },
  { value: "aidream", label: "aidream (8001)" },
  { value: "autostart", label: "aidream-autostart" },
  { value: "entrypoint", label: "Entrypoint" },
];

interface FsEntry {
  path: string;
  name: string;
  kind?: "file" | "dir" | "symlink";
  is_dir?: boolean;
  size?: number;
}

interface FsNode {
  path: string;
  name: string;
  isDir: boolean;
  size?: number;
  expanded: boolean;
  loaded: boolean;
  loading: boolean;
  error?: string;
  children: FsNode[];
}

interface AgentEnvKv { key: string; value: string }
interface AgentEnvResponse {
  sandbox_id: string;
  container_config_env?: AgentEnvKv[];
  runtime_env?: AgentEnvKv[];
  runtime_env_error?: string;
  aidream_proc_env?: AgentEnvKv[];
  aidream_proc_env_error?: string;
  aidream_pid?: number;
}

function CheckRow({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-muted/20 p-3 text-sm">
      <div className="flex items-center gap-2 font-medium">
        {ok ? (
          <CheckCircle2 className="size-4 text-success" />
        ) : (
          <XCircle className="size-4 text-destructive" />
        )}
        <span>{label}</span>
      </div>
      {detail && (
        <div className="text-muted-foreground text-xs font-mono whitespace-pre-wrap break-all">
          {detail}
        </div>
      )}
    </div>
  );
}

export default function OrchestratorSandboxDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const { authed } = useAuth();

  const [sandbox, setSandbox] = useState<OrchSandbox | null>(null);
  const [diag, setDiag] = useState<DiagResponse | null>(null);
  const [logs, setLogs] = useState<string>("");
  const [logSource, setLogSource] = useState<string>("all");
  const [tail, setTail] = useState<number>(500);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(false);
  const logSourceRef = useRef(logSource);
  logSourceRef.current = logSource;
  const tailRef = useRef(tail);
  tailRef.current = tail;

  // Reset state
  const [resetBusy, setResetBusy] = useState(false);
  const [resetWipe, setResetWipe] = useState(false);

  // Filesystem tree state
  const [fsRootPath, setFsRootPath] = useState("/home/agent");
  const [fsTree, setFsTree] = useState<FsNode | null>(null);
  const [fsLoading, setFsLoading] = useState(false);
  const [fsError, setFsError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  // Agent env state
  const [agentEnv, setAgentEnv] = useState<AgentEnvResponse | null>(null);
  const [agentEnvLoading, setAgentEnvLoading] = useState(false);
  const [agentEnvError, setAgentEnvError] = useState<string | null>(null);
  const [envView, setEnvView] = useState<"aidream_proc_env" | "runtime_env" | "container_config_env">("aidream_proc_env");
  const [envFilter, setEnvFilter] = useState("");

  const loadSummary = useCallback(async () => {
    try {
      const [sbx, dg] = await Promise.all([
        api<OrchSandbox>(API.ORCH_SANDBOX(id)).catch((e) => {
          throw e;
        }),
        api<DiagResponse>(API.ORCH_SANDBOX_DIAG(id)).catch(() => null),
      ]);
      setSandbox(sbx);
      setDiag(dg);
      setError(null);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const text = await apiText(API.ORCH_SANDBOX_LOGS(id, logSourceRef.current, tailRef.current));
      setLogs(text);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
      setLogs(`(error fetching logs) ${msg}`);
    } finally {
      setLogsLoading(false);
    }
  }, [id]);

  // Reset handler — destroy + recreate. Returns the new sandbox_id; we
  // navigate to the new detail page so the operator continues seamlessly.
  const handleReset = useCallback(async () => {
    if (!confirm(`Reset sandbox ${id}?${resetWipe ? " This WILL WIPE the persistent volume — user data will be lost." : " The persistent volume will be preserved."}`)) {
      return;
    }
    setResetBusy(true);
    try {
      const r = await fetch(API.ORCH_SANDBOX_RESET(id, resetWipe), { method: "POST", headers: { Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("manager_token") : ""}` } });
      if (!r.ok) {
        const body = await r.text();
        alert(`Reset failed (HTTP ${r.status}): ${body.slice(0, 300)}`);
        return;
      }
      const newSandbox = await r.json();
      // Orchestrator returned a new sandbox_id — navigate to the new detail page.
      if (newSandbox?.sandbox_id && newSandbox.sandbox_id !== id) {
        router.push(`/orchestrator-sandboxes/${newSandbox.sandbox_id}`);
      } else {
        await loadSummary();
      }
    } catch (e) {
      alert(`Reset error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setResetBusy(false);
    }
  }, [id, resetWipe, router, loadSummary]);

  // Filesystem tree
  const loadDir = useCallback(async (path: string): Promise<FsNode[]> => {
    const json = await api<{ entries: FsEntry[] }>(API.ORCH_SANDBOX_FS_LIST(id, path, 1));
    return (json.entries || []).map((e) => ({
      path: e.path,
      name: e.name || e.path.split("/").pop() || e.path,
      isDir: e.kind === "dir" || e.is_dir === true,
      size: e.size,
      expanded: false,
      loaded: false,
      loading: false,
      children: [] as FsNode[],
    })).sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [id]);

  const loadFsRoot = useCallback(async () => {
    setFsLoading(true);
    setFsError(null);
    try {
      const children = await loadDir(fsRootPath);
      setFsTree({ path: fsRootPath, name: fsRootPath, isDir: true, expanded: true, loaded: true, loading: false, children });
    } catch (e) {
      setFsError(e instanceof Error ? e.message : String(e));
      setFsTree(null);
    } finally {
      setFsLoading(false);
    }
  }, [fsRootPath, loadDir]);

  const toggleNode = useCallback(async (target: FsNode) => {
    if (!fsTree) return;
    const update = (n: FsNode): FsNode => {
      if (n.path === target.path) {
        if (n.expanded) return { ...n, expanded: false };
        if (n.loaded) return { ...n, expanded: true };
        return { ...n, expanded: true, loading: true };
      }
      if (n.children.length) return { ...n, children: n.children.map(update) };
      return n;
    };
    setFsTree((p) => (p ? update(p) : p));
    if (!target.loaded && !target.expanded) {
      try {
        const children = await loadDir(target.path);
        setFsTree((p) => {
          if (!p) return p;
          const apply = (n: FsNode): FsNode => {
            if (n.path === target.path) return { ...n, children, loaded: true, loading: false };
            if (n.children.length) return { ...n, children: n.children.map(apply) };
            return n;
          };
          return apply(p);
        });
      } catch (e) {
        setFsTree((p) => {
          if (!p) return p;
          const apply = (n: FsNode): FsNode => {
            if (n.path === target.path) return { ...n, loading: false, error: e instanceof Error ? e.message : String(e) };
            if (n.children.length) return { ...n, children: n.children.map(apply) };
            return n;
          };
          return apply(p);
        });
      }
    }
  }, [fsTree, loadDir]);

  const loadFile = useCallback(async (path: string) => {
    setSelectedFile(path);
    setFileLoading(true);
    setFileError(null);
    setFileContent("");
    try {
      const text = await apiText(API.ORCH_SANDBOX_FS_READ(id, path));
      setFileContent(text);
    } catch (e) {
      // Try base64 if utf8 fails (binary file).
      try {
        const b64 = await apiText(API.ORCH_SANDBOX_FS_READ(id, path, "base64"));
        setFileContent(`(binary, base64 — ${b64.length} chars)\n${b64.slice(0, 4000)}${b64.length > 4000 ? "…" : ""}`);
      } catch (e2) {
        setFileError(e2 instanceof Error ? e2.message : String(e2));
      }
    } finally {
      setFileLoading(false);
    }
  }, [id]);

  // Agent env
  const loadAgentEnv = useCallback(async () => {
    setAgentEnvLoading(true);
    setAgentEnvError(null);
    try {
      const data = await api<AgentEnvResponse>(API.ORCH_SANDBOX_AGENT_ENV(id));
      setAgentEnv(data);
    } catch (e) {
      setAgentEnvError(e instanceof Error ? e.message : String(e));
    } finally {
      setAgentEnvLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!authed) return;
    loadSummary();
    const t = setInterval(loadSummary, 5000);
    return () => clearInterval(t);
  }, [authed, loadSummary]);

  useEffect(() => {
    if (!authed) return;
    loadLogs();
    const t = setInterval(loadLogs, 4000);
    return () => clearInterval(t);
  }, [authed, loadLogs, logSource, tail]);

  const checks = diag?.checks ?? {};

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm">
        <button
          onClick={() => router.push("/orchestrator-sandboxes")}
          className="text-primary hover:underline flex items-center gap-1"
        >
          <ChevronLeft className="size-4" /> Orchestrator Sandboxes
        </button>
        <span className="text-muted-foreground">/</span>
        <span className="font-mono">{id}</span>
      </div>

      {error && !sandbox && (
        <Card className="border-destructive/40">
          <CardContent className="pt-6 text-sm">
            <div className="font-medium text-destructive">Cannot load sandbox</div>
            <div className="font-mono text-xs text-muted-foreground mt-2 break-all">{error}</div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold font-mono">{id}</h2>
          <div className="flex items-center gap-2 mt-1">
            {sandbox ? (
              <Badge variant={sandbox.status === "running" ? "success" : "secondary"}>{sandbox.status}</Badge>
            ) : loading ? (
              <Badge variant="secondary">loading...</Badge>
            ) : null}
            {diag &&
              (diag.overall_ok ? (
                <Badge variant="success">all checks pass</Badge>
              ) : (
                <Badge variant="destructive">not ready</Badge>
              ))}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={resetWipe}
              onChange={(e) => setResetWipe(e.target.checked)}
            />
            wipe volume
          </label>
          <Button variant="outline" size="sm" onClick={handleReset} disabled={resetBusy}>
            <RotateCcw className={`size-4 ${resetBusy ? "animate-spin" : ""}`} /> Reset
          </Button>
          <Button variant="outline" size="sm" onClick={loadSummary}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
        </div>
      </div>

      <Tabs
        defaultValue="overview"
        onValueChange={(v) => {
          if (v === "filesystem" && !fsTree && !fsLoading) void loadFsRoot();
          if (v === "agent-env" && !agentEnv && !agentEnvLoading) void loadAgentEnv();
        }}
      >
        <TabsList variant="line" className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
          <TabsTrigger value="filesystem">Agent Filesystem</TabsTrigger>
          <TabsTrigger value="agent-env">Agent Env</TabsTrigger>
          <TabsTrigger value="env">Passthrough</TabsTrigger>
          <TabsTrigger value="logs">Live Logs</TabsTrigger>
          <TabsTrigger value="raw">Raw JSON</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sandbox identity</CardTitle>
              <CardDescription>Pulled live from the orchestrator's in-memory store.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              {sandbox ? (
                <>
                  <Field label="ID" value={sandbox.sandbox_id} mono />
                  <Field label="Status" value={sandbox.status} />
                  <Field label="User ID" value={sandbox.user_id} mono />
                  <Field label="Container" value={sandbox.container_id?.slice(0, 12) ?? "—"} mono />
                  <Field label="Tier" value={sandbox.tier ?? "—"} />
                  <Field label="Template" value={sandbox.template ?? "bare"} />
                  <Field label="Proxy URL" value={sandbox.proxy_url ?? "—"} mono />
                  <Field label="SSH port" value={sandbox.ssh_port?.toString() ?? "—"} mono />
                  <Field label="Created" value={new Date(sandbox.created_at).toLocaleString()} />
                  <Field
                    label="Expires"
                    value={sandbox.expires_at ? new Date(sandbox.expires_at).toLocaleString() : "never"}
                  />
                </>
              ) : (
                <div className="text-muted-foreground col-span-2">Loading...</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="diagnostics" className="space-y-4">
          {!diag ? (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">
                <Clock className="inline size-4 mr-2" />
                Polling diagnostics every 5s...
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Readiness checks
                    {diag.overall_ok ? (
                      <Badge variant="success" className="ml-2">
                        ALL PASS
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="ml-2">
                        FAIL
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Auto-refresh every 5s. Top-level <code>overall_ok</code>:{" "}
                    <span className="font-mono">{String(diag.overall_ok)}</span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <CheckRow
                    label="Container running"
                    ok={!!diag.container?.running}
                    detail={`${diag.container?.status ?? "?"} · health=${diag.container?.health ?? "—"} · ip=${diag.container?.container_ip ?? "?"} · image=${diag.container?.image ?? "?"}`}
                  />
                  {Object.entries(checks).map(([key, check]) => (
                    <CheckRow
                      key={key}
                      label={key}
                      ok={!!check.ok}
                      detail={
                        check.checked === false
                          ? `(skipped) ${check.reason ?? ""}`
                          : `http=${check.http_status ?? "?"} · ${check.latency_ms ?? "?"}ms ${check.body_preview ? "· " + String(check.body_preview).slice(0, 100) : ""}`
                      }
                    />
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Container snapshot</CardTitle>
                  <CardDescription className="text-xs">From <code>docker inspect</code></CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                  <Field label="Status" value={diag.container?.status ?? "—"} mono />
                  <Field label="Health" value={diag.container?.health ?? "—"} mono />
                  <Field label="Started at" value={diag.container?.started_at ?? "—"} mono />
                  <Field label="Container IP" value={diag.container?.container_ip ?? "—"} mono />
                  <Field label="Image" value={diag.container?.image ?? "—"} mono />
                  <Field label="Exit code" value={String(diag.container?.exit_code ?? "—")} mono />
                  {diag.container?.error && (
                    <div className="md:col-span-2 text-destructive font-mono break-all">
                      error: {diag.container.error}
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="filesystem" className="space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Agent filesystem</CardTitle>
              <CardDescription className="text-xs">
                Renders the same view the agent's <code>fs_list</code> tool sees — fetched via the matrx_agent <code>/fs/list</code> endpoint.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <Input
                  value={fsRootPath}
                  onChange={(e) => setFsRootPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void loadFsRoot();
                  }}
                  className="h-8 text-xs font-mono max-w-md"
                  placeholder="/home/agent"
                />
                <Button variant="outline" size="sm" onClick={loadFsRoot} disabled={fsLoading}>
                  <RefreshCw className={`size-3 ${fsLoading ? "animate-spin" : ""}`} /> Load
                </Button>
              </div>
              {fsError && (
                <div className="text-destructive text-xs font-mono break-all">{fsError}</div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="border rounded-md max-h-96 overflow-auto p-2 text-xs font-mono">
                  {fsLoading && !fsTree ? (
                    <div className="text-muted-foreground flex items-center gap-2">
                      <Loader2 className="size-3 animate-spin" /> Loading…
                    </div>
                  ) : fsTree ? (
                    <FsTreeView
                      node={fsTree}
                      onToggle={toggleNode}
                      onSelectFile={loadFile}
                      selectedPath={selectedFile}
                    />
                  ) : (
                    <div className="text-muted-foreground">(no tree loaded)</div>
                  )}
                </div>
                <div className="border rounded-md max-h-96 overflow-auto p-2 text-xs">
                  {selectedFile ? (
                    <>
                      <div className="font-mono text-muted-foreground border-b pb-1 mb-2 break-all">
                        {selectedFile}
                      </div>
                      {fileLoading ? (
                        <div className="text-muted-foreground flex items-center gap-2">
                          <Loader2 className="size-3 animate-spin" /> Reading…
                        </div>
                      ) : fileError ? (
                        <pre className="text-destructive whitespace-pre-wrap font-mono">{fileError}</pre>
                      ) : (
                        <pre className="font-mono whitespace-pre-wrap leading-tight">{fileContent || "(empty)"}</pre>
                      )}
                    </>
                  ) : (
                    <div className="text-muted-foreground">Click a file in the tree to read it.</div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="agent-env" className="space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Agent env (live)</CardTitle>
              <CardDescription className="text-xs">
                Three views of the env vars actually visible inside the running container.
                <strong> aidream process env</strong> is the ground truth — what the FastAPI process sees.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={envView}
                  onChange={(e) => setEnvView(e.target.value as typeof envView)}
                  className="text-xs border rounded-md px-2 py-1 bg-background"
                >
                  <option value="aidream_proc_env">aidream process env (truth)</option>
                  <option value="runtime_env">shell env (runtime)</option>
                  <option value="container_config_env">docker Config.Env (creation)</option>
                </select>
                <Input
                  value={envFilter}
                  onChange={(e) => setEnvFilter(e.target.value)}
                  className="h-8 text-xs font-mono max-w-xs"
                  placeholder="filter…"
                />
                <Button variant="outline" size="sm" onClick={loadAgentEnv} disabled={agentEnvLoading}>
                  <RefreshCw className={`size-3 ${agentEnvLoading ? "animate-spin" : ""}`} /> Refresh
                </Button>
                {agentEnv?.aidream_pid && (
                  <span className="text-xs text-muted-foreground font-mono">aidream pid={agentEnv.aidream_pid}</span>
                )}
              </div>
              {agentEnvError && <div className="text-destructive text-xs font-mono break-all">{agentEnvError}</div>}
              {agentEnv?.[`${envView}_error` as keyof AgentEnvResponse] && (
                <div className="text-destructive text-xs font-mono break-all">
                  {String(agentEnv[`${envView}_error` as keyof AgentEnvResponse])}
                </div>
              )}
              <div className="border rounded-md max-h-[480px] overflow-auto">
                <table className="w-full text-xs font-mono">
                  <thead className="text-left text-muted-foreground sticky top-0 bg-background border-b">
                    <tr><th className="p-2 w-1/3">key</th><th className="p-2">value</th></tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const list: AgentEnvKv[] = (agentEnv?.[envView] as AgentEnvKv[]) || [];
                      const filtered = envFilter ? list.filter((kv) => kv.key.toLowerCase().includes(envFilter.toLowerCase()) || kv.value.toLowerCase().includes(envFilter.toLowerCase())) : list;
                      if (!filtered.length) {
                        return <tr><td colSpan={2} className="p-2 text-muted-foreground">{agentEnvLoading ? "Loading…" : "(no entries)"}</td></tr>;
                      }
                      return filtered.map((kv) => (
                        <tr key={kv.key} className="border-t align-top">
                          <td className="p-2 break-all">{kv.key}</td>
                          <td className="p-2 break-all">{kv.value}</td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="env" className="space-y-4">
          {!diag?.container ? (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">
                Loading env manifest...
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Passthrough env</CardTitle>
                <CardDescription className="text-xs">
                  {diag.container.passthrough_landed?.length ?? 0} landed inside the container
                  {(diag.container.passthrough_missing_count ?? 0) > 0 && (
                    <span className="text-destructive">
                      {" "}— {diag.container.passthrough_missing_count} expected but missing
                    </span>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div>
                  <div className="font-medium text-success mb-2">
                    Landed ({diag.container.passthrough_landed?.length ?? 0})
                  </div>
                  <div className="font-mono space-y-0.5 max-h-80 overflow-auto">
                    {(diag.container.passthrough_landed ?? []).map((k) => (
                      <div key={k} className="break-all">
                        {k}
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="font-medium text-destructive mb-2">
                    Missing sample ({diag.container.passthrough_missing_count ?? 0} total)
                  </div>
                  <div className="font-mono space-y-0.5 max-h-80 overflow-auto">
                    {(diag.container.passthrough_missing_sample ?? []).length === 0 ? (
                      <div className="text-muted-foreground italic">— none —</div>
                    ) : (
                      (diag.container.passthrough_missing_sample ?? []).map((k) => (
                        <div key={k} className="break-all">
                          {k}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="logs" className="space-y-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Live logs</CardTitle>
              <CardDescription className="text-xs">
                Auto-refresh every 4s. Tail: {tail}.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {LOG_SOURCES.map((s) => (
                  <Button
                    key={s.value}
                    variant={logSource === s.value ? "default" : "outline"}
                    size="sm"
                    onClick={() => setLogSource(s.value)}
                  >
                    {s.label}
                  </Button>
                ))}
                <div className="flex items-center gap-1 ml-auto text-xs">
                  <span className="text-muted-foreground">Tail:</span>
                  {[100, 500, 2000].map((n) => (
                    <Button
                      key={n}
                      variant={tail === n ? "default" : "outline"}
                      size="sm"
                      onClick={() => setTail(n)}
                    >
                      {n}
                    </Button>
                  ))}
                  <Button variant="outline" size="sm" onClick={loadLogs} disabled={logsLoading}>
                    <RefreshCw className={`size-3 ${logsLoading ? "animate-spin" : ""}`} />
                  </Button>
                </div>
              </div>
              <pre className="bg-black text-green-400 text-[11px] font-mono p-3 rounded-lg overflow-auto max-h-[500px] whitespace-pre-wrap break-all">
                {logs || "(no log lines yet)"}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="raw" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sandbox JSON</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted text-xs font-mono p-3 rounded-lg overflow-auto max-h-96 whitespace-pre-wrap">
                {JSON.stringify(sandbox, null, 2)}
              </pre>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Diagnostics JSON</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted text-xs font-mono p-3 rounded-lg overflow-auto max-h-96 whitespace-pre-wrap">
                {JSON.stringify(diag, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-sm ${mono ? "font-mono break-all" : ""}`}>{value}</div>
    </div>
  );
}

function FsTreeView({ node, onToggle, onSelectFile, selectedPath, depth = 0 }: { node: FsNode; onToggle: (n: FsNode) => void; onSelectFile: (path: string) => void; selectedPath?: string | null; depth?: number }) {
  const indent = { paddingLeft: `${depth * 12}px` };
  const isSelected = selectedPath === node.path;
  return (
    <div>
      <div
        className={`flex items-center gap-1 cursor-pointer hover:bg-muted/50 rounded px-1 ${isSelected ? "bg-muted" : ""}`}
        style={indent}
        onClick={() => {
          if (node.isDir) onToggle(node);
          else onSelectFile(node.path);
        }}
      >
        {node.isDir ? (
          node.expanded ? <ChevronDown className="size-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <span className="w-3" />
        )}
        {node.isDir ? (
          node.expanded ? <FolderOpen className="size-3 shrink-0 text-blue-500" /> : <FolderIcon className="size-3 shrink-0 text-blue-500" />
        ) : (
          <FileIcon className="size-3 shrink-0 text-muted-foreground" />
        )}
        <span className="break-all">{node.name}</span>
        {node.loading && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
        {node.error && <span className="text-destructive text-[10px]" title={node.error}>(error)</span>}
        {!node.isDir && typeof node.size === "number" && (
          <span className="text-[10px] text-muted-foreground ml-auto pr-1">{formatBytes(node.size)}</span>
        )}
      </div>
      {node.isDir && node.expanded && node.children.map((c) => (
        <FsTreeView key={c.path} node={c} onToggle={onToggle} onSelectFile={onSelectFile} selectedPath={selectedPath} depth={depth + 1} />
      ))}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
