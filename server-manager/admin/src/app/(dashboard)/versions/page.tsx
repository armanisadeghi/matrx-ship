"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  RefreshCw, CheckCircle2, AlertTriangle, XCircle, Loader2, ArrowUpCircle,
  ChevronDown, ChevronRight, ScrollText,
} from "lucide-react";
import { Button } from "@matrx/admin-ui/ui/button";
import { Card, CardContent } from "@matrx/admin-ui/ui/card";
import { Badge } from "@matrx/admin-ui/ui/badge";
import { PageShell } from "@matrx/admin-ui/components/page-shell";
import { useAuth } from "@/lib/auth-context";
import { api, API, ApiError } from "@/lib/api";

interface AppRow { name: string; display_name: string; on_latest: boolean }
interface Update { action: string; label: string; data_safe: boolean; note?: string }
interface SystemRow {
  id: string; name: string; kind: string;
  current: string; latest: string;
  status: "ok" | "behind" | "error" | string;
  detail: string;
  apps?: AppRow[]; behind_count?: number;
  update: Update | null;
}
interface VersionsResp { overall: string; systems: SystemRow[]; generated_at: string }

function StatusBadge({ status }: { status: string }) {
  if (status === "ok") return <Badge variant="success" className="text-[10px]"><CheckCircle2 className="size-3 mr-1" />up to date</Badge>;
  if (status === "behind") return <Badge variant="destructive" className="text-[10px]"><AlertTriangle className="size-3 mr-1" />BEHIND</Badge>;
  return <Badge variant="secondary" className="text-[10px]"><XCircle className="size-3 mr-1" />{status === "error" ? "unreachable" : status}</Badge>;
}

export default function VersionsPage() {
  const { authed, isSuperadmin } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<VersionsResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [appBusy, setAppBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api<VersionsResp>(API.VERSIONS)); setError(null); }
    catch (e) { setError(e instanceof ApiError ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (authed) load(); }, [authed, load]);

  async function runUpdate(sys: SystemRow) {
    if (!sys.update || busy) return;
    const u = sys.update;
    setBusy(sys.id);
    try {
      if (u.action === "migrate-all") {
        const r = await api<{ migrated?: string[]; deferred?: string[]; failed?: string[] }>(API.ORCH_SANDBOXES_MIGRATE_ALL, { method: "POST" });
        toast.success(`Migrated ${r.migrated?.length ?? 0}, deferred ${r.deferred?.length ?? 0}, failed ${r.failed?.length ?? 0}.`);
      } else if (u.action === "orch-redeploy") {
        toast.info("Rebuilding + restarting the orchestrator — a minute or so…");
        await api(API.ORCH_REDEPLOY, { method: "POST" });
        toast.success("Orchestrator rebuilt and restarted.");
      } else if (u.action === "ship-rebuild") {
        toast.info("Rebuilding & redeploying all apps — this can take a couple of minutes…");
        await api(API.REBUILD, { method: "POST" });
        toast.success("Ship rebuilt and all apps redeployed.");
      }
      await load();
    } catch (e) {
      toast.error(`Update failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function redeployApp(name: string) {
    if (appBusy || busy) return;
    setAppBusy(name);
    try {
      toast.info(`Redeploying ${name} onto the current image…`);
      await api(API.REBUILD, { method: "POST", body: JSON.stringify({ name, skip_build: true }) });
      toast.success(`${name} redeployed.`);
      await load();
    } catch (e) {
      toast.error(`Redeploy failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAppBusy(null);
    }
  }

  const behindCount = data?.systems.filter((s) => s.status === "behind").length ?? 0;

  return (
    <PageShell
      title="Versions & Updates"
      description="What's running vs the latest, for every system. Anything BEHIND is red — click Update to bring it current. Updates that touch user data (sandboxes) are zero-loss by design."
      actions={<Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /> Refresh</Button>}
    >
      {error && (
        <Card className="border-destructive/40"><CardContent className="pt-5 text-sm font-mono text-destructive break-all">{error}</CardContent></Card>
      )}

      {data && (
        <Card className={behindCount > 0 ? "border-destructive/50 bg-destructive/5" : "border-green-500/40 bg-green-500/5"}>
          <CardContent className="pt-5 text-sm flex items-center gap-2">
            {behindCount > 0
              ? <><AlertTriangle className="size-5 text-destructive shrink-0" /><span><strong>{behindCount}</strong> system{behindCount > 1 ? "s are" : " is"} behind the latest version.</span></>
              : <><CheckCircle2 className="size-5 text-green-500 shrink-0" /><span>Everything is on the latest version.</span></>}
          </CardContent>
        </Card>
      )}

      {loading && !data ? (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">Checking versions…</CardContent></Card>
      ) : data?.systems.map((sys) => {
        const behind = sys.status === "behind";
        const hasApps = sys.apps && sys.apps.length > 0;
        const isOpen = expanded === sys.id;
        return (
          <Card key={sys.id} className={behind ? "border-destructive/50" : ""}>
            <CardContent className="pt-5 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{sys.name}</span>
                    <StatusBadge status={sys.status} />
                  </div>
                  <div className="text-sm text-muted-foreground">{sys.detail}</div>
                  <div className="flex flex-wrap gap-x-6 gap-y-0.5 text-xs text-muted-foreground font-mono pt-1">
                    <span>running: {sys.current}</span>
                    <span>latest: {sys.latest}</span>
                  </div>
                </div>
                {sys.update && behind && (
                  <div className="shrink-0">
                    <Button size="sm" variant="destructive" disabled={!isSuperadmin || !!busy} onClick={() => runUpdate(sys)} title={!isSuperadmin ? "Requires super-admin" : sys.update.note}>
                      {busy === sys.id ? <Loader2 className="size-4 animate-spin" /> : <ArrowUpCircle className="size-4" />} {sys.update.label}
                    </Button>
                    {sys.update.data_safe && <div className="text-[10px] text-muted-foreground mt-1 text-right">✓ no data loss</div>}
                  </div>
                )}
              </div>

              {sys.update?.note && behind && (
                <div className="text-xs text-muted-foreground bg-muted/40 rounded px-3 py-2">{sys.update.note}</div>
              )}

              {/* Per-app breakdown for the Ship platform row */}
              {hasApps && (
                <div>
                  <button type="button" onClick={() => setExpanded(isOpen ? null : sys.id)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                    {isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                    {sys.behind_count ? `${sys.behind_count} of ${sys.apps!.length} apps behind` : `all ${sys.apps!.length} apps current`}
                  </button>
                  {isOpen && (
                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {sys.apps!.map((a) => (
                        <div key={a.name} className="flex items-center gap-1.5 text-xs">
                          {a.on_latest ? <CheckCircle2 className="size-3 text-green-500 shrink-0" /> : <AlertTriangle className="size-3 text-destructive shrink-0" />}
                          <span className={a.on_latest ? "text-muted-foreground" : "text-foreground font-medium"}>{a.display_name}</span>
                          <span className="font-mono text-muted-foreground/60">{a.name}</span>
                          <div className="flex-1" />
                          {!a.on_latest && (
                            <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={!isSuperadmin || !!busy || appBusy === a.name} onClick={() => redeployApp(a.name)}>
                              {appBusy === a.name ? <Loader2 className="size-3 animate-spin" /> : <ArrowUpCircle className="size-3" />} Redeploy
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <ScrollText className="size-3.5" />
        For live build logs, use <button className="underline" onClick={() => router.push("/builds")}>Builds</button>. EC2-tier deploys run via GitHub Actions on push.
      </p>
    </PageShell>
  );
}
