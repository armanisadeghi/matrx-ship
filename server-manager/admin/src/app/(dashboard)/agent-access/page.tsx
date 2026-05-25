"use client";

import { useEffect, useState, useCallback } from "react";
import { KeyRound, ShieldCheck, ShieldAlert, Copy, Check, Loader2, Trash2, Server, Box } from "lucide-react";
import { Button } from "@matrx/admin-ui/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@matrx/admin-ui/ui/card";
import { Badge } from "@matrx/admin-ui/ui/badge";
import { PageShell } from "@matrx/admin-ui/components/page-shell";
import { useAuth } from "@/lib/auth-context";
import { api, API, ApiError } from "@/lib/api";

interface Container { name: string; image: string; status: string; state: string }
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
  { label: "5 minutes", value: 300 },
  { label: "1 hour", value: 3600 },
  { label: "4 hours", value: 14400 },
  { label: "12 hours", value: 43200 },
];

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* */ }
      }}
    >
      {copied ? <Check className="size-4 text-green-500" /> : <Copy className="size-4" />} {label || (copied ? "Copied" : "Copy")}
    </Button>
  );
}

export default function AgentAccessPage() {
  const { authed, role } = useAuth();
  const isAdmin = role === "admin";

  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [containers, setContainers] = useState<Container[]>([]);
  const [target, setTarget] = useState("host");
  const [ttl, setTtl] = useState(3600);
  const [busy, setBusy] = useState(false);
  const [binding, setBinding] = useState<Binding | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoked, setRevoked] = useState(false);

  const load = useCallback(async () => {
    if (!authed) return;
    try {
      const s = await api<{ enabled: boolean }>(API.AGENT_GW_STATUS);
      setEnabled(s.enabled);
    } catch (e) {
      setEnabled(false);
      if (e instanceof ApiError && e.status !== 503) setError(e.message);
    }
    try {
      const c = await api<{ containers: Container[] }>(API.CONTAINERS);
      setContainers((c.containers || []).filter((x) => x.state === "running"));
    } catch { /* containers optional */ }
  }, [authed]);

  useEffect(() => { load(); }, [load]);

  async function grant() {
    if (busy || !isAdmin) return;
    setBusy(true);
    setError(null);
    setBinding(null);
    setRevoked(false);
    try {
      const b = await api<Binding>(API.AGENT_GW_GRANT, { method: "POST", body: JSON.stringify({ target, ttl }) });
      setBinding(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!binding) return;
    try {
      await api(API.AGENT_GW_REVOKE, { method: "POST", body: JSON.stringify({ jti: binding.jti }) });
      setRevoked(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <PageShell
      title="Agent Access"
      description="Give a coding agent real, time-limited access to this server or one of its containers — the same kind of access a developer has, not a throwaway sandbox. Hand the generated credentials to the agent; they expire on their own and can be revoked instantly."
    >
      {/* What this is, in plain terms */}
      <Card className="bg-muted/30">
        <CardContent className="pt-5 text-sm text-muted-foreground space-y-1">
          <p>Pick what the agent should reach, choose how long the access lasts, and click <strong>Grant access</strong>.</p>
          <p>You&apos;ll get a <strong>base URL</strong> + <strong>access key</strong> to give the agent. The key only works for the one thing you picked, only until it expires, and every command the agent runs is logged.</p>
        </CardContent>
      </Card>

      {/* On/off status */}
      {enabled === false && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="pt-5 text-sm flex items-start gap-2">
            <ShieldAlert className="size-5 text-amber-500 shrink-0" />
            <div>
              Agent access is currently <strong>turned off</strong>. To enable it, set <code className="font-mono">AGENT_GW_SECRET</code> (32+ characters) in <code className="font-mono">/srv/apps/server-manager/.env</code> and rebuild the Manager.
            </div>
          </CardContent>
        </Card>
      )}

      {enabled && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="size-4 text-green-500" /> Grant access
              <Badge variant="success" className="text-[10px]">enabled</Badge>
            </CardTitle>
            <CardDescription className="text-xs">
              {isAdmin ? "Admin only. Choose a target and duration." : "Requires the admin role."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Target picker */}
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">What should the agent reach?</div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!isAdmin}
                  onClick={() => setTarget("host")}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${target === "host" ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}
                >
                  <Server className="size-4" /> This server (/srv)
                </button>
                {containers.map((c) => {
                  const t = `container:${c.name}`;
                  return (
                    <button
                      key={c.name}
                      type="button"
                      disabled={!isAdmin}
                      onClick={() => setTarget(t)}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-mono ${target === t ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}
                    >
                      <Box className="size-4" /> {c.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* TTL */}
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">How long should it last?</div>
              <div className="flex flex-wrap gap-2">
                {TTL_CHOICES.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    disabled={!isAdmin}
                    onClick={() => setTtl(c.value)}
                    className={`rounded-lg border px-3 py-1.5 text-sm ${ttl === c.value ? "border-primary bg-primary/10" : "border-border hover:bg-muted"}`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            <Button onClick={grant} disabled={!isAdmin || busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />} Grant access
            </Button>
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="pt-5 text-sm font-mono text-destructive break-all">{error}</CardContent>
        </Card>
      )}

      {/* The minted binding */}
      {binding && (
        <Card className={revoked ? "opacity-60" : "border-green-500/40"}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <KeyRound className="size-4" /> Access for <span className="font-mono">{binding.target}</span>
              {revoked
                ? <Badge variant="destructive" className="text-[10px]">revoked</Badge>
                : <Badge variant="success" className="text-[10px]">active</Badge>}
            </CardTitle>
            <CardDescription className="text-xs">
              Expires {new Date(binding.expires_at).toLocaleString()} · scopes: {binding.scopes.join(", ")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Give these two values to the agent. The access key is secret — treat it like a password.
            </p>

            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Base URL</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 font-mono text-xs bg-muted rounded px-2 py-1.5 break-all">{binding.base_url}</code>
                <CopyButton text={binding.base_url} />
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Access key</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 font-mono text-xs bg-muted rounded px-2 py-1.5 break-all">{binding.access_token}</code>
                <CopyButton text={binding.access_token} />
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Working directory the agent sees as its root</div>
              <code className="font-mono text-xs bg-muted rounded px-2 py-1.5 inline-block">{binding.root_path}</code>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <CopyButton text={JSON.stringify(binding, null, 2)} label="Copy all (JSON)" />
              <Button size="sm" variant="destructive" onClick={revoke} disabled={revoked}>
                <Trash2 className="size-4" /> Revoke now
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
