"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw, CheckCircle2, AlertTriangle, XCircle, HelpCircle, ArrowUpCircle, Loader2, ExternalLink, RotateCcw } from "lucide-react";
import { Button } from "@matrx/admin-ui/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@matrx/admin-ui/ui/card";
import { Badge } from "@matrx/admin-ui/ui/badge";
import { PageShell } from "@matrx/admin-ui/components/page-shell";
import { useConfirm } from "@matrx/admin-ui/components/confirm-dialog";
import { useAuth } from "@/lib/auth-context";
import { api, API, ApiError } from "@/lib/api";
import { CopyControls } from "@/components/admin/copy-controls";
import { BuildStreamDialog } from "@/components/admin/build-stream-dialog";

interface ActionDef {
  action: string;
  label: string;
  data_safe?: boolean;
  note?: string;
  variant?: string; // e.g. sandbox image variant
  url?: string; // for open-url actions
}
interface Check {
  id: string;
  label: string;
  status: "ok" | "warning" | "critical" | "unknown" | "restarting";
  detail: string;
  actions?: ActionDef[];
  [k: string]: unknown;
}
interface FleetHealth {
  overall: "ok" | "degraded" | "critical";
  checks: Check[];
  checked_at: string;
}

const POLL_MS = 30000;

function StatusIcon({ status }: { status: Check["status"] }) {
  if (status === "ok") return <CheckCircle2 className="size-5 text-success" />;
  if (status === "restarting") return <RotateCcw className="size-5 animate-spin text-blue-500" style={{ animationDuration: "2.5s" }} />;
  if (status === "warning") return <AlertTriangle className="size-5 text-amber-500" />;
  if (status === "critical") return <XCircle className="size-5 text-destructive" />;
  return <HelpCircle className="size-5 text-muted-foreground" />;
}

