"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import { RefreshCw, Copy, Check, Search, AlertTriangle, Info, FileSearch } from "lucide-react";
import { Button } from "@matrx/admin-ui/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@matrx/admin-ui/ui/card";
import { Input } from "@matrx/admin-ui/ui/input";
import { Badge } from "@matrx/admin-ui/ui/badge";
import { PageShell } from "@matrx/admin-ui/components/page-shell";
import { useAuth } from "@/lib/auth-context";
import { api, API, ApiError } from "@/lib/api";

interface LogsResp {
  container: string;
  container_started_at: string | null;
  since: string;
  tail: number;
  grep: string | null;
  lines: string[];
  truncated_note: string;
}

const SINCE_PRESETS = ["10m", "1h", "6h", "24h", "7d"] as const;
const TAIL_PRESETS = [200, 500, 1000, 2000, 5000] as const;

function ageLabel(iso: string | null): string {
  if (!iso) return "?";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return iso;
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// Best-effort: pull the JSON 'level' field out of the orchestrator's structured
// log line so we can color WARNING/ERROR/CRITICAL distinctly without parsing
// every field. Falls back to plain text when the line isn't JSON.
function classifyLine(line: string): "critical" | "error" | "warning" | "info" | "debug" | "plain" {
  const m = line.match(/"level":\s*"([A-Z]+)"/);
  if (m) {
    const l = m[1].toLowerCase();
    if (l === "critical") return "critical";
    if (l === "error") return "error";
    if (l === "warning") return "warning";
    if (l === "debug") return "debug";
    return "info";
  }
  if (/error|exception|traceback/i.test(line)) return "error";
  if (/warn/i.test(line)) return "warning";
  return "plain";
}

export default function OrchestratorLogsPage() {
  const { authed } = useAuth();
  const [data, setData] = useState<LogsResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [since, setSince] = useState<string>("1h");
  const [tail, setTail] = useState<number>(1000);
  const [grep, setGrep] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (g?: string) => {
    setLoading(true);
    try {
      const d = await api<LogsResp>(API.ORCH_LOGS(since, tail, g ?? grep, "json"));
      setData(d);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [since, tail, grep]);

  // Initial + reload when the lookback / tail changes (grep is applied on Enter).
  useEffect(() => { if (authed) load(); }, [authed, since, tail, load]);

  // Scroll to bottom on new data so the latest line is visible.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [data]);

  const copyAll = useCallback(async () => {
    if (!data) return;
    const text = data.lines.join("\n");
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const ta = document.createElement("textarea");
        ta.value = text; ta.style.position = "fixed"; ta.style.left = "-9999px";
        document.body.appendChild(ta); ta.select(); document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      toast.success(`Copied ${data.lines.length} log line(s).`);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      toast.error(`Copy failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [data]);

  const startedLabel = data?.container_started_at ? `${new Date(data.container_started_at).toLocaleString()} (${ageLabel(data.container_started_at)})` : "unknown";
  const lineCount = data?.lines.length ?? 0;

  return (
    <PageShell
      title="Orchestrator Logs"
      description="The hosted orchestrator's PROCESS stdout/stderr. This is where 'auto-provision created the DB row but the Docker container failed to start' errors live. Per-sandbox-container logs are on each sandbox's detail page."
      icon={FileSearch}
      actions={
        <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      }
    >
      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardContent className="pt-5 text-sm flex items-start gap-2">
          <AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <strong>Logs only go back to the current container's start.</strong>{" "}
            A force-recreate of the orchestrator (Restart / Rebuild buttons, or Versions → Pull+redeploy)
            destroys the prior container's log file — you can&apos;t look back past that point. Current
            container started <b>{startedLabel}</b>.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Search className="size-4" /> Filter</CardTitle>
          <CardDescription className="text-xs">
            Grep is a case-insensitive regex applied server-side. Try a sandbox id (e.g. <code>8de6172b</code>),
            a user id, or <code>ERROR|exception|failed</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Lookback</label>
              <div className="flex gap-1">
                {SINCE_PRESETS.map((p) => (
                  <Button key={p} size="sm" variant={since === p ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => setSince(p)}>{p}</Button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Tail (max lines)</label>
              <div className="flex gap-1">
                {TAIL_PRESETS.map((p) => (
                  <Button key={p} size="sm" variant={tail === p ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => setTail(p)}>{p}</Button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1 flex-1 min-w-[240px]">
              <label className="text-xs text-muted-foreground">Grep (regex)</label>
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); load(); }}>
                <Input value={grep} onChange={(e) => setGrep(e.target.value)} placeholder='e.g. 8de6172b|ERROR|info@aimatrx' className="font-mono text-xs" />
                <Button type="submit" size="sm" variant="default" disabled={loading}>Search</Button>
                {grep && <Button type="button" size="sm" variant="ghost" onClick={() => { setGrep(""); load(""); }}>Clear</Button>}
              </form>
            </div>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="pt-5 text-sm">
            <div className="font-medium text-destructive">Couldn&apos;t fetch logs</div>
            <div className="font-mono text-xs text-muted-foreground mt-2 break-all">{error}</div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base flex items-center gap-2">
              {data?.container || "matrx-orchestrator"}
              <Badge variant="secondary" className="font-mono text-[10px]">{lineCount} line{lineCount === 1 ? "" : "s"}</Badge>
              {data?.grep && <Badge variant="outline" className="font-mono text-[10px]">grep=/{data.grep}/i</Badge>}
            </CardTitle>
            <Button size="sm" variant="outline" onClick={copyAll} disabled={!data || lineCount === 0}>
              {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
              {copied ? "Copied" : "Copy all"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading && !data ? (
            <div className="text-center text-sm text-muted-foreground py-8">Loading…</div>
          ) : !data || lineCount === 0 ? (
            <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground py-8">
              <Info className="size-5" />
              <span>No lines matched. Widen the lookback or clear the grep.</span>
            </div>
          ) : (
            <div
              ref={logRef}
              className="bg-zinc-950 text-zinc-300 rounded-lg p-3 font-mono text-[11px] leading-relaxed max-h-[65vh] overflow-y-auto whitespace-pre-wrap"
            >
              {data.lines.map((line, i) => {
                const k = classifyLine(line);
                const cls = k === "critical" || k === "error" ? "text-red-400" : k === "warning" ? "text-amber-300" : k === "debug" ? "text-zinc-500" : "";
                return <div key={i} className={cls}>{line}</div>;
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
