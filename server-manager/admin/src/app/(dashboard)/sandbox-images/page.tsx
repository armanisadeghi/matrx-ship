"use client";

import { useEffect, useState, useCallback } from "react";
import {
  RefreshCw,
  Hammer,
  RotateCw,
  CheckCircle2,
  AlertTriangle,
  Package,
  Boxes,
} from "lucide-react";
import { Button } from "@matrx/admin-ui/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@matrx/admin-ui/ui/card";
import { Badge } from "@matrx/admin-ui/ui/badge";
import { PageShell } from "@matrx/admin-ui/components/page-shell";
import { BuildLogViewer } from "@matrx/admin-ui/components/build-log-viewer";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { api, API, ApiError } from "@/lib/api";

// ── Types (mirror /api/sandbox-images/health) ───────────────────────────────
interface ImageInfo {
  variant: string;
  required: boolean;
  tag: string;
  present: boolean;
  id?: string;
  size_bytes?: number | null;
  created?: string | null;
}
interface OrchInfo {
  tag: string;
  present: boolean;
  id?: string;
  size_bytes?: number | null;
  created?: string | null;
}
interface ImageHealth {
  images: ImageInfo[];
  orchestrator: OrchInfo;
  missing: string[];
  missing_required: string[];
  checked_at: string;
}

const POLL_MS = 60000;

// One-line description of what each variant is for, so an operator who lands
// here from the "missing image" banner knows what they're rebuilding.
const VARIANT_BLURB: Record<string, string> = {
  core: "Base image. Build dependency of :aidream; not spawned directly.",
  slim: "Lightweight coding box (git persistence). Default for new spawns.",
  local: "Deprecated static starter-pool image (sandbox-1..5).",
  aidream: "Full AI Dream box — agent loop + credentials baked in.",
};

