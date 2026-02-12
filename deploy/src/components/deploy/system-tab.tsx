"use client";

import { Container, Wrench, Loader2, ShieldCheck, Cpu, HardDrive, Clock, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { PageShell } from "@/components/deploy/page-shell";
import type { SystemInfo } from "@/lib/types";

interface SystemTabProps {
  system: SystemInfo;
  deployingMgr: boolean;
  onRebuildManager: () => void;
}

export function SystemTab({ system, deployingMgr, onRebuildManager }: SystemTabProps) {
  return (
    <PageShell
      title="System"
      description="Server health, resource utilization, and infrastructure management"
    >
      {/* System metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Server className="size-4" /> Hostname
            </div>
            <div className="font-mono font-semibold mt-1 text-sm truncate">{system.hostname}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Cpu className="size-4" /> Memory
            </div>
            <div className="font-semibold mt-1">{system.memory.percent}</div>
            <div className="text-xs text-muted-foreground">{system.memory.used} / {system.memory.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <HardDrive className="size-4" /> Disk
            </div>
            <div className="font-semibold mt-1">{system.disk.percent}</div>
            <div className="text-xs text-muted-foreground">{system.disk.used} / {system.disk.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="size-4" /> Uptime
            </div>
            <div className="font-semibold mt-1">{system.uptime_hours}h</div>
            <div className="text-xs text-muted-foreground">{system.cpus} CPUs</div>
          </CardContent>
        </Card>
      </div>

      {/* Docker containers */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Container className="size-4" /> Docker Containers
          </CardTitle>
          <CardDescription>{system.docker}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <div className="space-y-1 font-mono text-sm min-w-0">
              {(system.containers ?? []).map((c, i) => (
                <div key={i} className="py-0.5 text-muted-foreground truncate">{c}</div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Server Manager rebuild */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="size-4" /> Server Manager
          </CardTitle>
          <CardDescription>
            Rebuild the MCP Server Manager container from source. This will briefly
            interrupt the manager service while the new container starts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={onRebuildManager} disabled={deployingMgr}>
            {deployingMgr ? <Loader2 className="size-4 animate-spin" /> : <Wrench className="size-4" />}
            Rebuild Server Manager
          </Button>
        </CardContent>
      </Card>
    </PageShell>
  );
}
