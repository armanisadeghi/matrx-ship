"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, ExternalLink, Power, AlertTriangle } from "lucide-react";
import { Button } from "@matrx/admin-ui/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@matrx/admin-ui/ui/card";
import { Badge } from "@matrx/admin-ui/ui/badge";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@matrx/admin-ui/ui/table";
import { PageShell } from "@matrx/admin-ui/components/page-shell";
import { useAuth } from "@/lib/auth-context";
import { api, API, ApiError } from "@/lib/api";

interface OrchSandbox {
  sandbox_id: string;
  user_id: string;
  status: string;
  container_id?: string | null;
  created_at: string;
  updated_at?: string | null;
  last_heartbeat_at?: string | null;
  stopped_at?: string | null;
  stop_reason?: string | null;
  ssh_port?: number | null;
  ttl_seconds?: number;
  expires_at?: string | null;
  tier?: string | null;
  template?: string | null;
  proxy_url?: string | null;
}

const LIVE_STATUSES = new Set(["creating", "starting", "ready", "running"]);
// The orchestrator's reaper refreshes updated_at for every live sandbox every
// ~60s. So a live-status row whose updated_at is older than this hasn't been
// confirmed alive recently — the orchestrator may have lost track of it (the
// "stuck running" failure mode). 5 min = comfortably past several sweeps.
const STALE_AFTER_MS = 5 * 60 * 1000;

