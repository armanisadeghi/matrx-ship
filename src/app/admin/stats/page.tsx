"use client";

import { useState, useEffect } from "react";
import {
  Clock,
  TrendingUp,
  Calendar,
  Activity,
  GitCommit,
  Loader2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/admin/page-shell";
import { Button } from "@/components/ui/button";

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

function StatCard({
  title,
  subtitle,
  stats,
  icon: Icon,
  iconClassName,
}: {
  title: string;
  subtitle: string;
  stats: PeriodStats;
  icon: React.ComponentType<{ className?: string }>;
  iconClassName: string;
}) {
  return (
    <div className="bg-card rounded-2xl border border-border shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-muted">
            <Icon className={cn("w-5 h-5", iconClassName)} />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">{title}</p>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold text-foreground">
            {stats.deployments}
          </p>
          <p className="text-xs text-muted-foreground">pushes</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 pt-4 border-t border-border">
        <div className="text-center">
          <p className="text-lg font-semibold text-success">
            +{stats.linesAdded.toLocaleString()}
          </p>
          <p className="text-xs text-muted-foreground">added</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-semibold text-destructive">
            -{stats.linesDeleted.toLocaleString()}
          </p>
          <p className="text-xs text-muted-foreground">removed</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-semibold text-foreground/80">
            {stats.filesChanged.toLocaleString()}
          </p>
          <p className="text-xs text-muted-foreground">files</p>
        </div>
      </div>
    </div>
  );
}

export default function StatsPage() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/version/stats");
      if (!res.ok) throw new Error("Failed to fetch stats");
      setStats(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading statistics...</p>
        </div>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-foreground mb-2">
            Failed to load
          </h2>
          <p className="text-muted-foreground mb-4">{error}</p>
          <Button onClick={() => fetchStats()}>Try Again</Button>
        </div>
      </div>
    );
  }

  return (
    <PageShell
      title="Statistics"
      description="Deployment metrics and code activity"
      actions={
        <Button
          variant="outline"
          onClick={() => fetchStats(true)}
          disabled={refreshing}
        >
          <RefreshCw className={cn("w-4 h-4 mr-2", refreshing && "animate-spin")} />
          {refreshing ? "Refreshing..." : "Refresh"}
        </Button>
      }
    >
      {/* Period Detail Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <StatCard
          title="Last 24 Hours"
          subtitle="Today's activity"
          stats={stats.today}
          icon={Clock}
          iconClassName="text-warning"
        />
        <StatCard
          title="This Week"
          subtitle="Last 7 days"
          stats={stats.week}
          icon={TrendingUp}
          iconClassName="text-info"
        />
      </div>

      {/* Summary Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card rounded-2xl border border-border shadow-sm p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">This Month</p>
              <p className="text-2xl font-bold text-foreground mt-1">
                {stats.month.deployments}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                +{stats.month.linesAdded.toLocaleString()} / -
                {stats.month.linesDeleted.toLocaleString()} lines
              </p>
            </div>
            <div className="w-10 h-10 bg-success/10 rounded-xl flex items-center justify-center">
              <Calendar className="w-5 h-5 text-success" />
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

        <div className="bg-card rounded-2xl border border-border shadow-sm p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Total Deployments</p>
              <p className="text-2xl font-bold text-foreground mt-1">
                {stats.totalDeployments}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">all time</p>
            </div>
            <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
              <GitCommit className="w-5 h-5 text-primary" />
            </div>
          </div>
        </div>
      </div>

      {/* Net Code Change */}
      <div className="bg-card rounded-2xl border border-border shadow-sm p-6">
        <h3 className="text-sm font-medium text-foreground mb-4">
          Net Code Change (This Month)
        </h3>
        <div className="flex items-center gap-8">
          <div>
            <p className="text-3xl font-bold text-success">
              +{stats.month.linesAdded.toLocaleString()}
            </p>
            <p className="text-sm text-muted-foreground">lines added</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-destructive">
              -{stats.month.linesDeleted.toLocaleString()}
            </p>
            <p className="text-sm text-muted-foreground">lines deleted</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-foreground">
              {(
                stats.month.linesAdded - stats.month.linesDeleted
              ).toLocaleString()}
            </p>
            <p className="text-sm text-muted-foreground">net change</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-foreground/80">
              {stats.month.filesChanged.toLocaleString()}
            </p>
            <p className="text-sm text-muted-foreground">files touched</p>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
