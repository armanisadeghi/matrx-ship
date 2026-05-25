"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, Server, Play, Loader2, Terminal, Box } from "lucide-react";
import { Button } from "@matrx/admin-ui/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@matrx/admin-ui/ui/card";
import { Badge } from "@matrx/admin-ui/ui/badge";
import { Input } from "@matrx/admin-ui/ui/input";
import { PageShell } from "@matrx/admin-ui/components/page-shell";
import { useAuth } from "@/lib/auth-context";
import { api, API, ApiError } from "@/lib/api";

interface ExecResult { success?: boolean; output?: string; error?: string; exitCode?: number; blocked?: boolean }
interface Container { name: string; image: string; status: string; state: string }
interface ContainersResp { containers: Container[]; count: number }

// One reusable command-runner row: an input + Run button + result panel, keyed
// by a target id. Used for both the local host and each container.
function CommandRunner({
  targetId, canExec, run, placeholder,
}: {
  targetId: string;
  canExec: boolean;
  run: (command: string) => Promise<ExecResult>;
  placeholder: string;
}) {
  const [command, setCommand] = useState("");
  const [result, setResult] = useState<ExecResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function go() {
    const c = command.trim();
    if (!c || busy) return;
    setBusy(true);
    setResult(null);
    try {
      setResult(await run(c));
    } catch (e) {
      setResult({ success: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Terminal className="size-4 text-muted-foreground shrink-0" />
        <Input
          className="font-mono text-xs"
          placeholder={canExec ? placeholder : "requires deployer or admin role"}
          value={command}
          disabled={!canExec || busy}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") go(); }}
        />
        <Button size="sm" disabled={!canExec || busy || !command.trim()} onClick={go}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Run
        </Button>
      </div>
      {result && (
        <div className="rounded-lg bg-zinc-950 text-zinc-300 p-3 font-mono text-xs max-h-80 overflow-y-auto">
          <div className="text-zinc-500 mb-1">
            {result.success === false ? "failed" : "ok"}
            {result.exitCode != null && ` · exit ${result.exitCode}`}
            {result.blocked && " · blocked by guard"}
          </div>
          {result.output && <pre className="whitespace-pre-wrap text-zinc-200">{result.output}</pre>}
          {result.error && <pre className="whitespace-pre-wrap text-red-400">{result.error}</pre>}
        </div>
      )}
      <span data-target={targetId} className="hidden" />
    </div>
  );
}

export default function ConsolePage() {
  const { authed, role } = useAuth();
  const canExec = role === "admin" || role === "deployer";

  const [containers, setContainers] = useState<Container[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await api<ContainersResp>(API.CONTAINERS);
      setContainers(data.containers || []);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authed) return;
    load();
  }, [authed, load]);

  const runLocal = (command: string) =>
    api<ExecResult>(API.LOCAL_EXEC, { method: "POST", body: JSON.stringify({ command }) });
  const runContainer = (name: string) => (command: string) =>
    api<ExecResult>(API.CONTAINER_EXEC(name), { method: "POST", body: JSON.stringify({ command }) });

  return (
    <PageShell
      title="Console"
      description="Run one-shot commands on the local /srv host and inside any container on it — the same access the Manager has, without SSH. Remote EC2 boxes are on the Hosts page; interactive terminals are coming soon."
      actions={
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      }
    >
      {error && (
        <Card className="border-destructive/40">
          <CardContent className="pt-6 text-sm">
            <div className="font-medium text-destructive">Can&apos;t load containers</div>
            <div className="font-mono text-xs text-muted-foreground mt-2 break-all">{error}</div>
          </CardContent>
        </Card>
      )}

      {/* Local /srv host */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Server className="size-4 text-muted-foreground" />
            <span className="font-mono">local /srv host</span>
            <Badge variant="secondary" className="text-[10px]">this box</Badge>
          </CardTitle>
          <CardDescription className="text-xs">
            Docker CLI + /srv + /data in scope. Destructive image ops are guarded.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <CommandRunner
            targetId="local"
            canExec={canExec}
            run={runLocal}
            placeholder="shell command (e.g. df -h, docker ps, git -C /srv/projects/matrx-ship pull)"
          />
        </CardContent>
      </Card>

      {/* Containers */}
      {loading && !containers ? (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">Loading containers…</CardContent></Card>
      ) : (
        containers?.map((c) => (
          <Card key={c.name} className={c.state === "running" ? "" : "border-amber-500/40"}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Box className="size-4 text-muted-foreground" />
                <span className="font-mono">{c.name}</span>
                <Badge variant={c.state === "running" ? "success" : "secondary"} className="text-[10px]">{c.state}</Badge>
              </CardTitle>
              <CardDescription className="text-xs font-mono">{c.image} · {c.status}</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <CommandRunner
                targetId={c.name}
                canExec={canExec && c.state === "running"}
                run={runContainer(c.name)}
                placeholder={c.state === "running" ? "command inside this container (e.g. ls /app, env)" : "container is not running"}
              />
            </CardContent>
          </Card>
        ))
      )}

      {containers && containers.length === 0 && (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">No containers found.</CardContent></Card>
      )}
    </PageShell>
  );
}
