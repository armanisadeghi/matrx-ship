"use client";

/**
 * Services — the PyPI-driven microservices the Manager owns end-to-end
 * (matrx-files, matrx-seo, …). Data-driven from the MICROSERVICES registry:
 * register a service in the backend and it appears here automatically.
 *
 * Per service: edge health, deployed vs PyPI version, auto-deploy state,
 * one-click Deploy latest, logs viewer. Env editing lives in Secrets (each
 * service has a remote store with a correct rm+run Apply).
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Boxes, RefreshCw, Loader2, Rocket, ScrollText, CheckCircle2, AlertTriangle, X, KeySquare,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@matrx/admin-ui/ui/button";
import { Card, CardContent } from "@matrx/admin-ui/ui/card";
import { Badge } from "@matrx/admin-ui/ui/badge";
import { PageShell } from "@matrx/admin-ui/components/page-shell";
import { useAuth } from "@/lib/auth-context";
import { api, API, ApiError } from "@/lib/api";

interface Service {
  id: string; label: string; host: string; container: string; port: number;
  public_base: string; health_path: string; env_file: string; pypi_package: string;
  edge_health: number | null; pypi_latest: string | null; deployed: string | null;
  deployment_state: "deployed" | "unhealthy" | "stopped" | "not_deployed" | "unknown";
  observed: {
    observed_at: string; exists: boolean; running: boolean; deployed: boolean; image: string | null;
    package_version: string | null; version: string | null; version_source: string | null;
    recorded_version: string | null; previous_version: string | null;
    record_matches_runtime: boolean | null; local_health: number | null;
    host_disk: {
      avail_kb: number | null; avail_gb: number | null; used_pct: number | null;
      deploy_min_gb: number; status: "ok" | "low" | "blocked" | "unknown";
    } | null;
  } | null;
  observation_error: string | null;
  auto_deploy: boolean; published: boolean;
}

export default function ServicesPage() {
  const { isSuperadmin } = useAuth();
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [logsFor, setLogsFor] = useState<string | null>(null);
  const [logs, setLogs] = useState<string>("");
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsTitle, setLogsTitle] = useState("last 200 log lines");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ services: Service[] }>("/api/microservices");
      setServices(r.services || []);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function deployLatest(s: Service) {
    setBusy(s.id);
    try {
      toast.info(`Deploying ${s.pypi_package} ${s.pypi_latest || "latest"} — build + verify + swap takes a few minutes…`);
      const r = await api<{ version: string; ok: boolean; error?: string }>(`/api/microservices/${s.id}/deploy`, { method: "POST" });
      if (r.ok) toast.success(`${s.pypi_package} ${r.version} deployed (health-verified).`);
      else {
        // The full build tail goes on screen. A one-line toast is exactly how a
        // disk-full failure read as a pip failure for a day (2026-08-11).
        const full = r.error || "see Manager logs";
        const disk = /DISK_FULL|No space left on device/.test(full);
        toast.error(disk
          ? `Deploy blocked: the host is out of disk — see the build output below.`
          : `Deploy failed — see the build output below. Previous version restored.`);
        setLogsFor(s.id); setLogsTitle("deploy output (full build tail)"); setLogsLoading(false); setLogs(full);
      }
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function viewLogs(s: Service) {
    setLogsFor(s.id);
    setLogsTitle("last 200 log lines");
    setLogsLoading(true);
    try {
      const res = await fetch(`/api/microservices/${s.id}/logs?lines=200`, {
        headers: { Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("manager_token") || "" : ""}` },
      });
      setLogs(await res.text());
    } catch (e) {
      setLogs(`(failed to fetch logs: ${e instanceof Error ? e.message : e})`);
    } finally {
      setLogsLoading(false);
    }
  }

  return (
    <PageShell
      title="Services"
      description="PyPI-driven microservices the Manager deploys and watches automatically. Release with aidream's release.sh — new versions auto-deploy within ~5 min. Env editing is in Secrets (each service has a store with a correct Apply)."
      actions={
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh
        </Button>
      }
    >
      <div className="space-y-3">
        {loading && services.length === 0 && (
          <Card><CardContent className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Checking services…
          </CardContent></Card>
        )}
        {services.map((s) => {
          const healthy = s.deployment_state === "deployed" && s.edge_health === 200;
          const current = healthy && !!s.deployed && !!s.pypi_latest && s.deployed === s.pypi_latest;
          const unpublished = !s.published;
          return (
            <Card key={s.id}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Boxes className="size-4 shrink-0" />
                  <span className="font-semibold">{s.label}</span>
                  {s.observation_error
                    ? <Badge variant="secondary"><AlertTriangle className="size-3 mr-1" /> runtime unknown</Badge>
                    : healthy
                    ? <Badge variant="success"><CheckCircle2 className="size-3 mr-1" /> healthy</Badge>
                    : <Badge variant="destructive"><AlertTriangle className="size-3 mr-1" /> {s.deployment_state === "not_deployed" ? "not deployed (observed)" : s.deployment_state === "stopped" ? "container stopped" : s.edge_health ? `unhealthy · edge ${s.edge_health}` : "unhealthy · edge unreachable"}</Badge>}
                  {unpublished
                    ? <Badge variant="secondary">not published to PyPI yet</Badge>
                    : current
                      ? <Badge variant="success">v{s.deployed} · current</Badge>
                      : <Badge variant="secondary">{s.deployed ? `v${s.deployed}` : "version ?"} → PyPI v{s.pypi_latest}</Badge>}
                  {/* A full host disk leaves the service healthy but blocks every
                      future build — it has to be visible here, not only in the
                      failure it eventually causes. */}
                  {s.observed?.host_disk?.status === "blocked" && (
                    <Badge variant="destructive"><AlertTriangle className="size-3 mr-1" /> deploys blocked · disk {s.observed.host_disk.used_pct ?? "?"}% full</Badge>
                  )}
                  {s.observed?.host_disk?.status === "low" && (
                    <Badge variant="secondary"><AlertTriangle className="size-3 mr-1" /> disk low · {s.observed.host_disk.avail_gb ?? "?"}GB free</Badge>
                  )}
                  <Badge variant={s.auto_deploy ? "success" : "secondary"} className="text-[10px]">
                    auto-deploy {s.auto_deploy ? "on" : "off"}
                  </Badge>
                  <div className="flex-1" />
                  {isSuperadmin && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => viewLogs(s)}>
                        <ScrollText className="size-4" /> Logs
                      </Button>
                      <Button size="sm" onClick={() => deployLatest(s)} disabled={busy === s.id || unpublished}>
                        {busy === s.id ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
                        Deploy latest
                      </Button>
                    </>
                  )}
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                  <a href={s.public_base + s.health_path} target="_blank" rel="noopener" className="text-primary hover:underline">{s.public_base}</a>
                  <span>container <code className="bg-muted px-1 rounded">{s.container}</code> on {s.host}</span>
                  <span>PyPI <code className="bg-muted px-1 rounded">{s.pypi_package}</code></span>
                  <Link href="/secrets" className="text-primary hover:underline flex items-center gap-1">
                    <KeySquare className="size-3" /> env: {s.env_file}
                  </Link>
                </div>
                {s.observed && (
                  <div className="text-xs rounded bg-muted/40 px-3 py-2 flex flex-wrap gap-x-4 gap-y-1">
                    <span>Observed image <code>{s.observed.image || "none"}</code></span>
                    <span>local health {s.observed.local_health || "unreachable"}</span>
                    <span>{s.observed.version_source || "runtime version"}: {s.observed.version || "unknown"}</span>
                    <span>{s.observed.recorded_version
                      ? s.observed.record_matches_runtime === false
                        ? `CURRENT record ${s.observed.recorded_version} does not match runtime`
                        : `CURRENT record ${s.observed.recorded_version} matches runtime`
                      : "No CURRENT version record; runtime inspection is authoritative"}</span>
                    {s.observed.previous_version && <span>rollback target v{s.observed.previous_version} (kept by the deploy prune)</span>}
                    {s.observed.host_disk?.avail_gb != null && (
                      <span className={s.observed.host_disk.status === "blocked" ? "text-destructive" : undefined}>
                        host disk {s.observed.host_disk.avail_gb}GB free
                        {s.observed.host_disk.used_pct != null ? ` (${s.observed.host_disk.used_pct}% used` : ""}
                        {s.observed.host_disk.used_pct != null ? `, builds need ${s.observed.host_disk.deploy_min_gb}GB)` : ""}
                      </span>
                    )}
                  </div>
                )}
                {s.observation_error && <div className="text-xs text-destructive">Host observation failed: {s.observation_error}</div>}
                {logsFor === s.id && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">{logsTitle}</span>
                      <Button size="sm" variant="ghost" onClick={() => setLogsFor(null)}><X className="size-4" /></Button>
                    </div>
                    {logsLoading
                      ? <div className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="size-3 animate-spin" /> fetching…</div>
                      : <pre className="max-h-80 overflow-auto rounded-md border bg-muted/30 p-2 font-mono text-[11px] leading-4 whitespace-pre-wrap">{logs}</pre>}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </PageShell>
  );
}
