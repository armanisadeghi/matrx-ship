"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, RefreshCw, CheckCircle2, AlertTriangle, Database, Globe, Cpu } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth-context";

interface InfraStatus {
  traefik: { name: string; status: string; health: string | null; routes_raw: string };
  postgres: { name: string; status: string; health: string | null; size: string; connections: string };
  pgadmin: { name: string; status: string; health: string | null };
  agents: { name: string; status: string; health: string | null }[];
  docker: { summary: string; disk_usage: string };
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Infrastructure</h1>
          <p className="text-muted-foreground">Core services and system health</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadData}>
          <RefreshCw className="size-4 mr-2" /> Refresh
        </Button>
      </div>

      {/* System overview */}
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

      {/* Service statuses */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="size-4" /> Traefik Reverse Proxy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between mb-3">
              <span className="font-mono text-sm">traefik</span>
              <StatusBadge status={infra?.traefik?.status || "unknown"} />
            </div>
            <p className="text-xs text-muted-foreground">Routes all HTTPS traffic, manages Let&apos;s Encrypt certificates</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Database className="size-4" /> PostgreSQL
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between mb-3">
              <span className="font-mono text-sm">postgres</span>
              <StatusBadge status={infra?.postgres?.status || "unknown"} />
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <p className="text-muted-foreground">Size</p>
                <p className="font-mono">{infra?.postgres?.size}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Connections</p>
                <p className="font-mono">{infra?.postgres?.connections}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">pgAdmin</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm">pgadmin</span>
              <StatusBadge status={infra?.pgadmin?.status || "unknown"} />
            </div>
          </CardContent>
        </Card>

        {infra?.agents?.map((agent) => (
          <Card key={agent.name}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Agent: {agent.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm">{agent.name}</span>
                <StatusBadge status={agent.status || "not found"} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Docker system info */}
      {infra?.docker && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Docker System</CardTitle>
            <CardDescription>Container and image statistics</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="text-xs font-mono bg-muted/30 rounded p-3 whitespace-pre-wrap">
              {infra.docker.summary}
              {"\n\n"}
              {infra.docker.disk_usage}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
