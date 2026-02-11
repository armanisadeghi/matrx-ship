"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Package,
  GitCommit,
  Clock,
  Calendar,
  TrendingUp,
  Loader2,
  AlertCircle,
  Activity,
  ArrowRight,
  MessageSquare,
  FileText,
  Plus,
  Minus,
  BarChart3,
} from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import { PageShell } from "@/components/admin/page-shell";

interface VersionData {
  version: string;
  buildNumber: number;
  gitCommit: string | null;
  commitMessage: string | null;
  linesAdded: number | null;
  linesDeleted: number | null;
  filesChanged: number | null;
  deployedAt: string;
  deploymentStatus: string | null;
  vercelDeploymentUrl: string | null;
  deploymentError: string | null;
}

interface PeriodStats {
  deployments: number;
  linesAdded: number;
  linesDeleted: number;
  filesChanged: number;
}

interface StatsData {
  today: PeriodStats;
  week: PeriodStats;
  month: PeriodStats;
  averageTimeBetweenDeployments: string;
  totalDeployments: number;
}

export default function AdminDashboard() {
  const [version, setVersion] = useState<VersionData | null>(null);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const [versionRes, statsRes] = await Promise.all([
          fetch("/api/version"),
          fetch("/api/version/stats"),
        ]);

        if (!versionRes.ok || !statsRes.ok) {
          throw new Error("Failed to fetch dashboard data");
        }

        setVersion(await versionRes.json());
        setStats(await statsRes.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading dashboard...</p>
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
          <p className="text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <PageShell title="Dashboard" description="Deployment overview and current status">
      {/* Current Version Hero */}
      <div className="bg-gradient-to-br from-ship-600 via-ship-700 to-ship-900 rounded-2xl shadow-lg p-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-[oklch(1_0_0/0.2)] rounded-xl flex items-center justify-center">
              <Package className="w-6 h-6 text-[oklch(1_0_0)]" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[oklch(1_0_0/0.9)]">
                Current Version
              </h2>
              <p className="text-sm text-[oklch(1_0_0/0.6)]">
                Currently deployed to production
              </p>
            </div>
          </div>
          {version && (
            <div className="text-right">
              <p className="text-sm text-[oklch(1_0_0/0.6)]">Build Number</p>
              <p className="text-2xl font-bold text-[oklch(1_0_0)]">
                {version.buildNumber}
              </p>
            </div>
          )}
        </div>

        <div className="text-center py-6">
          <div className="inline-flex items-baseline gap-3">
            <span className="text-[oklch(1_0_0/0.6)] text-2xl font-medium">v</span>
            <span className="text-7xl font-bold text-[oklch(1_0_0)] tracking-tight">
              {version?.version || "0.0.0"}
            </span>
          </div>
        </div>

        {version && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6 pt-6 border-t border-[oklch(1_0_0/0.2)]">
              <div className="flex items-center gap-3">
                <Calendar className="w-5 h-5 text-[oklch(1_0_0/0.6)]" />
                <div>
                  <p className="text-xs text-[oklch(1_0_0/0.6)]">Deployed</p>
                  <p className="text-sm font-medium text-[oklch(1_0_0)]">
                    {formatRelativeTime(version.deployedAt)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Clock className="w-5 h-5 text-[oklch(1_0_0/0.6)]" />
                <div>
                  <p className="text-xs text-[oklch(1_0_0/0.6)]">Deploy Time</p>
                  <p className="text-sm font-medium text-[oklch(1_0_0)]">
                    {new Date(version.deployedAt).toLocaleString("en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <GitCommit className="w-5 h-5 text-[oklch(1_0_0/0.6)]" />
                <div>
                  <p className="text-xs text-[oklch(1_0_0/0.6)]">Git Commit</p>
                  <p className="text-sm font-medium text-[oklch(1_0_0)] font-mono">
                    {version.gitCommit?.substring(0, 7) || "N/A"}
                  </p>
                </div>
              </div>
            </div>

            {version.commitMessage && (
              <div className="mt-4 pt-4 border-t border-[oklch(1_0_0/0.2)]">
                <div className="flex items-start gap-3">
                  <MessageSquare className="w-5 h-5 text-[oklch(1_0_0/0.6)] shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs text-[oklch(1_0_0/0.6)] mb-1">
                      Commit Message
                    </p>
                    <p className="text-sm font-medium text-[oklch(1_0_0)]">
                      {version.commitMessage}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {version.filesChanged !== null &&
              version.linesAdded !== null &&
              version.linesDeleted !== null && (
                <div className="mt-3 flex items-center gap-4 text-[oklch(1_0_0/0.9)]">
                  <div className="flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-[oklch(1_0_0/0.6)]" />
                    <span className="text-sm font-medium">
                      {version.filesChanged} files
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <Plus className="w-4 h-4 text-[oklch(0.85_0.15_150)]" />
                      <span className="text-sm font-medium">
                        {version.linesAdded}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Minus className="w-4 h-4 text-[oklch(0.85_0.15_25)]" />
                      <span className="text-sm font-medium">
                        {version.linesDeleted}
                      </span>
                    </div>
                  </div>
                </div>
              )}
          </>
        )}
      </div>

      {/* Quick Stats */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-card rounded-2xl border border-border shadow-sm p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Today</p>
                <p className="text-2xl font-bold text-foreground mt-1">
                  {stats.today.deployments}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  +{stats.today.linesAdded.toLocaleString()} / -
                  {stats.today.linesDeleted.toLocaleString()} lines
                </p>
              </div>
              <div className="w-10 h-10 bg-warning/10 rounded-xl flex items-center justify-center">
                <Clock className="w-5 h-5 text-warning" />
              </div>
            </div>
          </div>

          <div className="bg-card rounded-2xl border border-border shadow-sm p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">This Week</p>
                <p className="text-2xl font-bold text-foreground mt-1">
                  {stats.week.deployments}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  +{stats.week.linesAdded.toLocaleString()} / -
                  {stats.week.linesDeleted.toLocaleString()} lines
                </p>
              </div>
              <div className="w-10 h-10 bg-info/10 rounded-xl flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-info" />
              </div>
            </div>
          </div>

          <div className="bg-card rounded-2xl border border-border shadow-sm p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Avg Frequency</p>
                <p className="text-2xl font-bold text-foreground mt-1">
                  {stats.averageTimeBetweenDeployments}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">between deploys</p>
              </div>
              <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
                <Activity className="w-5 h-5 text-primary" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link
          href="/admin/versions"
          className="bg-card rounded-2xl border border-border shadow-sm p-6 hover:border-primary/40 hover:shadow-md transition-all group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
                <GitCommit className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">
                  Version History
                </h3>
                <p className="text-sm text-muted-foreground">
                  {stats?.totalDeployments ?? 0} total deployments
                </p>
              </div>
            </div>
            <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
          </div>
        </Link>

        <Link
          href="/admin/stats"
          className="bg-card rounded-2xl border border-border shadow-sm p-6 hover:border-success/40 hover:shadow-md transition-all group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-success/10 rounded-xl flex items-center justify-center">
                <BarChart3 className="w-5 h-5 text-success" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">
                  Detailed Statistics
                </h3>
                <p className="text-sm text-muted-foreground">
                  Code metrics and trends
                </p>
              </div>
            </div>
            <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-success transition-colors" />
          </div>
        </Link>
      </div>
    </PageShell>
  );
}
