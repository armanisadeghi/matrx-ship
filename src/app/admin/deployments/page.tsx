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
    color: string;
    bg: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  pending: {
    label: "Pending",
    color: "text-slate-700",
    bg: "bg-slate-100",
    icon: Clock,
  },
  building: {
    label: "Building",
    color: "text-blue-700",
    bg: "bg-blue-100",
    icon: Loader2,
  },
  ready: {
    label: "Deployed",
    color: "text-green-700",
    bg: "bg-green-100",
    icon: CheckCircle,
  },
  error: {
    label: "Failed",
    color: "text-red-700",
    bg: "bg-red-100",
    icon: XCircle,
  },
  canceled: {
    label: "Canceled",
    color: "text-yellow-700",
    bg: "bg-yellow-100",
    icon: Ban,
  },
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
          <Loader2 className="w-12 h-12 text-ship-600 animate-spin mx-auto mb-4" />
          <p className="text-slate-600">Loading deployments...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-slate-900 mb-2">
            Failed to load
          </h2>
          <p className="text-slate-600 mb-4">{error}</p>
          <button
            onClick={() => fetchDeployments()}
            className="px-4 py-2 bg-ship-600 text-white rounded-lg hover:bg-ship-700 transition-colors"
          >
            Try Again
          </button>
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Deployments</h1>
          <p className="text-slate-500 mt-1">
            Track deployment status and Vercel integration
          </p>
        </div>
        <button
          onClick={() => fetchDeployments(true)}
          disabled={refreshing}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
        >
          <RefreshCw
            className={cn("w-4 h-4", refreshing && "animate-spin")}
          />
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {/* Status Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Object.entries(statusConfig).map(([key, config]) => {
          const StatusIcon = config.icon;
          return (
            <div
              key={key}
              className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-4 text-center"
            >
              <StatusIcon
                className={cn(
                  "w-6 h-6 mx-auto mb-1",
                  config.color,
                  key === "building" && "animate-spin",
                )}
              />
              <p className="text-2xl font-bold text-slate-900">
                {statusCounts[key] || 0}
              </p>
              <p className="text-xs text-slate-500">{config.label}</p>
            </div>
          );
        })}
      </div>

      {/* Deployment Timeline */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-sm font-medium text-slate-700">
            Recent Deployments
          </h2>
        </div>
        <div className="divide-y divide-slate-100">
          {versions.map((v) => {
            const config =
              statusConfig[v.deploymentStatus || "pending"] ||
              statusConfig.pending;
            const StatusIcon = config.icon;

            return (
              <div key={v.id} className="px-6 py-4">
                <div className="flex items-start gap-4">
                  <div
                    className={cn(
                      "w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
                      config.bg,
                    )}
                  >
                    <StatusIcon
                      className={cn(
                        "w-4.5 h-4.5",
                        config.color,
                        v.deploymentStatus === "building" && "animate-spin",
                      )}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-slate-900 font-mono">
                        v{v.version}
                      </span>
                      <span className="text-xs text-slate-400">
                        #{v.buildNumber}
                      </span>
                      <span
                        className={cn(
                          "px-2 py-0.5 rounded-full text-xs font-medium",
                          config.bg,
                          config.color,
                        )}
                      >
                        {config.label}
                      </span>
                    </div>
                    {v.commitMessage && (
                      <p className="text-sm text-slate-600 mt-1 truncate">
                        {v.commitMessage}
                      </p>
                    )}
                    {v.deploymentError && (
                      <p className="text-sm text-red-600 mt-1">
                        Error: {v.deploymentError}
                      </p>
                    )}
                    <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
                      <span>{formatRelativeTime(v.deployedAt)}</span>
                      {v.gitCommit && (
                        <code className="bg-slate-100 px-1.5 py-0.5 rounded font-mono">
                          {v.gitCommit}
                        </code>
                      )}
                      {v.vercelDeploymentUrl && (
                        <a
                          href={v.vercelDeploymentUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-ship-600 hover:text-ship-700"
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
    </div>
  );
}
