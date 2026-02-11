"use client";

import { useState, useEffect } from "react";
import {
  Rocket,
  Loader2,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  Clock,
  CheckCircle,
  XCircle,
  Ban,
} from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { PageShell } from "@/components/admin/page-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Version {
  id: string;
  version: string;
  buildNumber: number;
  gitCommit: string | null;
  commitMessage: string | null;
  deployedAt: string;
  deploymentStatus: string | null;
  vercelDeploymentId: string | null;
  vercelDeploymentUrl: string | null;
  deploymentError: string | null;
}

const statusConfig: Record<
  string,
  {
    label: string;
    variant: "default" | "secondary" | "destructive" | "outline";
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  pending: { label: "Pending", variant: "secondary", icon: Clock },
  building: { label: "Building", variant: "outline", icon: Loader2 },
  ready: { label: "Deployed", variant: "default", icon: CheckCircle },
  error: { label: "Failed", variant: "destructive", icon: XCircle },
  canceled: { label: "Canceled", variant: "secondary", icon: Ban },
};

export default function DeploymentsPage() {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDeployments = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/version/history?limit=50&offset=0");
      if (!res.ok) throw new Error("Failed to fetch deployments");
      const data = await res.json();
      setVersions(data.versions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchDeployments();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading deployments...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-foreground mb-2">
            Failed to load
          </h2>
          <p className="text-muted-foreground mb-4">{error}</p>
          <Button onClick={() => fetchDeployments()}>Try Again</Button>
        </div>
      </div>
    );
  }

  // Group by status
  const statusCounts = versions.reduce(
    (acc, v) => {
      const s = v.deploymentStatus || "pending";
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <PageShell
      title="Deployments"
      description="Track deployment status and Vercel integration"
      actions={
        <Button
          variant="outline"
          onClick={() => fetchDeployments(true)}
          disabled={refreshing}
        >
          <RefreshCw className={cn("w-4 h-4 mr-2", refreshing && "animate-spin")} />
          {refreshing ? "Refreshing..." : "Refresh"}
        </Button>
      }
    >
      {/* Status Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Object.entries(statusConfig).map(([key, config]) => {
          const StatusIcon = config.icon;
          return (
            <div
              key={key}
              className="bg-card rounded-xl border border-border shadow-sm p-4 text-center"
            >
              <StatusIcon
                className={cn(
                  "w-6 h-6 mx-auto mb-1 text-muted-foreground",
                  key === "building" && "animate-spin",
                  key === "ready" && "text-success",
                  key === "error" && "text-destructive",
                )}
              />
              <p className="text-2xl font-bold text-foreground">
                {statusCounts[key] || 0}
              </p>
              <p className="text-xs text-muted-foreground">{config.label}</p>
            </div>
          );
        })}
      </div>

      {/* Deployment Timeline */}
      <div className="bg-card rounded-2xl border border-border shadow-sm">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-sm font-medium text-foreground">
            Recent Deployments
          </h2>
        </div>
        <div className="divide-y divide-border/50">
          {versions.map((v) => {
            const config =
              statusConfig[v.deploymentStatus || "pending"] ||
              statusConfig.pending;
            const StatusIcon = config.icon;

            return (
              <div key={v.id} className="px-6 py-4">
                <div className="flex items-start gap-4">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5 bg-muted">
                    <StatusIcon
                      className={cn(
                        "w-4.5 h-4.5 text-muted-foreground",
                        v.deploymentStatus === "building" && "animate-spin",
                        v.deploymentStatus === "ready" && "text-success",
                        v.deploymentStatus === "error" && "text-destructive",
                      )}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-foreground font-mono">
                        v{v.version}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        #{v.buildNumber}
                      </span>
                      <Badge variant={config.variant}>{config.label}</Badge>
                    </div>
                    {v.commitMessage && (
                      <p className="text-sm text-muted-foreground mt-1 truncate">
                        {v.commitMessage}
                      </p>
                    )}
                    {v.deploymentError && (
                      <p className="text-sm text-destructive mt-1">
                        Error: {v.deploymentError}
                      </p>
                    )}
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      <span>{formatRelativeTime(v.deployedAt)}</span>
                      {v.gitCommit && (
                        <code className="bg-muted px-1.5 py-0.5 rounded font-mono">
                          {v.gitCommit}
                        </code>
                      )}
                      {v.vercelDeploymentUrl && (
                        <a
                          href={v.vercelDeploymentUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:text-primary/80"
                        >
                          View on Vercel
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </PageShell>
  );
}
