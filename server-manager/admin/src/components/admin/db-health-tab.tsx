"use client";

import { useState, useEffect } from "react";
import { Database, CheckCircle2, AlertTriangle, RefreshCw, Loader2, HardDrive } from "lucide-react";
import { Button } from "@matrx/admin-ui/ui/button";
import { Card, CardContent } from "@matrx/admin-ui/ui/card";
import { Badge } from "@matrx/admin-ui/ui/badge";
import { PageShell } from "@matrx/admin-ui/components/page-shell";
import { DataTable, type Column } from "@/components/admin/data-table";

interface DbHealthResult {
  instance: string;
  display_name: string;
  app_status: string;
  db_container: string;
  db_status: string;
  db_health: string;
  db_connected: boolean;
  postgres_image: string;
}

interface Props {
  api: (path: string, opts?: RequestInit) => Promise<unknown>;
}

export function DbHealthTab({ api }: Props) {
  const [health, setHealth] = useState<DbHealthResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ healthy: 0, unhealthy: 0, total: 0 });

  async function loadHealth() {
    setLoading(true);
    try {
      const result = await api("/api/db-health") as {
        instances: DbHealthResult[];
        healthy: number;
        unhealthy: number;
        total: number;
      };
      setHealth(result.instances || []);
      setStats({ healthy: result.healthy, unhealthy: result.unhealthy, total: result.total });
    } catch { /* handled */ }
    finally { setLoading(false); }
  }

  useEffect(() => { loadHealth(); }, []);

  return (
    <PageShell
      title="Database Health"
      description="Status of all instance databases"
      icon={Database}
      actions={
        <Button variant="outline" size="sm" onClick={loadHealth} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh
        </Button>
      }
    >
      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6 text-center">
            <CheckCircle2 className="size-8 mx-auto text-green-500 mb-2" />
            <p className="text-2xl font-bold">{stats.healthy}</p>
            <p className="text-sm text-muted-foreground">Healthy</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <AlertTriangle className="size-8 mx-auto text-red-500 mb-2" />
            <p className="text-2xl font-bold">{stats.unhealthy}</p>
            <p className="text-sm text-muted-foreground">Unhealthy</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <HardDrive className="size-8 mx-auto text-blue-500 mb-2" />
            <p className="text-2xl font-bold">{stats.total}</p>
            <p className="text-sm text-muted-foreground">Total Instances</p>
          </CardContent>
        </Card>
      </div>

      {/* Instance table */}
      <DataTable
        rows={health}
        getRowKey={(i) => i.instance}
        getSearchText={(i) => `${i.display_name} ${i.instance} ${i.app_status} ${i.db_status} ${i.db_connected ? "connected" : "disconnected"}`}
        initialSort={{ key: "name", dir: "asc" }}
        searchPlaceholder="Filter databases…"
        emptyMessage={loading ? "Loading…" : "No instances found."}
        copyView="Database Health"
        copyDescription="Per-app Postgres status: app container, db container, and live connectivity."
        getRowData={(i) => ({ instance: i.instance, display_name: i.display_name, app_status: i.app_status, db_status: i.db_status, db_connected: i.db_connected, db_container: i.db_container })}
        columns={[
          {
            key: "name", header: "Instance", sortValue: (i) => (i.display_name || i.instance).toLowerCase(),
            render: (i) => (
              <div className="flex items-center gap-2">
                {i.db_connected ? <CheckCircle2 className="size-4 text-green-500 shrink-0" /> : <AlertTriangle className="size-4 text-red-500 shrink-0" />}
                <div><div className="font-medium">{i.display_name || i.instance}</div><div className="text-xs text-muted-foreground font-mono">{i.instance}</div></div>
              </div>
            ),
          },
          { key: "app", header: "App", sortValue: (i) => i.app_status, render: (i) => <Badge variant={i.app_status === "running" ? "success" : "destructive"}>{i.app_status}</Badge> },
          { key: "db", header: "Database", sortValue: (i) => i.db_status, render: (i) => <Badge variant={i.db_status === "running" ? "success" : "destructive"}>{i.db_status}</Badge> },
          { key: "conn", header: "Connection", sortValue: (i) => (i.db_connected ? 1 : 0), render: (i) => <Badge variant={i.db_connected ? "success" : "destructive"}>{i.db_connected ? "Connected" : "Disconnected"}</Badge> },
          { key: "container", header: "Container", hideBelow: "md", sortValue: (i) => i.db_container, render: (i) => <span className="font-mono text-xs text-muted-foreground">{i.db_container}</span> },
        ] as Column<DbHealthResult>[]}
      />
    </PageShell>
  );
}
