"use client";

import { useState, useEffect } from "react";
import { Server, CheckCircle2, AlertTriangle, RefreshCw, Loader2, Globe, Database, Monitor, ExternalLink, TableProperties } from "lucide-react";
import { Button } from "@matrx/admin-ui/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@matrx/admin-ui/ui/card";
import { Badge } from "@matrx/admin-ui/ui/badge";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@matrx/admin-ui/ui/table";
import { PageShell } from "@matrx/admin-ui/components/page-shell";
import type { SystemInfo } from "@/lib/types";

interface Props {
  api: (path: string, opts?: RequestInit) => Promise<unknown>;
  system: SystemInfo | null | undefined;
}

function StatusBadge({ status }: { status: string }) {
  const isRunning = status === "running";
  return (
    <Badge variant={isRunning ? "success" : "destructive"} className="gap-1">
      {isRunning ? <CheckCircle2 className="size-3" /> : <AlertTriangle className="size-3" />}
      {status}
    </Badge>
  );
}

export function InfraTab({ api, system }: Props) {
  const [loading, setLoading] = useState(false);
  const [containers, setContainers] = useState<string[]>([]);

  async function loadContainers() {
    setLoading(true);
    try {
      const sys = await api("/api/system") as { containers?: string[] };
      setContainers(sys.containers || []);
    } catch { /* handled */ }
    finally { setLoading(false); }
  }

  useEffect(() => {
    if (system) setContainers(system.containers || []);
  }, [system]);

  const infraContainers = containers
    .map((c) => {
      const parts = c.split("\t").length > 1 ? c.split("\t") : c.split(/\s{2,}/);
      return { name: parts[0]?.trim(), status: parts[1]?.trim(), image: parts[2]?.trim() };
    })
    .filter((c) => c.name);

  const coreInfra = infraContainers.filter((c) => ["traefik", "postgres", "pgadmin"].includes(c.name));
  const controlPlane = infraContainers.filter((c) => ["matrx-manager", "matrx-deploy"].includes(c.name) || c.name?.includes("mcp"));
  const agents = infraContainers.filter((c) => c.name?.startsWith("agent-"));
  const appInstances = infraContainers.filter((c) => !coreInfra.find((i) => i.name === c.name) && !controlPlane.find((i) => i.name === c.name) && !agents.find((i) => i.name === c.name) && !c.name?.startsWith("db-"));

  const groups = [
    { title: "Core Infrastructure", icon: Globe, items: coreInfra },
    { title: "Control Plane", icon: Monitor, items: controlPlane },
    { title: "Agent Environments", icon: Server, items: agents },
    { title: "App Instances", icon: Database, items: appInstances },
  ];

  return (
    <PageShell
      title="Infrastructure Health"
      description="All containers, services, and system resources"
      icon={Server}
      actions={
        <Button variant="outline" size="sm" onClick={loadContainers} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh
        </Button>
      }
    >
      {system && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">CPU</p><p className="text-lg font-bold">{system.cpus} cores</p><p className="text-xs text-muted-foreground truncate">{system.cpu_model}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Memory</p><p className="text-lg font-bold">{system.memory?.percent}</p><p className="text-xs text-muted-foreground">{system.memory?.used} / {system.memory?.total}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Disk</p><p className="text-lg font-bold">{system.disk?.percent}</p><p className="text-xs text-muted-foreground">{system.disk?.used} / {system.disk?.total}</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">Docker</p><p className="text-sm font-bold">{system.docker}</p><p className="text-xs text-muted-foreground">Uptime: {system.uptime_hours}h</p></CardContent></Card>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Database className="size-4" /> Admin Tools</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <a
              href="https://directus.app.matrxserver.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent transition-colors"
            >
              <Database className="size-5 text-purple-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">Directus CMS</p>
                <p className="text-xs text-muted-foreground">Headless CMS — REST & GraphQL API</p>
              </div>
              <ExternalLink className="size-3.5 text-muted-foreground shrink-0" />
            </a>
            <a
              href="https://nocodb.app.matrxserver.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent transition-colors"
            >
              <TableProperties className="size-5 text-indigo-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">NocoDB</p>
                <p className="text-xs text-muted-foreground">Spreadsheet-style database browser</p>
              </div>
              <ExternalLink className="size-3.5 text-muted-foreground shrink-0" />
            </a>
          </div>
        </CardContent>
      </Card>

      {groups.map((group) =>
        group.items.length > 0 && (
          <Card key={group.title}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><group.icon className="size-4" /> {group.title}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Container</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden md:table-cell">Image</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.items.map((c) => (
                    <TableRow key={c.name}>
                      <TableCell className="font-mono text-sm">{c.name}</TableCell>
                      <TableCell><StatusBadge status={c.status?.split(" ")[0] || "unknown"} /></TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground hidden md:table-cell">{c.image}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ),
      )}
    </PageShell>
  );
}
