"use client";

import { useState, useEffect } from "react";
import {
  Database,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Loader2,
  HardDrive,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageShell } from "@/components/admin/page-shell";

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
    } catch {
      /* handled by auth */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadHealth(); }, []);

  return (
    <PageShell
      title="Database Health"
      description="Status of all instance databases"
      icon={Database}
      actions={
        <Button variant="outline" size="sm" onClick={loadHealth} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          <span className="ml-2">Refresh</span>
        </Button>
      }
    >
      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-3 mb-6">
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

      {/* Instance list */}
      <div className="space-y-3">
        {health.map((item) => (
          <Card key={item.instance}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {item.db_connected ? (
                    <CheckCircle2 className="size-5 text-green-500" />
                  ) : (
                    <AlertTriangle className="size-5 text-red-500" />
                  )}
                  <div>
                    <p className="font-semibold">{item.display_name || item.instance}</p>
                    <p className="text-xs text-muted-foreground font-mono">{item.db_container}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={item.app_status === "running" ? "default" : "destructive"}>
                    App: {item.app_status}
                  </Badge>
                  <Badge variant={item.db_status === "running" ? "default" : "destructive"}>
                    DB: {item.db_status}
                  </Badge>
                  <Badge variant={item.db_connected ? "default" : "outline"}>
                    {item.db_connected ? "Connected" : "Disconnected"}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {health.length === 0 && !loading && (
          <Card>
            <CardContent className="pt-6 text-center text-muted-foreground">
              No instances found
            </CardContent>
          </Card>
        )}
      </div>
    </PageShell>
  );
}
