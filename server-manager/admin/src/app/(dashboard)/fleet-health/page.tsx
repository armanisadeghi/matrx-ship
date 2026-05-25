"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, CheckCircle2, AlertTriangle, XCircle, HelpCircle } from "lucide-react";
import { Button } from "@matrx/admin-ui/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@matrx/admin-ui/ui/card";
import { Badge } from "@matrx/admin-ui/ui/badge";
import { PageShell } from "@matrx/admin-ui/components/page-shell";
import { useAuth } from "@/lib/auth-context";
import { api, API, ApiError } from "@/lib/api";

interface Check {
  id: string;
  label: string;
  status: "ok" | "warning" | "critical" | "unknown";
  detail: string;
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
  if (status === "warning") return <AlertTriangle className="size-5 text-amber-500" />;
  if (status === "critical") return <XCircle className="size-5 text-destructive" />;
  return <HelpCircle className="size-5 text-muted-foreground" />;
}

export default function FleetHealthPage() {
  const { authed } = useAuth();
  const [data, setData] = useState<FleetHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  const overall = data?.overall;
  const overallVariant = overall === "ok" ? "success" : overall === "degraded" ? "secondary" : "destructive";

  return (
    <PageShell
      title="Fleet Health"
      description="Read-only checks for the things that used to fail silently: code/config drift between hosts, stale or missing sandbox images, and deploy-run failures."
      actions={
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="size-4" /> Refresh
        </Button>
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
        data?.checks.map((c) => (
          <Card key={c.id} className={c.status === "critical" ? "border-destructive/40" : c.status === "warning" ? "border-amber-500/40" : ""}>
            <CardContent className="pt-5">
              <div className="flex items-start gap-3">
                <StatusIcon status={c.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{c.label}</span>
                    <Badge variant={c.status === "ok" ? "success" : c.status === "critical" ? "destructive" : "secondary"} className="text-[10px]">{c.status}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{c.detail}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </PageShell>
  );
}
