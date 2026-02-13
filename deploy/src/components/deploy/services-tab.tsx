"use client";

import {
  ExternalLink, ShieldCheck, Rocket, Globe,
  Database, Container, Server, Terminal, Cpu,
} from "lucide-react";
import { Badge } from "@matrx/admin-ui/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@matrx/admin-ui/ui/card";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@matrx/admin-ui/ui/table";
import { Button } from "@matrx/admin-ui/ui/button";
import { PageShell } from "@matrx/admin-ui/components/page-shell";
import type { BuildInfo } from "@/lib/types";

interface ServiceRow {
  name: string;
  url: string;
  description: string;
  icon: React.ReactNode;
  badge?: string;
  status?: "running" | "stopped" | "ssh-only";
}

function ServiceTable({ title, description, icon, services }: {
  title: string;
  description: string;
  icon: React.ReactNode;
  services: ServiceRow[];
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          {icon} {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Service</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Description</TableHead>
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
                    {svc.badge && <Badge variant="secondary" className="text-[10px]">{svc.badge}</Badge>}
                  </div>
                </TableCell>
                <TableCell>
                  {svc.status === "running" && <Badge variant="success">running</Badge>}
                  {svc.status === "stopped" && <Badge variant="destructive">stopped</Badge>}
                  {svc.status === "ssh-only" && <Badge variant="outline">SSH only</Badge>}
                  {!svc.status && <Badge variant="secondary">available</Badge>}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                  {svc.description}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => window.open(svc.url, "_blank")}
                  >
                    <ExternalLink className="size-3.5" /> Open
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

interface ServicesTabProps {
  buildInfo: BuildInfo | null;
}

export function ServicesTab({ buildInfo }: ServicesTabProps) {
  const managementTools: ServiceRow[] = [
    {
      name: "Server Manager",
      url: "https://manager.dev.codematrx.com/admin/",
      description: "Central admin dashboard — instances, sandboxes, builds, tokens, and system health",
      icon: <ShieldCheck className="size-4 text-orange-500" />,
    },
    {
      name: "Deploy App",
      url: "https://deploy.dev.codematrx.com",
      description: "Deploy watcher — safe rebuilds, rollbacks, and image management",
      icon: <Rocket className="size-4 text-blue-500" />,
      badge: "You are here",
    },
    {
      name: "Traefik Dashboard",
      url: "https://traefik.dev.codematrx.com",
      description: "Reverse proxy — routing rules, SSL certificates, and service discovery",
      icon: <Globe className="size-4 text-green-500" />,
    },
  ];

  const databaseTools: ServiceRow[] = [
    {
      name: "pgAdmin",
      url: "https://pg.dev.codematrx.com",
      description: "PostgreSQL web admin for the central database",
      icon: <Database className="size-4 text-blue-600" />,
    },
  ];

  const shipInstances: ServiceRow[] = (buildInfo?.instances || []).map((inst) => ({
    name: inst.display_name,
    url: `https://${inst.name}.dev.codematrx.com`,
    description: "Ship instance admin portal",
    icon: <Server className="size-4 text-violet-500" />,
    status: inst.status === "running" ? "running" as const : "stopped" as const,
  }));

  const sandboxes: ServiceRow[] = [1, 2, 3, 4, 5].map((n) => ({
    name: `Sandbox ${n}`,
    url: `https://sandbox-${n}.dev.codematrx.com`,
    description: "Web-based development sandbox (ttyd terminal)",
    icon: <Terminal className="size-4 text-emerald-500" />,
  }));

  const otherServices: ServiceRow[] = [
    {
      name: "MCP Example Server",
      url: "https://mcp-example.dev.codematrx.com",
      description: "Example MCP server (Streamable HTTP) — POST /mcp with bearer token",
      icon: <Cpu className="size-4 text-amber-500" />,
    },
    {
      name: "Agent 1",
      url: "https://agent-1.dev.codematrx.com",
      description: "Sysbox agent container — SSH access only, no web UI",
      icon: <Terminal className="size-4 text-red-400" />,
      status: "ssh-only" as const,
    },
  ];

  return (
    <PageShell
      title="Services Directory"
      description="All services running on this infrastructure, with quick-access links"
    >
      <ServiceTable
        title="Management Tools"
        description="Admin dashboards and management UIs"
        icon={<ShieldCheck className="size-4" />}
        services={managementTools}
      />

      <ServiceTable
        title="Database"
        description="Database management and access"
        icon={<Database className="size-4" />}
        services={databaseTools}
      />

      {shipInstances.length > 0 && (
        <ServiceTable
          title="Ship Instances"
          description="Deployed project instances running matrx-ship"
          icon={<Container className="size-4" />}
          services={shipInstances}
        />
      )}

      <ServiceTable
        title="Dev Sandboxes"
        description="Isolated development environments"
        icon={<Terminal className="size-4" />}
        services={sandboxes}
      />

      <ServiceTable
        title="Other Services"
        description="Additional infrastructure services"
        icon={<Cpu className="size-4" />}
        services={otherServices}
      />
    </PageShell>
  );
}
