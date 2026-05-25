"use client";

import { useEffect, useState, useCallback } from "react";
import { KeyRound, ShieldCheck, ShieldAlert, Copy, Check, Loader2, Trash2, Server, Box, Database, Network, RefreshCw, AlertTriangle } from "lucide-react";
import { Button } from "@matrx/admin-ui/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@matrx/admin-ui/ui/card";
import { Badge } from "@matrx/admin-ui/ui/badge";
import { PageShell } from "@matrx/admin-ui/components/page-shell";
import { useAuth } from "@/lib/auth-context";
import { api, API, ApiError } from "@/lib/api";

interface Target {
  target: string;
  name: string;
  kind: string;
  title: string;
  description: string;
  danger: boolean;
  image: string;
  state: string;
  status: string;
}
interface Binding {
  sandbox_id: string;
  base_url: string;
  access_token: string;
  root_path: string;
  target: string;
  scopes: string[];
  jti: string;
  expires_at: string;
}

const TTL_CHOICES = [
  { label: "5 min", value: 300 },
  { label: "1 hour", value: 3600 },
  { label: "4 hours", value: 14400 },
  { label: "12 hours", value: 43200 },
];

function kindIcon(kind: string) {
  if (kind === "host") return <Server className="size-4" />;
  if (kind === "database" || kind === "instance-db" || kind === "db-admin") return <Database className="size-4" />;
  if (kind === "proxy") return <Network className="size-4" />;
  return <Box className="size-4" />;
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button size="sm" variant="outline" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* */ }
    }}>
      {copied ? <Check className="size-4 text-green-500" /> : <Copy className="size-4" />} {label || (copied ? "Copied" : "Copy")}
    </Button>
  );
}

export default function AgentAccessPage() {
  const { isSuperadmin } = useAuth();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [targets, setTargets] = useState<Target[]>([]);
  const [ttl, setTtl] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [binding, setBinding] = useState<Binding | null>(null);
  const [revoked, setRevoked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await api<{ enabled: boolean }>(API.AGENT_GW_STATUS);
      setEnabled(s.enabled);
    } catch (e) {
      setEnabled(false);
      if (e instanceof ApiError && e.status !== 503) setError(e.message);
    }
    try {
      const t = await api<{ targets: Target[] }>(API.AGENT_GW_TARGETS);
      setTargets(t.targets || []);
    } catch { /* targets best-effort */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function grant(target: string) {
    if (busy) return;
    setBusy(target);
    setError(null);
    setBinding(null);
    setRevoked(false);
    try {
      const b = await api<Binding>(API.AGENT_GW_GRANT, { method: "POST", body: JSON.stringify({ target, ttl: ttl[target] || 3600 }) });
      setBinding(b);
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function revoke() {
    if (!binding) return;
    try { await api(API.AGENT_GW_REVOKE, { method: "POST", body: JSON.stringify({ jti: binding.jti }) }); setRevoked(true); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <PageShell
      title="Agent Access"
      description="Give a coding agent real, time-limited access to the server or one of its containers — the same access a developer has, not a throwaway sandbox. Pick a row, choose how long, and click Grant. The credentials expire on their own, can be revoked instantly, and every command is logged."
      actions={<Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /> Refresh</Button>}
    >
      {enabled === false && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="pt-5 text-sm flex items-start gap-2">
            <ShieldAlert className="size-5 text-amber-500 shrink-0" />
            <div>Agent access is <strong>turned off</strong>. Set <code className="font-mono">AGENT_GW_SECRET</code> (32+ chars) in <code className="font-mono">/srv/apps/server-manager/.env</code> and rebuild the Manager.</div>
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-destructive/40"><CardContent className="pt-5 text-sm font-mono text-destructive break-all">{error}</CardContent></Card>
      )}

      {enabled && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="size-4 text-green-500" /> Grantable targets
              <Badge variant="success" className="text-[10px]">enabled</Badge>
            </CardTitle>
            <CardDescription className="text-xs">
              Each row is something an agent can be given access to. Items marked <span className="inline-flex items-center gap-1 text-amber-600"><AlertTriangle className="size-3" /> infrastructure</span> control the whole environment — grant with care.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Target</th>
                    <th className="px-4 py-2 font-medium">What it is</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium text-right">Grant access</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && targets.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">Loading targets…</td></tr>
                  ) : targets.map((t) => {
                    const running = t.state === "running" || t.kind === "host";
                    return (
                      <tr key={t.target} className="border-b last:border-0 align-top hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 font-medium">
                            {kindIcon(t.kind)}
                            <span>{t.title}</span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-2">
                            <span className="font-mono text-[11px] text-muted-foreground">{t.name}</span>
                            {t.danger && <Badge variant="destructive" className="text-[9px] px-1"><AlertTriangle className="size-2.5 mr-0.5" />infrastructure</Badge>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground max-w-md">{t.description}</td>
                        <td className="px-4 py-3">
                          <Badge variant={running ? "success" : "secondary"} className="text-[10px]">{t.kind === "host" ? "host" : t.state || "—"}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <select
                              className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                              value={ttl[t.target] || 3600}
                              disabled={!isSuperadmin || !running}
                              onChange={(e) => setTtl((m) => ({ ...m, [t.target]: Number(e.target.value) }))}
                            >
                              {TTL_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                            </select>
                            <Button size="sm" disabled={!isSuperadmin || !running || !!busy} onClick={() => grant(t.target)}>
                              {busy === t.target ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />} Grant
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* The minted binding */}
      {binding && (
        <Card className={revoked ? "opacity-60" : "border-green-500/40"}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <KeyRound className="size-4" /> Access for <span className="font-mono">{binding.target}</span>
              {revoked ? <Badge variant="destructive" className="text-[10px]">revoked</Badge> : <Badge variant="success" className="text-[10px]">active</Badge>}
            </CardTitle>
            <CardDescription className="text-xs">Expires {new Date(binding.expires_at).toLocaleString()} · scopes: {binding.scopes.join(", ")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">Give these to the agent. The access key is secret — treat it like a password.</p>
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Base URL</div>
              <div className="flex items-center gap-2"><code className="flex-1 font-mono text-xs bg-muted rounded px-2 py-1.5 break-all">{binding.base_url}</code><CopyButton text={binding.base_url} /></div>
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Access key</div>
              <div className="flex items-center gap-2"><code className="flex-1 font-mono text-xs bg-muted rounded px-2 py-1.5 break-all">{binding.access_token}</code><CopyButton text={binding.access_token} /></div>
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Working directory the agent sees as its root</div>
              <code className="font-mono text-xs bg-muted rounded px-2 py-1.5 inline-block">{binding.root_path}</code>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <CopyButton text={JSON.stringify(binding, null, 2)} label="Copy all (JSON)" />
              <Button size="sm" variant="destructive" onClick={revoke} disabled={revoked}><Trash2 className="size-4" /> Revoke now</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
