"use client";

import { useState, useEffect } from "react";
import {
  Loader2,
  AlertCircle,
  Server,
  Database,
  Globe,
  GitBranch,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { PageShell } from "@/components/admin/page-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface HealthData {
  status: string;
  database: string;
  version: string;
}

function StatusDot({ ok }: { ok: boolean }) {
  return ok ? (
    <CheckCircle className="w-4 h-4 text-success" />
  ) : (
    <XCircle className="w-4 h-4 text-destructive" />
  );
}

export default function SettingsPage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchHealth() {
      try {
        const res = await fetch("/api/health");
        if (res.ok) {
          setHealth(await res.json());
        }
      } catch {
        // Silently fail
      } finally {
        setLoading(false);
      }
    }
    fetchHealth();
  }, []);

  const envVars = [
    { key: "DATABASE_URL", value: process.env.NEXT_PUBLIC_DATABASE_URL ? "•••configured•••" : "Default (localhost)", sensitive: true },
    { key: "NEXT_PUBLIC_PROJECT_NAME", value: process.env.NEXT_PUBLIC_PROJECT_NAME || "Not set" },
    { key: "NODE_ENV", value: process.env.NODE_ENV || "development" },
  ];

  return (
    <PageShell
      title="Settings"
      description="Project configuration and connected services"
    >
      {/* Project Info */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-6">
        <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <Server className="w-4 h-4 text-muted-foreground" />
          Project Information
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Project Name</p>
            <p className="text-sm font-medium text-foreground">
              {process.env.NEXT_PUBLIC_PROJECT_NAME || "Matrx Ship"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Environment</p>
            <Badge variant="secondary">{process.env.NODE_ENV || "development"}</Badge>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Version</p>
            <p className="text-sm font-medium text-foreground font-mono">
              {health?.version || "Loading..."}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Database</p>
            <div className="flex items-center gap-2">
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              ) : (
                <StatusDot ok={health?.database === "connected"} />
              )}
              <span className="text-sm text-foreground">
                {health?.database || "Checking..."}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Connected Services */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-6">
        <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <Globe className="w-4 h-4 text-muted-foreground" />
          Connected Services
        </h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3">
              <Database className="w-4.5 h-4.5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">PostgreSQL</p>
                <p className="text-xs text-muted-foreground">Database</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              ) : (
                <>
                  <StatusDot ok={health?.database === "connected"} />
                  <Badge variant={health?.database === "connected" ? "default" : "destructive"}>
                    {health?.database === "connected" ? "Connected" : "Disconnected"}
                  </Badge>
                </>
              )}
            </div>
          </div>

          <Separator />

          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3">
              <GitBranch className="w-4.5 h-4.5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">Vercel</p>
                <p className="text-xs text-muted-foreground">Deployment platform</p>
              </div>
            </div>
            <Badge variant={process.env.VERCEL ? "default" : "secondary"}>
              {process.env.VERCEL ? "Connected" : "Not configured"}
            </Badge>
          </div>
        </div>
      </div>

      {/* Environment */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-6">
        <h3 className="text-sm font-semibold text-foreground mb-4">
          Environment Variables
        </h3>
        <div className="space-y-2">
          {envVars.map((v) => (
            <div
              key={v.key}
              className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/30"
            >
              <code className="text-xs font-mono text-foreground">{v.key}</code>
              <span className="text-xs text-muted-foreground">{v.value}</span>
            </div>
          ))}
        </div>
      </div>
    </PageShell>
  );
}