function relativeAge(iso?: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function isStale(sbx: OrchSandbox): boolean {
  if (!LIVE_STATUSES.has(sbx.status)) return false;
  if (!sbx.updated_at) return true; // live but never stamped — suspicious
  return Date.now() - new Date(sbx.updated_at).getTime() > STALE_AFTER_MS;
}

interface OrchListResponse {
  sandboxes: OrchSandbox[];
  total: number;
}

interface OrchStatus {
  service?: string;
  version?: string;
  tier?: string;
  status?: string;
}

interface ImageInfo {
  variant: string;
  tag: string;
  present: boolean;
  id?: string;
  size_bytes?: number | null;
  created?: string | null;
}

interface ImageHealth {
  images: ImageInfo[];
  orchestrator: ImageInfo;
  missing: string[];
  checked_at: string;
}

const POLL_MS = 5000;

function fmtSize(bytes?: number | null): string {
  if (!bytes) return "—";
  const gb = bytes / 1e9;
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${Math.round(bytes / 1e6)} MB`;
}

export default function OrchestratorSandboxesPage() {
  const router = useRouter();
  const { authed } = useAuth();
  const [sandboxes, setSandboxes] = useState<OrchSandbox[]>([]);
  const [status, setStatus] = useState<OrchStatus | null>(null);
  const [images, setImages] = useState<ImageHealth | null>(null);
  const [restartBusy, setRestartBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [list, st, img] = await Promise.all([
        api<OrchListResponse>(API.ORCH_SANDBOXES),
        api<OrchStatus>(API.ORCH_STATUS).catch(() => null),
        api<ImageHealth>(API.SANDBOX_IMAGES_HEALTH).catch(() => null),
      ]);
      setSandboxes(list.sandboxes ?? []);
      setStatus(st);
      setImages(img);
      setError(null);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const restartOrchestrator = useCallback(async () => {
    if (!confirm("Restart the orchestrator? It recreates the container (brief blip); running sandbox containers are untouched and reconciled on boot.")) {
      return;
    }
    setRestartBusy(true);
    try {
      await api(API.ORCH_RESTART, { method: "POST" });
      setTimeout(load, 3000);
    } catch (e) {
      alert(`Restart failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRestartBusy(false);
    }
  }, [load]);

  useEffect(() => {
    if (!authed) return;
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [authed, load]);

  return (
    <PageShell
      title="Orchestrator Sandboxes"
      description="Live view of every sandbox spawned by the hosted orchestrator. Click a row for full diagnostics + live logs."
      actions={
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="size-4" /> Refresh
        </Button>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Orchestrator status</CardTitle>
          <CardDescription>
            {status ? (
              <span className="font-mono text-xs">
                {status.service ?? "orchestrator"} · v{status.version ?? "?"} · tier=<b>{status.tier ?? "?"}</b> · {status.status ?? "?"}
              </span>
            ) : (
              "Connecting..."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground mr-1">Images:</span>
              {images ? (
                <>
                  {images.images.map((img) => (
                    <Badge
                      key={img.variant}
                      variant={img.present ? "secondary" : "destructive"}
                      title={img.present ? `${img.tag} · ${fmtSize(img.size_bytes)} · ${img.created ? new Date(img.created).toLocaleString() : ""}` : `${img.tag} is MISSING — sandbox spawns using this image will fail until it is rebuilt.`}
                    >
                      {!img.present && <AlertTriangle className="size-3" />} {img.variant}
                      {img.present ? "" : " · missing"}
                    </Badge>
                  ))}
                  <Badge
                    variant={images.orchestrator.present ? "secondary" : "destructive"}
                    title={images.orchestrator.present ? `${images.orchestrator.tag} · ${fmtSize(images.orchestrator.size_bytes)}` : "orchestrator image missing"}
                  >
                    orchestrator{images.orchestrator.present ? "" : " · missing"}
                  </Badge>
                </>
              ) : (
                <span className="text-xs text-muted-foreground">checking…</span>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={restartOrchestrator} disabled={restartBusy}>
              <Power className={`size-4 ${restartBusy ? "animate-pulse" : ""}`} /> Restart orchestrator
            </Button>
          </div>
          {images && images.missing.length > 0 && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
              <AlertTriangle className="size-4 text-destructive shrink-0 mt-0.5" />
              <span>
                Missing image tag(s): <b>{images.missing.join(", ")}</b>. Sandboxes that spawn from these
                will fail (the orchestrator falls through to a registry pull). Rebuild them before launching.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="pt-6 text-sm">
            <div className="font-medium text-destructive">Cannot reach orchestrator</div>
            <div className="font-mono text-xs text-muted-foreground mt-2 break-all">{error}</div>
            <p className="text-xs text-muted-foreground mt-3">
              Verify <code>MATRX_HOSTED_ORCHESTRATOR_URL</code> and <code>MATRX_HOSTED_ORCHESTRATOR_API_KEY</code> are
              set in <code>/srv/apps/server-manager/.env</code> and that the matrx-manager container has been recreated.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {loading && sandboxes.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-sm">Loading...</div>
          ) : sandboxes.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-sm">
              No sandboxes spawned by the orchestrator yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sandbox ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Tier / Template</TableHead>
                  <TableHead className="hidden md:table-cell">User</TableHead>
                  <TableHead>Last updated</TableHead>
                  <TableHead className="hidden lg:table-cell">Created</TableHead>
                  <TableHead className="hidden lg:table-cell">Expires</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sandboxes.map((sbx) => (
                  <TableRow
                    key={sbx.sandbox_id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/orchestrator-sandboxes/${sbx.sandbox_id}`)}
                  >
                    <TableCell className="font-mono text-xs">{sbx.sandbox_id}</TableCell>
                    <TableCell>
                      <Badge variant={sbx.status === "running" ? "success" : sbx.status === "creating" ? "secondary" : "destructive"}>
                        {sbx.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs">
                      <span className="font-mono">{sbx.tier ?? "—"}</span>{" "}
                      <span className="text-muted-foreground">/ {sbx.template ?? "bare"}</span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell font-mono text-xs text-muted-foreground">
                      {sbx.user_id?.slice(0, 8) ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {isStale(sbx) ? (
                        <Badge variant="destructive" title="Live status but not refreshed recently — the orchestrator may have lost track of this sandbox.">
                          stale · {relativeAge(sbx.updated_at)}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground" title={sbx.updated_at ?? undefined}>
                          {relativeAge(sbx.updated_at)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                      {sbx.created_at ? new Date(sbx.created_at).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                      {sbx.expires_at ? new Date(sbx.expires_at).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => router.push(`/orchestrator-sandboxes/${sbx.sandbox_id}`)}
                      >
                        <ExternalLink className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
