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
  iconBg,
  iconColor,
}: {
  title: string;
  subtitle: string;
  stats: PeriodStats;
  icon: React.ComponentType<{ className?: string }>;
  iconBg: string;
  iconColor: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center",
              iconBg,
            )}
          >
            <Icon className={cn("w-5 h-5", iconColor)} />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-900">{title}</p>
            <p className="text-xs text-slate-500">{subtitle}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold text-slate-900">
            {stats.deployments}
          </p>
          <p className="text-xs text-slate-500">pushes</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 pt-4 border-t border-slate-100">
        <div className="text-center">
          <p className="text-lg font-semibold text-emerald-600">
            +{stats.linesAdded.toLocaleString()}
          </p>
          <p className="text-xs text-slate-500">added</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-semibold text-red-600">
            -{stats.linesDeleted.toLocaleString()}
          </p>
          <p className="text-xs text-slate-500">removed</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-semibold text-slate-700">
            {stats.filesChanged.toLocaleString()}
          </p>
          <p className="text-xs text-slate-500">files</p>
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
          <Loader2 className="w-12 h-12 text-ship-600 animate-spin mx-auto mb-4" />
          <p className="text-slate-600">Loading statistics...</p>
        </div>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-slate-900 mb-2">
            Failed to load
          </h2>
          <p className="text-slate-600 mb-4">{error}</p>
          <button
            onClick={() => fetchStats()}
            className="px-4 py-2 bg-ship-600 text-white rounded-lg hover:bg-ship-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Statistics</h1>
          <p className="text-slate-500 mt-1">
            Deployment metrics and code activity
          </p>
        </div>
        <button
          onClick={() => fetchStats(true)}
          disabled={refreshing}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
        >
          <RefreshCw
            className={cn("w-4 h-4", refreshing && "animate-spin")}
          />
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {/* Period Detail Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <StatCard
          title="Last 24 Hours"
          subtitle="Today's activity"
          stats={stats.today}
          icon={Clock}
          iconBg="bg-amber-100"
          iconColor="text-amber-600"
        />
        <StatCard
          title="This Week"
          subtitle="Last 7 days"
          stats={stats.week}
          icon={TrendingUp}
          iconBg="bg-blue-100"
          iconColor="text-blue-600"
        />
      </div>

      {/* Summary Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-500">This Month</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">
                {stats.month.deployments}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                +{stats.month.linesAdded.toLocaleString()} / -
                {stats.month.linesDeleted.toLocaleString()} lines
              </p>
            </div>
            <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
              <Calendar className="w-5 h-5 text-emerald-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-500">Avg Frequency</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">
                {stats.averageTimeBetweenDeployments}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">between deploys</p>
            </div>
            <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
              <Activity className="w-5 h-5 text-purple-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-500">Total Deployments</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">
                {stats.totalDeployments}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">all time</p>
            </div>
            <div className="w-10 h-10 bg-ship-100 rounded-xl flex items-center justify-center">
              <GitCommit className="w-5 h-5 text-ship-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Net Code Change */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6">
        <h3 className="text-sm font-medium text-slate-900 mb-4">
          Net Code Change (This Month)
        </h3>
        <div className="flex items-center gap-8">
          <div>
            <p className="text-3xl font-bold text-emerald-600">
              +{stats.month.linesAdded.toLocaleString()}
            </p>
            <p className="text-sm text-slate-500">lines added</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-red-600">
              -{stats.month.linesDeleted.toLocaleString()}
            </p>
            <p className="text-sm text-slate-500">lines deleted</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-slate-900">
              {(
                stats.month.linesAdded - stats.month.linesDeleted
              ).toLocaleString()}
            </p>
            <p className="text-sm text-slate-500">net change</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-slate-700">
              {stats.month.filesChanged.toLocaleString()}
            </p>
            <p className="text-sm text-slate-500">files touched</p>
          </div>
        </div>
      </div>
    </div>
  );
}
