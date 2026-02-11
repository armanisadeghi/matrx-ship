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
          <Loader2 className="w-12 h-12 text-ship-600 animate-spin mx-auto mb-4" />
          <p className="text-slate-600">Loading dashboard...</p>
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
          <p className="text-slate-600">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-slate-500 mt-1">
          Deployment overview and current status
        </p>
      </div>

      {/* Current Version Hero */}
      <div className="bg-gradient-to-br from-ship-600 via-purple-600 to-indigo-700 rounded-2xl shadow-lg p-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
              <Package className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white/90">
                Current Version
              </h2>
              <p className="text-sm text-white/60">
                Currently deployed to production
              </p>
            </div>
          </div>
          {version && (
            <div className="text-right">
              <p className="text-sm text-white/60">Build Number</p>
              <p className="text-2xl font-bold text-white">
                {version.buildNumber}
              </p>
            </div>
          )}
        </div>

        <div className="text-center py-6">
          <div className="inline-flex items-baseline gap-3">
            <span className="text-white/60 text-2xl font-medium">v</span>
            <span className="text-7xl font-bold text-white tracking-tight">
              {version?.version || "0.0.0"}
            </span>
          </div>
        </div>

        {version && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6 pt-6 border-t border-white/20">
              <div className="flex items-center gap-3">
                <Calendar className="w-5 h-5 text-white/60" />
                <div>
                  <p className="text-xs text-white/60">Deployed</p>
                  <p className="text-sm font-medium text-white">
                    {formatRelativeTime(version.deployedAt)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Clock className="w-5 h-5 text-white/60" />
                <div>
                  <p className="text-xs text-white/60">Deploy Time</p>
                  <p className="text-sm font-medium text-white">
                    {new Date(version.deployedAt).toLocaleString("en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <GitCommit className="w-5 h-5 text-white/60" />
                <div>
                  <p className="text-xs text-white/60">Git Commit</p>
                  <p className="text-sm font-medium text-white font-mono">
                    {version.gitCommit?.substring(0, 7) || "N/A"}
                  </p>
                </div>
              </div>
            </div>

            {version.commitMessage && (
              <div className="mt-4 pt-4 border-t border-white/20">
                <div className="flex items-start gap-3">
                  <MessageSquare className="w-5 h-5 text-white/60 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs text-white/60 mb-1">
                      Commit Message
                    </p>
                    <p className="text-sm font-medium text-white">
                      {version.commitMessage}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {version.filesChanged !== null &&
              version.linesAdded !== null &&
              version.linesDeleted !== null && (
                <div className="mt-3 flex items-center gap-4 text-white/90">
                  <div className="flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-white/60" />
                    <span className="text-sm font-medium">
                      {version.filesChanged} files
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <Plus className="w-4 h-4 text-emerald-300" />
                      <span className="text-sm font-medium">
                        {version.linesAdded}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Minus className="w-4 h-4 text-red-300" />
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
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500">Today</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">
                  {stats.today.deployments}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  +{stats.today.linesAdded.toLocaleString()} / -
                  {stats.today.linesDeleted.toLocaleString()} lines
                </p>
              </div>
              <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
                <Clock className="w-5 h-5 text-amber-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500">This Week</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">
                  {stats.week.deployments}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  +{stats.week.linesAdded.toLocaleString()} / -
                  {stats.week.linesDeleted.toLocaleString()} lines
                </p>
              </div>
              <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-blue-600" />
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
        </div>
      )}

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link
          href="/admin/versions"
          className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 hover:border-ship-300 hover:shadow-md transition-all group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-ship-100 rounded-xl flex items-center justify-center">
                <GitCommit className="w-5 h-5 text-ship-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">
                  Version History
                </h3>
                <p className="text-sm text-slate-500">
                  {stats?.totalDeployments ?? 0} total deployments
                </p>
              </div>
            </div>
            <ArrowRight className="w-5 h-5 text-slate-400 group-hover:text-ship-600 transition-colors" />
          </div>
        </Link>

        <Link
          href="/admin/stats"
          className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 hover:border-ship-300 hover:shadow-md transition-all group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
                <BarChart3 className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">
                  Detailed Statistics
                </h3>
                <p className="text-sm text-slate-500">
                  Code metrics and trends
                </p>
              </div>
            </div>
            <ArrowRight className="w-5 h-5 text-slate-400 group-hover:text-emerald-600 transition-colors" />
          </div>
        </Link>
      </div>
    </div>
  );
}