function bytesHuman(n?: number | null): string {
  if (!n || n < 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let f = n;
  let i = 0;
  while (f >= 1024 && i < units.length - 1) { f /= 1024; i++; }
  return `${f < 10 ? f.toFixed(1) : Math.round(f)} ${units[i]}`;
}

function ageHuman(iso?: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "—";
  const d = Math.floor(ms / 86400000);
  if (d >= 1) return `${d}d ago`;
  const h = Math.floor(ms / 3600000);
  if (h >= 1) return `${h}h ago`;
  return `${Math.max(1, Math.floor(ms / 60000))}m ago`;
}

export default function SandboxImagesPage() {
  const { authed, role } = useAuth();
  const [data, setData] = useState<ImageHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Build streaming state (one build at a time).
  const [busy, setBusy] = useState<string | null>(null); // variant | "orchestrator" | "orchestrator-restart"
  const [buildLogs, setBuildLogs] = useState<string[]>([]);
  const [buildPhase, setBuildPhase] = useState<string | null>(null);

  const canBuild = role === "admin" || role === "deployer";
  const canBuildOrchImage = role === "admin"; // backend gates /orchestrator/build/stream to admin

  const load = useCallback(async () => {
    try {
      setData(await api<ImageHealth>(API.SANDBOX_IMAGES_HEALTH));
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

  // Consume an SSE build stream (mirrors useAdminActions.handleRebuildManager).
  async function streamBuild(url: string, label: string, busyKey: string) {
    if (busy) return;
    setBusy(busyKey);
    setBuildLogs([]);
    setBuildPhase("starting");
    const token = typeof window !== "undefined" ? localStorage.getItem("manager_token") || "" : "";
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      // A non-streaming error (400/403/503) comes back as JSON, not SSE.
      const ctype = response.headers.get("content-type") || "";
      if (!response.ok && !ctype.includes("text/event-stream")) {
        const txt = await response.text();
        throw new Error(`HTTP ${response.status}: ${txt.slice(0, 300)}`);
      }
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          let eventType = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) eventType = line.slice(7);
            else if (line.startsWith("data: ")) {
              try {
                const d = JSON.parse(line.slice(6));
                if (eventType === "log") setBuildLogs((p) => [...p, d.message]);
                else if (eventType === "phase") { setBuildPhase(d.phase); setBuildLogs((p) => [...p, `── ${d.message} ──`]); }
                else if (eventType === "done") { toast.success(`${label} complete`); setBuildPhase("done"); }
                else if (eventType === "error") { toast.error(`${label} failed: ${d.message || d.error || "unknown error"}`); setBuildPhase("error"); }
              } catch { /* skip malformed line */ }
            }
          }
        }
      }
    } catch (e) {
      toast.error(`${label} failed: ${(e as Error).message}`);
      setBuildPhase("error");
    } finally {
      setBusy(null);
      load();
    }
  }

  async function restartOrchestrator() {
    if (busy) return;
    setBusy("orchestrator-restart");
    const id = toast.loading("Restarting orchestrator…");
    try {
      const r = await api<{ success: boolean; error?: string }>(API.ORCH_RESTART, { method: "POST" });
      if (r.success) toast.success("Orchestrator container recreated", { id });
      else toast.error(`Restart failed: ${r.error || "unknown error"}`, { id });
    } catch (e) {
      toast.error(`Restart failed: ${(e as Error).message}`, { id });
    } finally {
      setBusy(null);
      load();
    }
  }

  const missingRequired = data?.missing_required ?? [];

  return (
    <PageShell
      title="Sandbox Images"
      description="Rebuild the Docker images the orchestrator spawns sandboxes from. The 2026-04-30 incident — stripped image tags with no way to rebuild from the UI — is what this page exists to prevent."
      actions={
        <Button variant="outline" size="sm" onClick={load} disabled={!!busy}>
          <RefreshCw className="size-4" /> Refresh
        </Button>
      }
    >
      {missingRequired.length > 0 && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-5 flex items-start gap-3">
            <AlertTriangle className="size-5 shrink-0 text-destructive" />
            <div className="text-sm">
              <div className="font-medium text-destructive">
                Missing required image(s): {missingRequired.join(", ")}
              </div>
              <div className="text-muted-foreground mt-1">
                Sandbox spawning will fail until these are rebuilt. Click Rebuild on the matching card below.
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="pt-6 text-sm">
            <div className="font-medium text-destructive">Can&apos;t reach the Manager API</div>
            <div className="font-mono text-xs text-muted-foreground mt-2 break-all">{error}</div>
          </CardContent>
        </Card>
      )}

      {loading && !data ? (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">Checking images…</CardContent></Card>
      ) : (
        <>
          {/* Sandbox image variants */}
          {data?.images.map((img) => (
            <Card key={img.variant} className={img.required && !img.present ? "border-destructive/40" : ""}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Package className="size-4 text-muted-foreground" />
                    <span className="font-mono">{img.tag}</span>
                    {img.present
                      ? <Badge variant="success" className="text-[10px]"><CheckCircle2 className="size-3 mr-1" />present</Badge>
                      : <Badge variant={img.required ? "destructive" : "secondary"} className="text-[10px]">missing</Badge>}
                    {img.required && <Badge variant="outline" className="text-[10px]">required</Badge>}
                  </CardTitle>
                  <Button
                    size="sm"
                    variant={img.required && !img.present ? "default" : "outline"}
                    disabled={!canBuild || !!busy}
                    title={!canBuild ? "Requires deployer or admin role" : undefined}
                    onClick={() => streamBuild(API.SANDBOX_IMAGE_BUILD_STREAM(img.variant), `Rebuild ${img.tag}`, img.variant)}
                  >
                    <Hammer className="size-4" /> {busy === img.variant ? "Building…" : "Rebuild"}
                  </Button>
                </div>
                <CardDescription className="text-xs">{VARIANT_BLURB[img.variant] || ""}</CardDescription>
              </CardHeader>
              <CardContent className="pt-0 text-xs text-muted-foreground flex gap-4 font-mono">
                <span>id: {img.id || "—"}</span>
                <span>size: {bytesHuman(img.size_bytes)}</span>
                <span>built: {ageHuman(img.created)}</span>
              </CardContent>
            </Card>
          ))}

          {/* Orchestrator image */}
          {data && (
            <Card className={!data.orchestrator.present ? "border-destructive/40" : ""}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Boxes className="size-4 text-muted-foreground" />
                    <span className="font-mono">{data.orchestrator.tag}</span>
                    {data.orchestrator.present
                      ? <Badge variant="success" className="text-[10px]"><CheckCircle2 className="size-3 mr-1" />present</Badge>
                      : <Badge variant="destructive" className="text-[10px]">missing</Badge>}
                    <Badge variant="outline" className="text-[10px]">required</Badge>
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canBuild || !!busy}
                      title={!canBuild ? "Requires deployer or admin role" : "Recreate the container without rebuilding the image"}
                      onClick={restartOrchestrator}
                    >
                      <RotateCw className="size-4" /> {busy === "orchestrator-restart" ? "Restarting…" : "Restart"}
                    </Button>
                    <Button
                      size="sm"
                      variant={!data.orchestrator.present ? "default" : "outline"}
                      disabled={!canBuildOrchImage || !!busy}
                      title={!canBuildOrchImage ? "Requires admin role" : "Rebuild the image then recreate the container"}
                      onClick={() => streamBuild(API.ORCH_BUILD_STREAM, "Rebuild orchestrator", "orchestrator")}
                    >
                      <Hammer className="size-4" /> {busy === "orchestrator" ? "Building…" : "Rebuild + recreate"}
                    </Button>
                  </div>
                </div>
                <CardDescription className="text-xs">
                  The FastAPI control plane that spawns + manages sandboxes (matrx-orchestrator).
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0 text-xs text-muted-foreground flex gap-4 font-mono">
                <span>id: {data.orchestrator.id || "—"}</span>
                <span>size: {bytesHuman(data.orchestrator.size_bytes)}</span>
                <span>built: {ageHuman(data.orchestrator.created)}</span>
              </CardContent>
            </Card>
          )}

          {data && (
            <p className="text-xs text-muted-foreground px-1">
              Last checked {new Date(data.checked_at).toLocaleString()} · auto-refreshes every 60s.
              {" "}Builds run on the host via the Docker socket and stream their logs below.
            </p>
          )}
        </>
      )}

      <BuildLogViewer
        buildLogs={buildLogs}
        buildPhase={buildPhase}
        deploying={!!busy && busy !== "orchestrator-restart"}
        deployingMgr={false}
        onClear={() => { setBuildLogs([]); setBuildPhase(null); }}
      />
    </PageShell>
  );
}
