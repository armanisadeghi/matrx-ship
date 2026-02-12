"use client";

import {
  ExternalLink, ShieldCheck, Rocket, Globe,
  Database, Container, Server, Terminal, Cpu,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { PageShell } from "@/components/deploy/page-shell";
import type { BuildInfo } from "@/lib/types";

interface ServiceLinkProps {
  name: string;
  url: string;
  description: string;
  icon: React.ReactNode;
  badge?: string;
  status?: "running" | "stopped" | "ssh-only";
}

function ServiceLink({ name, url, description, icon, badge, status }: ServiceLinkProps) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors group"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="shrink-0">{icon}</div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{name}</span>
            {badge && <Badge variant="secondary" className="text-[10px]">{badge}</Badge>}
            {status === "running" && <Badge variant="success" className="text-[10px]">running</Badge>}
            {status === "stopped" && <Badge variant="destructive" className="text-[10px]">stopped</Badge>}
            {status === "ssh-only" && <Badge variant="outline" className="text-[10px]">SSH only</Badge>}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 truncate">{description}</div>
        </div>
      </div>
      <ExternalLink className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2" />
    </a>
  );
}

interface ServicesTabProps {
  buildInfo: BuildInfo | null;
}

export function ServicesTab({ buildInfo }: ServicesTabProps) {
  return (
    <PageShell
      title="Services Directory"
      description="All services running on this infrastructure, with quick-access links"
    >
      {/* Management Tools */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="size-4" /> Management Tools
          </CardTitle>
          <CardDescription>Admin dashboards and management UIs</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <ServiceLink
              name="Server Manager"
              url="https://mcp.dev.codematrx.com/admin/"
              description="Central admin dashboard — instances, sandboxes, builds, tokens, and system health"
              icon={<ShieldCheck className="size-4 text-orange-500" />}
            />
            <ServiceLink
              name="Deploy App"
              url="https://deploy.dev.codematrx.com"
              description="Deploy watcher — safe rebuilds, rollbacks, and image management"
              icon={<Rocket className="size-4 text-blue-500" />}
              badge="You are here"
            />
            <ServiceLink
              name="Traefik Dashboard"
              url="https://traefik.dev.codematrx.com"
              description="Reverse proxy — routing rules, SSL certificates, and service discovery"
              icon={<Globe className="size-4 text-green-500" />}
            />
          </div>
        </CardContent>
      </Card>

      {/* Database Tools */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="size-4" /> Database
          </CardTitle>
          <CardDescription>Database management and access</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <ServiceLink
              name="pgAdmin"
              url="https://pg.dev.codematrx.com"
              description="PostgreSQL web admin for the central database"
              icon={<Database className="size-4 text-blue-600" />}
            />
            <div className="mt-4 p-4 rounded-lg border bg-muted/30">
              <h4 className="text-sm font-medium mb-2">Central Database Credentials</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
                <div className="text-muted-foreground">pgAdmin Email:</div><div>admin@matrxserver.com</div>
                <div className="text-muted-foreground">pgAdmin Password:</div><div>Dsi4t4slbdSH9hzeEu5waQ==</div>
                <div className="text-muted-foreground">Postgres Host:</div><div>postgres (Docker network)</div>
                <div className="text-muted-foreground">Postgres User:</div><div>matrx</div>
                <div className="text-muted-foreground">Postgres DB:</div><div>matrx</div>
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                Per-instance databases use isolated containers. Credentials are in each instance&apos;s <code>.env</code> at <code>/srv/apps/&#123;name&#125;/.env</code>.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Ship Instances */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Container className="size-4" /> Ship Instances
          </CardTitle>
          <CardDescription>Deployed project instances running matrx-ship</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {buildInfo?.instances && buildInfo.instances.length > 0 ? (
              buildInfo.instances.map((inst) => (
                <ServiceLink
                  key={inst.name}
                  name={inst.display_name}
                  url={`https://ship-${inst.name}.dev.codematrx.com`}
                  description="Ship instance admin portal"
                  icon={<Server className="size-4 text-violet-500" />}
                  status={inst.status === "running" ? "running" : "stopped"}
                />
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No instances loaded. Refresh to see ship instances.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Dev Sandboxes */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Terminal className="size-4" /> Dev Sandboxes
          </CardTitle>
          <CardDescription>Isolated development environments</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((n) => (
              <ServiceLink
                key={n}
                name={`Sandbox ${n}`}
                url={`https://sandbox-${n}.dev.codematrx.com`}
                description="Web-based development sandbox (ttyd terminal)"
                icon={<Terminal className="size-4 text-emerald-500" />}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Other Services */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Cpu className="size-4" /> Other Services
          </CardTitle>
          <CardDescription>Additional infrastructure services</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <ServiceLink
              name="MCP Example Server"
              url="https://mcp-example.dev.codematrx.com"
              description="Example MCP server (Streamable HTTP) — POST /mcp with bearer token"
              icon={<Cpu className="size-4 text-amber-500" />}
            />
            <ServiceLink
              name="Agent 1"
              url="https://agent-1.dev.codematrx.com"
              description="Sysbox agent container — SSH access only, no web UI"
              icon={<Terminal className="size-4 text-red-400" />}
              status="ssh-only"
            />
          </div>
        </CardContent>
      </Card>
    </PageShell>
  );
}