export default function FleetHealthPage() {
  const { authed, isSuperadmin } = useAuth();
  const router = useRouter();
  const ask = useConfirm();
  const [data, setData] = useState<FleetHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null); // `${checkId}:${actionIdx}`
  // Inline streaming-build dialog state (used by sandbox-image-rebuild actions
  // so the operator clicks ONE button and watches it build right here, in
  // dependency order — no navigating to another page and guessing which button).
  const [buildOpen, setBuildOpen] = useState(false);
  const [buildVariant, setBuildVariant] = useState<string | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      setData(await api<FleetHealth>(API.FLEET_HEALTH));
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

  async function runAction(check: Check, action: ActionDef, idx: number) {
    if (busy) return;
    // External-URL action — open in a new tab, no confirm needed.
    if (action.action === "open-url" && action.url) {
      window.open(action.url, "_blank", "noopener,noreferrer");
      return;
    }
    // Sandbox image rebuild — open the streaming-build dialog right here.
    // The backend handles dependency order (e.g. core → aidream), so the
    // operator just clicks once and watches it work.
    if (action.action === "sandbox-image-rebuild") {
      setBuildVariant(action.variant);
      setBuildOpen(true);
      return;
    }
    // Everything else: confirm modal then one-shot POST + refresh.
    const ok = await ask({
      title: action.label,
      description: `${check.label} — ${check.detail}`,
      confirmLabel: action.label,
      variant: action.data_safe ? "default" : "warning",
      children: action.note ? <div className="bg-muted/40 rounded px-3 py-2">{action.note}{action.data_safe && <div className="text-xs text-success mt-1">✓ no data loss</div>}</div> : undefined,
    });
    if (!ok) return;
    const key = `${check.id}:${idx}`;
    setBusy(key);
    try {
      if (action.action === "orch-restart") {
        toast.info("Restarting hosted orchestrator…");
        await api(API.ORCH_RESTART, { method: "POST" });
        toast.success("Orchestrator restarted.");
      } else if (action.action === "orch-pull-redeploy") {
        toast.info("Pulling latest + rebuilding the hosted orchestrator — a minute or so…");
        await api(API.ORCH_PULL_REDEPLOY, { method: "POST" });
        toast.success("Hosted orchestrator pulled latest, rebuilt, and restarted.");
      } else if (action.action === "ec2-trigger-deploy") {
        await api(API.EC2_TRIGGER_DEPLOY, { method: "POST" });
        toast.success("GitHub Deploy dispatched on main — EC2 updates in ~3–5 min.");
      } else {
        toast.error(`Unknown action: ${action.action}`);
      }
      await load();
    } catch (e) {
      toast.error(`${action.label} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  const overall = data?.overall;
  const overallVariant = overall === "ok" ? "success" : overall === "degraded" ? "secondary" : "destructive";

  return (
    <PageShell
      title="Fleet Health"
      description="The things that used to fail silently — cross-host code drift, missing or stale sandbox images, failed deploy runs. Each issue has a button to fix it inline."
      actions={
        <>
          {data && <CopyControls size={16} ai={{ view: "Fleet Health", description: "Live fleet checks + the action available for each issue.", data: data.checks }} />}
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
        </>
      }
    >
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            Overall:
            {overall ? <Badge variant={overallVariant}>{overall.toUpperCase()}</Badge> : <span className="text-muted-foreground text-sm">checking…</span>}
          </CardTitle>
          {data && <CardDescription className="text-xs">Last checked {new Date(data.checked_at).toLocaleString()} · auto-refreshes every 30s</CardDescription>}
        </CardHeader>
      </Card>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="pt-6 text-sm">
            <div className="font-medium text-destructive">Can&apos;t reach the Manager API</div>
            <div className="font-mono text-xs text-muted-foreground mt-2 break-all">{error}</div>
          </CardContent>
        </Card>
      )}

      {loading && !data ? (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">Running checks…</CardContent></Card>
      ) : (
        data?.checks.map((c) => {
          const actions = c.actions || [];
          const isOpen = c.status === "critical" || c.status === "warning";
          return (
            <Card key={c.id} className={c.status === "critical" ? "border-destructive/40" : c.status === "warning" ? "border-amber-500/40" : ""}>
              <CardContent className="pt-5">
                <div className="flex items-start gap-3">
                  <StatusIcon status={c.status} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{c.label}</span>
                      <Badge variant={c.status === "ok" ? "success" : c.status === "critical" ? "destructive" : "secondary"} className="text-[10px]">{c.status}</Badge>
                      <CopyControls ai={{ view: "Fleet Health", description: `Status of: ${c.label}`, data: c }} />
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{c.detail}</p>
                    {isOpen && actions.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {actions.map((a, i) => {
                          const key = `${c.id}:${i}`;
                          const isBusy = busy === key;
                          const isExternal = a.action === "open-url";
                          const requiresSuper = a.action === "orch-pull-redeploy" || a.action === "ec2-trigger-deploy";
                          const disabled = !!busy || (requiresSuper && !isSuperadmin);
                          return (
                            <Button
                              key={key}
                              size="sm"
                              variant={c.status === "critical" ? "destructive" : "default"}
                              disabled={disabled}
                              title={requiresSuper && !isSuperadmin ? "Requires super-admin" : a.note}
                              onClick={() => runAction(c, a, i)}
                            >
                              {isBusy ? <Loader2 className="size-4 animate-spin" /> : isExternal ? <ExternalLink className="size-4" /> : <ArrowUpCircle className="size-4" />}
                              {a.label}
                              {a.data_safe && !isExternal && <span className="ml-1 text-[10px] opacity-80">· no data loss</span>}
                            </Button>
                          );
                        })}
                      </div>
                    )}
                    {isOpen && actions.length === 0 && (
                      <p className="text-xs text-muted-foreground mt-3 italic">
                        No one-click fix exists for this kind of issue. Check the Versions page or Sandboxes for related controls.
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}

      {buildOpen && (
        <BuildStreamDialog
          open={buildOpen}
          onOpenChange={setBuildOpen}
          url={API.SANDBOX_IMAGES_REBUILD_MISSING_STREAM(buildVariant)}
          title={buildVariant ? `Rebuilding ${buildVariant} sandbox image` : "Rebuilding missing sandbox images"}
          description={buildVariant === "aidream"
            ? "Builds matrx-sandbox:core first if needed, then matrx-sandbox:aidream. The aidream build is large — expect several minutes."
            : "Builds the missing required sandbox image(s) in dependency order."}
          onComplete={() => load()}
        />
      )}
    </PageShell>
  );
}
