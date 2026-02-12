"use client";

import { useState, useEffect } from "react";
import { Database, CheckCircle2, AlertTriangle, RefreshCw, Loader2, HardDrive } from "lucide-react";
import { Button } from "@matrx/admin-ui/ui/button";
import { Card, CardContent } from "@matrx/admin-ui/ui/card";
import { Badge } from "@matrx/admin-ui/ui/badge";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@matrx/admin-ui/ui/table";
import { PageShell } from "@matrx/admin-ui/components/page-shell";

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
      <Card>
        <CardContent className="p-0">
          {health.length === 0 && !loading ? (
            <div className="p-6 text-center text-muted-foreground text-sm">No instances found</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Instance</TableHead>
                  <TableHead>App</TableHead>
                  <TableHead>Database</TableHead>
                  <TableHead>Connection</TableHead>
                  <TableHead className="hidden md:table-cell">Container</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {health.map((item) => (
                  <TableRow key={item.instance}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {item.db_connected ? (
                          <CheckCircle2 className="size-4 text-green-500 shrink-0" />
                        ) : (
                          <AlertTriangle className="size-4 text-red-500 shrink-0" />
                        )}
                        <div>
                          <div className="font-medium">{item.display_name || item.instance}</div>
                          <div className="text-xs text-muted-foreground font-mono">{item.instance}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={item.app_status === "running" ? "success" : "destructive"}>{item.app_status}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={item.db_status === "running" ? "success" : "destructive"}>{item.db_status}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={item.db_connected ? "success" : "destructive"}>
                        {item.db_connected ? "Connected" : "Disconnected"}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground hidden md:table-cell">{item.db_container}</TableCell>
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
