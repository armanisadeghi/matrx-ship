"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Loader2, RefreshCw, CheckCircle2, AlertTriangle, XCircle,
  Database, Globe, Cpu, ExternalLink, BookOpen, Play, TableProperties,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@matrx/admin-ui/ui/card";
import { Button } from "@matrx/admin-ui/ui/button";
import { Badge } from "@matrx/admin-ui/ui/badge";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@matrx/admin-ui/ui/table";
import { PageShell } from "@matrx/admin-ui/components/page-shell";
import { useAuth } from "@/lib/auth-context";

interface InfraStatus {
  traefik: { name: string; status: string; health: string | null; routes_raw: string };
  postgres: { name: string; status: string; health: string | null; size: string; connections: string };
  pgadmin: { name: string; status: string; health: string | null };
  agents: { name: string; status: string; health: string | null }[];
  docker: { summary: string; disk_usage: string };
}

function StatusBadge({ status }: { status: string }) {
  if (status === "running") {
    return (
      <Badge variant="success" className="gap-1">
        <CheckCircle2 className="size-3" /> running
      </Badge>
    );
  }
  if (status === "not found" || status === "unknown") {
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="size-3" /> not found
      </Badge>
    );
  }
  return (
    <Badge variant="warning" className="gap-1">
      <AlertTriangle className="size-3" /> {status}
    </Badge>
  );
}

export default function InfrastructurePage() {
  const { api } = useAuth();
  const [infra, setInfra] = useState<InfraStatus | null>(null);
  const [system, setSystem] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [i, s] = await Promise.all([
        api("/api/infrastructure/status"),
        api("/api/system"),
      ]);
      setInfra(i as unknown as InfraStatus);
      setSystem(s as Record<string, unknown>);
    } catch { /* auth handles */ }
    finally { setLoading(false); }
  }, [api]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="size-8 animate-spin text-muted-foreground" /></div>;

  const sys = system as { hostname?: string; cpus?: number; memory?: { total: string; used: string; percent: string }; disk?: { total: string; used: string; percent: string }; uptime_hours?: string; docker?: string } | null;

  // Build services list for the table
  const services = [
    {
      name: "Traefik",
      type: "Reverse Proxy",
      status: infra?.traefik?.status || "unknown",
      details: "Routes all HTTPS traffic, manages Let's Encrypt certificates",
      url: "https://traefik.dev.codematrx.com",
      icon: <Globe className="size-4 text-green-500" />,
    },
    {
      name: "PostgreSQL",
      type: "Database",
      status: infra?.postgres?.status || "unknown",
      details: infra?.postgres ? `Size: ${infra.postgres.size} | Connections: ${infra.postgres.connections}` : "Central PostgreSQL database",
      icon: <Database className="size-4 text-blue-600" />,
    },
    {
      name: "pgAdmin",
      type: "Database UI",
      status: infra?.pgadmin?.status || "unknown",
      details: "Web-based PostgreSQL administration",
      url: "https://pg.dev.codematrx.com",
      icon: <Database className="size-4 text-blue-400" />,
    },
    {
      name: "Directus",
      type: "CMS / Admin",
      status: "running",
      details: "Headless CMS — REST & GraphQL API for scraper database",
      url: "https://directus.app.matrxserver.com",
      icon: <Database className="size-4 text-purple-500" />,
    },
    {
      name: "NocoDB",
      type: "Database UI",
      status: "running",
      details: "Spreadsheet-style database browser and editor",
      url: "https://nocodb.app.matrxserver.com",
      icon: <TableProperties className="size-4 text-indigo-500" />,
    },
    ...(infra?.agents || []).map((agent) => ({
      name: agent.name,
      type: "Agent",
      status: agent.status || "not found",
      details: "Sysbox agent container for isolated development",
      icon: <Cpu className="size-4 text-amber-500" />,
    })),
  ];

  return (
    <PageShell
      title="Infrastructure"
      description="Core services and system health"
      actions={
        <Button variant="outline" size="sm" onClick={loadData}>
          <RefreshCw className="size-4" /> Refresh
        </Button>
      }
    >
      {/* System overview cards */}
      {sys && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Cpu className="size-5 text-blue-500" />
                <div>
                  <p className="text-sm text-muted-foreground">CPU</p>
                  <p className="text-lg font-semibold">{sys.cpus} cores</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div>
                <p className="text-sm text-muted-foreground">Memory</p>
                <p className="text-lg font-semibold">{sys.memory?.used} / {sys.memory?.total}</p>
                <p className="text-xs text-muted-foreground">{sys.memory?.percent} used</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div>
                <p className="text-sm text-muted-foreground">Disk</p>
                <p className="text-lg font-semibold">{sys.disk?.used} / {sys.disk?.total}</p>
                <p className="text-xs text-muted-foreground">{sys.disk?.percent} used</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div>
                <p className="text-sm text-muted-foreground">Uptime</p>
                <p className="text-lg font-semibold">{sys.uptime_hours}h</p>
                <p className="text-xs text-muted-foreground">{sys.docker}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Services status table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Service Status</CardTitle>
          <CardDescription>Core infrastructure services and their current health</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Details</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {services.map((svc) => (
                <TableRow key={svc.name}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {svc.icon}
                      <span className="font-medium">{svc.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{svc.type}</TableCell>
                  <TableCell>
                    <StatusBadge status={svc.status} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                    {svc.details}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {svc.status === "not found" || svc.status === "unknown" ? (
                        <Button variant="outline" size="sm" disabled>
                          <BookOpen className="size-3.5" /> Setup Guide
                        </Button>
                      ) : (
                        <>
                          {"url" in svc && svc.url && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => window.open(svc.url, "_blank")}
                            >
                              <ExternalLink className="size-3.5" /> Open
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Docker system info */}
      {infra?.docker && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Docker System</CardTitle>
            <CardDescription>Container and image statistics</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="text-xs font-mono bg-muted/30 rounded-lg p-4 whitespace-pre-wrap overflow-x-auto">
              {infra.docker.summary}
              {"\n\n"}
              {infra.docker.disk_usage}
            </pre>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
