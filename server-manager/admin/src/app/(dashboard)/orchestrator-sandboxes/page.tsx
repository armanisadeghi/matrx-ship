"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw, ExternalLink, Power, AlertTriangle, Hammer, Terminal, Loader2, CheckCircle2, Plus } from "lucide-react";
import { Button } from "@matrx/admin-ui/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@matrx/admin-ui/ui/card";
import { Badge } from "@matrx/admin-ui/ui/badge";
import { Input } from "@matrx/admin-ui/ui/input";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@matrx/admin-ui/ui/table";
import { PageShell } from "@matrx/admin-ui/components/page-shell";
import { useConfirm } from "@matrx/admin-ui/components/confirm-dialog";
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
  required?: boolean;
  id?: string;
  size_bytes?: number | null;
  created?: string | null;
}

interface ImageHealth {
  images: ImageInfo[];
  orchestrator: ImageInfo;
  missing: string[];
  missing_required: string[];
  checked_at: string;
}

interface DriftBox {
  sandbox_id: string;
  template?: string | null;
  running_version?: string | null;
  current_version?: string | null;
  drifted: boolean;
  reason?: string;
}
interface DriftResponse {
  tier: string | null;
  total: number;
  drifted: number;
  stale_sandbox_ids: string[];
  boxes: DriftBox[];
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
  const ask = useConfirm();
  // While a rebuild/restart is in flight (and during the short post-recreate
  // window before the orchestrator's `/` answers again), we SUPPRESS the
  // "Cannot reach orchestrator" error card. Otherwise the rebuild succeeds,
  // the next poll catches Traefik's 404 page during container boot, and the
  // page splashes red despite everything working. See `runBuild` + `restartOrchestrator`.
  const [suppressError, setSuppressError] = useState(false);
  const [sandboxes, setSandboxes] = useState<OrchSandbox[]>([]);
  const [status, setStatus] = useState<OrchStatus | null>(null);
  const [images, setImages] = useState<ImageHealth | null>(null);
  const [restartBusy, setRestartBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Streaming build state (shared across image-variant + orchestrator rebuilds)
  const [building, setBuilding] = useState<string | null>(null);
  const [buildLogs, setBuildLogs] = useState<string[]>([]);
  const [buildPhase, setBuildPhase] = useState<string | null>(null);
  // Create-sandbox form state
  const [showCreate, setShowCreate] = useState(false);
  const [cUserId, setCUserId] = useState("");
  const [cTemplate, setCTemplate] = useState("slim");
  const [cTtlMin, setCTtlMin] = useState("120");
  const [creating, setCreating] = useState(false);
  // Zero-drift state
  const [drift, setDrift] = useState<DriftResponse | null>(null);
  const [migrateBusy, setMigrateBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, st, img, dr] = await Promise.all([
        api<OrchListResponse>(API.ORCH_SANDBOXES),
        api<OrchStatus>(API.ORCH_STATUS).catch(() => null),
        api<ImageHealth>(API.SANDBOX_IMAGES_HEALTH).catch(() => null),
        api<DriftResponse>(API.ORCH_SANDBOXES_DRIFT).catch(() => null),
      ]);
      setSandboxes(list.sandboxes ?? []);
      setStatus(st);
      setImages(img);
      setDrift(dr);
      setError(null);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleMigrateAll = useCallback(async () => {
    if (!drift || drift.drifted === 0) return;
    const ok = await ask({
      title: `Migrate ${drift.drifted} drifted sandbox(es)?`,
      description: "Swaps each container onto the current image. The per-user volume is preserved — no data loss. Busy boxes defer to the next sweep; calls during a swap transparently retry.",
      confirmLabel: `Migrate ${drift.drifted}`,
    });
    if (!ok) return;
    setMigrateBusy(true);
    try {
      await api(API.ORCH_SANDBOXES_MIGRATE_ALL, { method: "POST" });
      toast.success("Migration started.");
      setTimeout(load, 2500);
    } catch (e) {
      toast.error(`Migrate-all failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setMigrateBusy(false);
    }
  }, [drift, load, ask]);

  const handleCreate = useCallback(async () => {
    const ttl = Math.round(Number(cTtlMin) * 60);
    if (!/^[0-9a-f-]{36}$/i.test(cUserId.trim())) { toast.error("Enter a valid user UUID."); return; }
    if (!Number.isFinite(ttl) || ttl < 60 || ttl > 86400) { toast.error("TTL must be 1–1440 minutes."); return; }
    setCreating(true);
    try {
      const sb = await api<{ sandbox_id?: string }>(API.ORCH_SANDBOXES, {
        method: "POST",
        body: JSON.stringify({ user_id: cUserId.trim(), template: cTemplate || undefined, ttl_seconds: ttl, tier: "hosted" }),
      });
      setShowCreate(false);
      setCUserId("");
      if (sb?.sandbox_id) router.push(`/orchestrator-sandboxes/${sb.sandbox_id}`);
      else load();
    } catch (e) {
      toast.error(`Create failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCreating(false);
    }
  }, [cUserId, cTemplate, cTtlMin, router, load]);

  const restartOrchestrator = useCallback(async () => {
    const ok = await ask({
      title: "Restart the orchestrator?",
      description: "Recreates the orchestrator container. Brief blip; running sandbox containers are untouched and reconciled on boot.",
      confirmLabel: "Restart",
      variant: "warning",
    });
    if (!ok) return;
    setRestartBusy(true);
    setSuppressError(true);
    try {
      await api(API.ORCH_RESTART, { method: "POST" });
      // Backend already waits for `/` to answer 200 before returning; one more
      // probe to be safe before we re-poll the rest of the page.
      try { await api(API.ORCH_READY("hosted", 20000)); } catch { /* */ }
      toast.success("Orchestrator restarted.");
      await load();
    } catch (e) {
      toast.error(`Restart failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRestartBusy(false);
      setSuppressError(false);
    }
  }, [load, ask]);

  // Stream an SSE build (sandbox image variant or orchestrator image) into the
  // log viewer. Mirrors the Builds tab's fetch+getReader consumer.
  const runBuild = useCallback(async (label: string, url: string, confirmMsg?: string) => {
    if (building) return;
    if (confirmMsg) {
      const ok = await ask({
        title: label,
        description: confirmMsg,
        confirmLabel: "Rebuild",
        variant: "warning",
      });
      if (!ok) return;
    }
    // Whenever we touch the orchestrator container, suppress the "Cannot reach
    // orchestrator" card — the page polls every 5s and would otherwise flash
    // red during the brief Traefik-404 window between `force-recreate` and the
    // new orchestrator answering /. The suppression is cleared in `finally`
    // after we've waited for `/api/orchestrator/ready` to return 200.
    const recreatesOrch = url.includes("/orchestrator/build") || url.includes("/orchestrator/restart") || url.includes("/orchestrator/redeploy");
    if (recreatesOrch) setSuppressError(true);
    setBuilding(label);
    setBuildPhase("starting");
    setBuildLogs([`── Starting ${label} ──`]);
    const token = typeof window !== "undefined" ? localStorage.getItem("manager_token") || "" : "";
    try {
      const resp = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok && resp.headers.get("content-type")?.includes("application/json")) {
        const j = await resp.json();
        throw new Error(j.error || `HTTP ${resp.status}`);
      }
      const reader = resp.body?.getReader();
      if (!reader) throw new Error("No response stream");
      const decoder = new TextDecoder();
      let buffer = "";
      let eventType = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("event: ")) eventType = line.slice(7);
          else if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (eventType === "log") setBuildLogs((p) => [...p, data.message]);
              else if (eventType === "phase") { setBuildPhase(data.phase); setBuildLogs((p) => [...p, `── ${data.message} ──`]); }
              else if (eventType === "done") { setBuildPhase("done"); setBuildLogs((p) => [...p, `✓ ${data.message || "done"}`]); }
              else if (eventType === "error") { setBuildPhase("error"); setBuildLogs((p) => [...p, `✗ ${data.message || "failed"}`]); }
            } catch { /* skip malformed */ }
          }
        }
      }
    } catch (e) {
      setBuildPhase("error");
      setBuildLogs((p) => [...p, `✗ ${e instanceof Error ? e.message : String(e)}`]);
    } finally {
      setBuilding(null);
      if (recreatesOrch) {
        // Wait for the orchestrator's `/` to answer before re-polling and
        // clearing the suppression. If it never comes back, surface that
        // honestly via the next poll's error (suppression is time-bounded).
        try { await api(API.ORCH_READY("hosted", 30000)); toast.success("Orchestrator is back up."); } catch { /* */ }
        setSuppressError(false);
      }
      // Refresh the page state now that the rebuild is complete (and, when
      // applicable, the orchestrator has answered ready). Was a 2s sleep —
      // load it immediately so the user sees the new status instead of stale.
      load();
    }
  }, [building, load, ask]);

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
        <div className="flex gap-2">
          <Button variant="default" size="sm" onClick={() => setShowCreate((s) => !s)}>
            <Plus className="size-4" /> New sandbox
          </Button>
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
        </div>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Orchestrator status</CardTitle>
          <CardDescription>
            {status ? (
              <span className="font-mono text-xs">
                {status.service ?? "orchestrator"} · v{status.version ?? "?"} · tier=<b>{status.tier ?? "?"}</b> · <span className="text-success">reachable</span>
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
                      variant={img.present ? "secondary" : img.required ? "destructive" : "outline"}
                      title={img.present ? `${img.tag} · ${fmtSize(img.size_bytes)} · ${img.created ? new Date(img.created).toLocaleString() : ""}` : img.required ? `${img.tag} is MISSING and REQUIRED — sandbox spawns using this image will fail until it is rebuilt.` : `${img.tag} is absent (not required for spawns — core is a build dep, local is the deprecated pool).`}
                    >
                      {!img.present && img.required && <AlertTriangle className="size-3" />} {img.variant}
                      {img.present ? "" : img.required ? " · missing" : " · absent"}
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
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={restartOrchestrator} disabled={restartBusy || building !== null}
                title="Recreates the matrx-orchestrator container (no rebuild). Brief blip; running sandbox containers are untouched and reconciled on boot.">
                <Power className={`size-4 ${restartBusy ? "animate-pulse" : ""}`} /> Restart orchestrator
              </Button>
              <Button
                variant="outline"
                size="sm"
                title="Rebuilds matrx-orchestrator:latest (the orchestrator PROCESS image) from /srv/projects/matrx-sandbox/orchestrator and recreates its container. Does NOT touch the sandbox-image variants (core/slim/aidream) — those live below."
                onClick={() => runBuild("orchestrator process image rebuild", API.ORCH_BUILD_STREAM, "Rebuild matrx-orchestrator:latest from source and recreate the orchestrator container? This is the orchestrator process itself — it does NOT rebuild the sandbox images (aidream/core/slim).")}
                disabled={building !== null}
              >
                <Hammer className={`size-4 ${building === "orchestrator process image rebuild" ? "animate-pulse" : ""}`} /> Rebuild orchestrator process
              </Button>
            </div>
          </div>

          {/* Per-variant sandbox-image rebuilds (SSE streamed). Distinct from
              the "Rebuild orchestrator process" button above. The aidream
              build needs :core first; we route it through the dependency-aware
              endpoint so the operator never sees the "matrx-sandbox:core not
              built" failure again. */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground mr-1">Rebuild sandbox image:</span>
            {(["core", "slim", "local", "aidream"] as const).map((v) => {
              const url = v === "aidream" ? API.SANDBOX_IMAGES_REBUILD_MISSING_STREAM("aidream") : API.SANDBOX_IMAGE_BUILD_STREAM(v);
              const title = v === "aidream"
                ? "Rebuilds matrx-sandbox:aidream — and matrx-sandbox:core first if it's missing (aidream is built on top of core)."
                : `Rebuilds matrx-sandbox:${v}.`;
              return (
                <Button
                  key={v}
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  title={title}
                  onClick={() => runBuild(`${v} sandbox-image build`, url, `Rebuild matrx-sandbox:${v}? This can take several minutes${v === "aidream" ? " (matrx-sandbox:core is built first if it's missing)" : ""}.`)}
                  disabled={building !== null}
                >
                  <Hammer className={`size-3 ${building === `${v} sandbox-image build` ? "animate-pulse" : ""}`} /> {v}
                </Button>
              );
            })}
          </div>

          {images && images.missing_required.length > 0 && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
              <AlertTriangle className="size-4 text-destructive shrink-0 mt-0.5" />
              <span className="flex-1">
                Missing <b>required</b> image(s): <b>{images.missing_required.join(", ")}</b>. Sandboxes that
                spawn from these will fail (the orchestrator falls through to a registry pull). Rebuild before launching.
              </span>
              <Button
                size="sm"
                variant="destructive"
                className="h-7"
                onClick={() => runBuild("rebuild missing sandbox images", API.SANDBOX_IMAGES_REBUILD_MISSING_STREAM())}
                disabled={building !== null}
              >
                <Hammer className="size-3" /> Rebuild all missing
              </Button>
            </div>
          )}

          {buildLogs.length > 0 && (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs flex items-center gap-1.5 text-muted-foreground">
                  <Terminal className="size-3.5" /> Build output
                  {building && <Loader2 className="size-3.5 animate-spin text-primary" />}
                  {!building && buildPhase === "done" && <CheckCircle2 className="size-3.5 text-success" />}
                  {!building && buildPhase === "error" && <AlertTriangle className="size-3.5 text-destructive" />}
                </span>
                {!building && (
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => { setBuildLogs([]); setBuildPhase(null); }}>
                    Clear
                  </Button>
                )}
              </div>
              <div
                ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}
                className="bg-zinc-950 text-zinc-300 rounded-lg p-3 font-mono text-[11px] leading-relaxed max-h-80 overflow-y-auto whitespace-pre-wrap"
              >
                {buildLogs.map((line, i) => (
                  <div key={i} className={line.startsWith("✗") ? "text-red-400" : line.startsWith("✓") ? "text-green-400" : line.startsWith("──") ? "text-zinc-500" : ""}>
                    {line}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {showCreate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New sandbox</CardTitle>
            <CardDescription>
              Spawns a hosted-tier sandbox via the orchestrator. (EC2-tier create arrives with multi-tier support.)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-1">
                <label className="text-xs text-muted-foreground">User ID (UUID)</label>
                <Input value={cUserId} onChange={(e) => setCUserId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" className="font-mono text-xs" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Template</label>
                <select
                  value={cTemplate}
                  onChange={(e) => setCTemplate(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="slim">slim</option>
                  <option value="aidream">aidream</option>
                  <option value="">bare</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">TTL (minutes)</label>
                <Input type="number" value={cTtlMin} onChange={(e) => setCTtlMin(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleCreate} disabled={creating}>
                {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                {creating ? "Creating…" : "Create sandbox"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {error && !suppressError && (
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

      {drift && drift.drifted > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-500" /> Version drift
              <Badge variant="outline" className="ml-1">{drift.drifted} of {drift.total}</Badge>
            </CardTitle>
            <CardDescription>
              These boxes are running an older image than the current one for their template.
              Migrating swaps the container while preserving the per-user volume — no data loss;
              busy boxes defer; calls during a swap transparently retry.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="max-h-40 overflow-y-auto rounded border border-border/50 divide-y divide-border/40">
              {drift.boxes.filter((b) => b.drifted).map((b) => (
                <div key={b.sandbox_id} className="flex items-center justify-between px-3 py-1.5 text-xs">
                  <span className="font-mono">{b.sandbox_id}</span>
                  <span className="text-muted-foreground font-mono">
                    {(b.running_version || "unversioned").slice(0, 24)} → {(b.current_version || "current").slice(0, 24)}
                  </span>
                </div>
              ))}
            </div>
            <Button variant="default" size="sm" onClick={handleMigrateAll} disabled={migrateBusy || building !== null}>
              {migrateBusy ? <Loader2 className="size-4 animate-spin" /> : <Hammer className="size-4" />}
              {migrateBusy ? "Migrating…" : `Migrate all (${drift.drifted})`}
            </Button>
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
                  <TableHead className="text-right">Actions</TableHead>
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
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          title="Open a live shell inside this box"
                          disabled={sbx.status !== "running" || (sbx.tier ?? "hosted") === "ec2"}
                          onClick={() => router.push(`/orchestrator-sandboxes/${sbx.sandbox_id}?tab=terminal`)}
                        >
                          <Terminal className="size-3.5" /> Terminal
                        </Button>
                        <Button
                          variant="default"
                          size="sm"
                          title="Open this box — health, files, logs, terminal"
                          onClick={() => router.push(`/orchestrator-sandboxes/${sbx.sandbox_id}`)}
                        >
                          <ExternalLink className="size-3.5" /> Look inside
                        </Button>
                      </div>
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
