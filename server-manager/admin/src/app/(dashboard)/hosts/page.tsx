"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, Server, Play, Power, RotateCw, CheckCircle2, XCircle, Loader2, Terminal } from "lucide-react";
import { Button } from "@matrx/admin-ui/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@matrx/admin-ui/ui/card";
import { Badge } from "@matrx/admin-ui/ui/badge";
import { Input } from "@matrx/admin-ui/ui/input";
import { PageShell } from "@matrx/admin-ui/components/page-shell";
import { useConfirm } from "@matrx/admin-ui/components/confirm-dialog";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { api, API, ApiError } from "@/lib/api";

interface SsmInfo { ping?: string; platform?: string; platformVersion?: string; agent?: string }
interface Ec2Info { state?: string; type?: string; az?: string; privateIp?: string; publicIp?: string; name?: string }
interface Host {
  id: string;
  role: string;
  instanceId: string;
  region: string;
  online: boolean;
  ssm: SsmInfo | null;
  ec2: Ec2Info | null;
}
interface HostsResp { aws_configured: boolean; region?: string; hosts?: Host[]; error?: string }
interface ExecResult { status: string; stdout: string; stderr: string; exitCode?: number; error?: string }

const POLL_MS = 30000;

export default function HostsPage() {
  const { authed, role } = useAuth();
  const canExec = role === "admin" || role === "deployer";
  const canPower = role === "admin";
  const ask = useConfirm();

  const [data, setData] = useState<HostsResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Per-host command + result + busy state.
  const [cmd, setCmd] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Record<string, ExecResult | null>>({});
  const [busy, setBusy] = useState<string | null>(null); // `${id}:exec` | `${id}:power`

  const load = useCallback(async () => {
    try {
      setData(await api<HostsResp>(API.HOSTS));
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
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [authed, load]);

  async function runCommand(id: string) {
    const command = (cmd[id] || "").trim();
    if (!command || busy) return;
    setBusy(`${id}:exec`);
    setResult((r) => ({ ...r, [id]: null }));
    try {
      const res = await api<ExecResult>(API.HOST_EXEC(id), { method: "POST", body: JSON.stringify({ command }) });
      setResult((r) => ({ ...r, [id]: res }));
    } catch (e) {
      setResult((r) => ({ ...r, [id]: { status: "ERROR", stdout: "", stderr: e instanceof Error ? e.message : String(e) } }));
    } finally {
      setBusy(null);
    }
  }

  async function power(id: string, action: "start" | "stop" | "reboot") {
    if (busy) return;
    const ok = await ask({
      title: `${action.toUpperCase()} host ${id}?`,
      description: `This affects the live EC2 instance${action === "stop" ? " — running workloads will be interrupted" : action === "reboot" ? " — brief downtime" : ""}.`,
      variant: action === "stop" || action === "reboot" ? "warning" : "default",
      confirmLabel: action.toUpperCase(),
    });
    if (!ok) return;
    setBusy(`${id}:power`);
    try {
      await api(API.HOST_POWER(id), { method: "POST", body: JSON.stringify({ action }) });
      toast.success(`Host ${id}: ${action} dispatched.`);
      setTimeout(load, 3000);
    } catch (e) {
      toast.error(`Power ${action} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <PageShell
      title="Hosts"
      description="The remote EC2 boxes in the fleet, reachable via AWS SSM (no SSH). Run commands and control power directly from here. The local /srv host is managed via the other pages (Instances, Sandboxes, System)."
      actions={
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      }
    >
      {error && (
        <Card className="border-destructive/40">
          <CardContent className="pt-6 text-sm">
            <div className="font-medium text-destructive">Can&apos;t load hosts</div>
            <div className="font-mono text-xs text-muted-foreground mt-2 break-all">{error}</div>
          </CardContent>
        </Card>
      )}

      {data && data.aws_configured === false && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="pt-5 text-sm">
            AWS isn&apos;t configured on the Manager. Set <code className="font-mono">MATRX_ADMIN_AWS_*</code> in <code className="font-mono">/srv/apps/server-manager/.env</code> and redeploy the Manager.
          </CardContent>
        </Card>
      )}

      {loading && !data ? (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">Loading fleet…</CardContent></Card>
      ) : (
        data?.hosts?.map((h) => (
          <Card key={h.id} className={h.online ? "" : "border-amber-500/40"}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <CardTitle className="text-base flex items-center gap-2">
                  <Server className="size-4 text-muted-foreground" />
                  <span className="font-mono">{h.id}</span>
                  {h.online
                    ? <Badge variant="success" className="text-[10px]"><CheckCircle2 className="size-3 mr-1" />online</Badge>
                    : <Badge variant="destructive" className="text-[10px]"><XCircle className="size-3 mr-1" />{h.ssm?.ping || "offline"}</Badge>}
                  {h.ec2?.state && <Badge variant="secondary" className="text-[10px]">{h.ec2.state}</Badge>}
                </CardTitle>
                {canPower && (
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="outline" disabled={!!busy} onClick={() => power(h.id, "reboot")} title="Reboot instance">
                      <RotateCw className="size-4" /> Reboot
                    </Button>
                    <Button size="sm" variant="outline" disabled={!!busy} onClick={() => power(h.id, h.ec2?.state === "stopped" ? "start" : "stop")} title="Start/stop instance">
                      <Power className="size-4" /> {h.ec2?.state === "stopped" ? "Start" : "Stop"}
                    </Button>
                  </div>
                )}
              </div>
              <CardDescription className="text-xs">{h.role}</CardDescription>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              <div className="text-xs text-muted-foreground font-mono flex flex-wrap gap-x-4 gap-y-1">
                <span>{h.instanceId}</span>
                <span>{h.region}</span>
                {h.ec2?.type && <span>{h.ec2.type}</span>}
                {h.ec2?.az && <span>{h.ec2.az}</span>}
                {h.ec2?.privateIp && <span>priv {h.ec2.privateIp}</span>}
                {h.ec2?.publicIp && <span>pub {h.ec2.publicIp}</span>}
                {h.ssm?.platform && <span>{h.ssm.platform} {h.ssm.platformVersion}</span>}
              </div>

              {/* Run a command via SSM */}
              <div className="flex items-center gap-2">
                <Terminal className="size-4 text-muted-foreground shrink-0" />
                <Input
                  className="font-mono text-xs"
                  placeholder={canExec ? "shell command (e.g. systemctl status matrx-orchestrator)" : "requires deployer or admin role"}
                  value={cmd[h.id] || ""}
                  disabled={!canExec || !!busy}
                  onChange={(e) => setCmd((c) => ({ ...c, [h.id]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") runCommand(h.id); }}
                />
                <Button size="sm" disabled={!canExec || !!busy || !(cmd[h.id] || "").trim()} onClick={() => runCommand(h.id)}>
                  {busy === `${h.id}:exec` ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Run
                </Button>
              </div>

              {result[h.id] && (
                <div className="rounded-lg bg-zinc-950 text-zinc-300 p-3 font-mono text-xs max-h-80 overflow-y-auto">
                  <div className="text-zinc-500 mb-1">
                    status: {result[h.id]!.status}
                    {result[h.id]!.exitCode != null && ` · exit ${result[h.id]!.exitCode}`}
                  </div>
                  {result[h.id]!.stdout && <pre className="whitespace-pre-wrap text-zinc-200">{result[h.id]!.stdout}</pre>}
                  {result[h.id]!.stderr && <pre className="whitespace-pre-wrap text-red-400">{result[h.id]!.stderr}</pre>}
                  {result[h.id]!.error && <pre className="whitespace-pre-wrap text-red-400">{result[h.id]!.error}</pre>}
                </div>
              )}
            </CardContent>
          </Card>
        ))
      )}

      {data?.hosts && data.hosts.length === 0 && (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">No fleet hosts registered.</CardContent></Card>
      )}
    </PageShell>
  );
}
