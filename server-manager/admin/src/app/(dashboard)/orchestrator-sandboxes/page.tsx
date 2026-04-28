"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, ExternalLink } from "lucide-react";
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
  ssh_port?: number | null;
  ttl_seconds?: number;
  expires_at?: string | null;
  tier?: string | null;
  template?: string | null;
  proxy_url?: string | null;
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

const POLL_MS = 5000;

export default function OrchestratorSandboxesPage() {
  const router = useRouter();
  const { authed } = useAuth();
  const [sandboxes, setSandboxes] = useState<OrchSandbox[]>([]);
  const [status, setStatus] = useState<OrchStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [list, st] = await Promise.all([
        api<OrchListResponse>(API.ORCH_SANDBOXES),
        api<OrchStatus>(API.ORCH_STATUS).catch(() => null),
      ]);
      setSandboxes(list.sandboxes ?? []);
      setStatus(st);
      setError(null);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
      setError(msg);
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
