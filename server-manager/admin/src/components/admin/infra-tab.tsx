"use client";

import { useState, useEffect } from "react";
import {
  Server,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Loader2,
  Globe,
  Database,
  Monitor,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageShell } from "@/components/admin/page-shell";
import type { SystemInfo } from "@/lib/types";

interface Props {
  api: (path: string, opts?: RequestInit) => Promise<unknown>;
  system: SystemInfo | null | undefined;
}

function StatusBadge({ status }: { status: string }) {
  const isRunning = status === "running";
  return (
    <Badge variant={isRunning ? "default" : "destructive"} className="gap-1">
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
    if (system) {
      setContainers(system.containers || []);
    }
  }, [system]);

  const sys = system;

  // Parse containers into structured data
  const infraContainers = containers
    .map((c) => {
      const parts = c.split("\t").length > 1 ? c.split("\t") : c.split(/\s{2,}/);
      return { name: parts[0]?.trim(), status: parts[1]?.trim(), image: parts[2]?.trim() };
    })
    .filter((c) => c.name);

  // Categorize
  const coreInfra = infraContainers.filter(
    (c) => ["traefik", "postgres", "pgadmin"].includes(c.name),
  );
  const controlPlane = infraContainers.filter(
    (c) => ["matrx-manager", "matrx-deploy"].includes(c.name) || c.name?.includes("mcp"),
  );
  const agents = infraContainers.filter((c) => c.name?.startsWith("agent-"));
  const appInstances = infraContainers.filter(
    (c) =>
      !coreInfra.find((i) => i.name === c.name) &&
      !controlPlane.find((i) => i.name === c.name) &&
      !agents.find((i) => i.name === c.name) &&
      !c.name?.startsWith("db-"),
  );

  return (
    <PageShell
      title="Infrastructure Health"
      description="All containers, services, and system resources"
      icon={Server}
      actions={
        <Button variant="outline" size="sm" onClick={loadContainers} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          <span className="ml-2">Refresh</span>
        </Button>
      }
    >
      {/* System resources */}
      {sys && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">CPU</p>
              <p className="text-lg font-bold">{sys.cpus} cores</p>
              <p className="text-xs text-muted-foreground truncate">{sys.cpu_model}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Memory</p>
              <p className="text-lg font-bold">{sys.memory?.percent}</p>
              <p className="text-xs text-muted-foreground">{sys.memory?.used} / {sys.memory?.total}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Disk</p>
              <p className="text-lg font-bold">{sys.disk?.percent}</p>
              <p className="text-xs text-muted-foreground">{sys.disk?.used} / {sys.disk?.total}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Docker</p>
              <p className="text-sm font-bold">{sys.docker}</p>
              <p className="text-xs text-muted-foreground">Uptime: {sys.uptime_hours}h</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Container groups */}
      <div className="space-y-6">
        {[
          { title: "Core Infrastructure", icon: Globe, items: coreInfra },
          { title: "Control Plane", icon: Monitor, items: controlPlane },
          { title: "Agent Environments", icon: Server, items: agents },
          { title: "App Instances", icon: Database, items: appInstances },
        ].map(
          (group) =>
            group.items.length > 0 && (
              <Card key={group.title}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <group.icon className="size-4" /> {group.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {group.items.map((c) => (
                      <div
                        key={c.name}
                        className="flex items-center justify-between py-2 border-b last:border-0"
                      >
                        <div>
                          <p className="font-mono text-sm">{c.name}</p>
                          <p className="text-xs text-muted-foreground">{c.image}</p>
                        </div>
                        <StatusBadge status={c.status?.split(" ")[0] || "unknown"} />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ),
        )}
      </div>
    </PageShell>
  );
}
