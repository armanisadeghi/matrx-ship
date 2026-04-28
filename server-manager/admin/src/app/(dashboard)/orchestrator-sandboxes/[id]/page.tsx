"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft, RefreshCw, CheckCircle2, XCircle, Clock } from "lucide-react";
import { Button } from "@matrx/admin-ui/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@matrx/admin-ui/ui/card";
import { Badge } from "@matrx/admin-ui/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@matrx/admin-ui/ui/tabs";
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
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadSummary}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList variant="line" className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
          <TabsTrigger value="env">Env Manifest</TabsTrigger>
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
