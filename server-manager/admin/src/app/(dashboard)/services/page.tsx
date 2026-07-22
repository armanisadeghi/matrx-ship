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
      else toast.error(`Deploy failed: ${r.error || "see Manager logs"} — previous version restored.`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function viewLogs(s: Service) {
    setLogsFor(s.id);
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
          const healthy = s.edge_health === 200;
          const current = !!s.deployed && !!s.pypi_latest && s.deployed === s.pypi_latest;
          const unpublished = !s.published;
          return (
            <Card key={s.id}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Boxes className="size-4 shrink-0" />
                  <span className="font-semibold">{s.label}</span>
                  {healthy
                    ? <Badge variant="success"><CheckCircle2 className="size-3 mr-1" /> healthy</Badge>
                    : <Badge variant="destructive"><AlertTriangle className="size-3 mr-1" /> {s.edge_health ? `HTTP ${s.edge_health}` : "unreachable"}</Badge>}
                  {unpublished
                    ? <Badge variant="secondary">not published to PyPI yet</Badge>
                    : current
                      ? <Badge variant="success">v{s.deployed} · current</Badge>
                      : <Badge variant="secondary">{s.deployed ? `v${s.deployed}` : "version ?"} → PyPI v{s.pypi_latest}</Badge>}
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
                {logsFor === s.id && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">last 200 log lines</span>
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
