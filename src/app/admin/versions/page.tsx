"use client";

import { useState, useEffect } from "react";
import {
  GitBranch,
  GitCommit,
  Clock,
  Loader2,
  AlertCircle,
  RefreshCw,
  FileText,
  Plus,
  Minus,
  ChevronDown,
  ExternalLink,
} from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";

interface Version {
  id: string;
  version: string;
  buildNumber: number;
  gitCommit: string | null;
  commitMessage: string | null;
  linesAdded: number | null;
  linesDeleted: number | null;
  filesChanged: number | null;
  deployedAt: string;
  createdAt: string;
  deploymentStatus?: string | null;
  vercelDeploymentId?: string | null;
  vercelDeploymentUrl?: string | null;
  deploymentError?: string | null;
}

interface HistoryResponse {
  versions: Version[];
  total: number;
  limit: number;
  offset: number;
}

export default function VersionsPage() {
  const [history, setHistory] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(
    new Set(),
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);

  const truncateMessage = (
    message: string | null,
    maxLength: number = 50,
  ): { text: string; isTruncated: boolean } => {
    if (!message) return { text: "No commit message", isTruncated: false };
    if (message.length <= maxLength)
      return { text: message, isTruncated: false };
    return {
      text: message.substring(0, maxLength) + "...",
      isTruncated: true,
    };
  };

  const toggleMessageExpansion = (versionId: string) => {
    setExpandedMessages((prev) => {
      const next = new Set(prev);
      if (next.has(versionId)) {
        next.delete(versionId);
      } else {
        next.add(versionId);
      }
      return next;
    });
  };

  const fetchHistory = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/version/history?limit=20&offset=0");
      if (!res.ok) throw new Error("Failed to fetch version history");

      const data: HistoryResponse = await res.json();
      setHistory(data.versions);
      setTotal(data.total);
      setHasMore(data.versions.length < data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);

    try {
      const offset = history.length;
      const res = await fetch(
        `/api/version/history?limit=20&offset=${offset}`,
      );
      if (!res.ok) throw new Error("Failed to load more versions");

      const data: HistoryResponse = await res.json();
      setHistory((prev) => [...prev, ...data.versions]);
      setHasMore(history.length + data.versions.length < data.total);
    } catch (err) {
      console.error("Error loading more:", err);
    } finally {
      setLoadingMore(false);
    }
  };

  const loadAll = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);

    try {
      // Calculate how many versions remain
      const remaining = total - history.length;
      
      // Fetch all remaining versions (API max is 100 per request)
      const batchSize = 100;
      const batches = Math.ceil(remaining / batchSize);
      
      for (let i = 0; i < batches; i++) {
        const offset = history.length + (i * batchSize);
        const limit = Math.min(batchSize, remaining - (i * batchSize));
        
        const res = await fetch(
          `/api/version/history?limit=${limit}&offset=${offset}`,
        );
        
        if (!res.ok) throw new Error("Failed to load versions");
        
        const data: HistoryResponse = await res.json();
        setHistory((prev) => [...prev, ...data.versions]);
      }
      
      setHasMore(false);
    } catch (err) {
      console.error("Error loading all versions:", err);
    } finally {
      setLoadingMore(false);
    }
  };

  const getStatusBadge = (status?: string | null) => {
    const styles: Record<string, string> = {
      pending: "bg-slate-100 text-slate-700",
      building: "bg-blue-100 text-blue-700",
      ready: "bg-green-100 text-green-700",
      error: "bg-red-100 text-red-700",
      canceled: "bg-yellow-100 text-yellow-700",
    };
    const labels: Record<string, string> = {
      pending: "Pending",
      building: "Building",
      ready: "Deployed",
      error: "Failed",
      canceled: "Canceled",
    };

    const s = status || "pending";
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
          styles[s] || styles.pending,
        )}
      >
        {s === "building" && (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        )}
        {s === "ready" && (
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        )}
        {s === "error" && <AlertCircle className="w-3.5 h-3.5" />}
        {s === "pending" && <Clock className="w-3.5 h-3.5" />}
        {labels[s] || s}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-ship-600 animate-spin mx-auto mb-4" />
          <p className="text-slate-600">Loading version history...</p>
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
            onClick={() => fetchHistory()}
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
          <h1 className="text-2xl font-bold text-slate-900">
            Version History
          </h1>
          <p className="text-slate-500 mt-1">
            Deployment history and status tracking
          </p>
        </div>
        <button
          onClick={() => fetchHistory(true)}
          disabled={refreshing}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
        >
          <RefreshCw
            className={cn("w-4 h-4", refreshing && "animate-spin")}
          />
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <p className="text-sm font-medium text-slate-700">
            All Versions
          </p>
          <p className="text-sm text-slate-500">
            {history.length} of {total}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Version
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Message
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Changes
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Deployed
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Commit
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {history.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <GitBranch className="w-12 h-12 text-slate-300" />
                      <p className="text-sm text-slate-500">
                        No version history yet
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                history.map((v, index) => {
                  const isLatest = index === 0;
                  const isExpanded = expandedMessages.has(v.id);
                  const { text: messageText, isTruncated } = truncateMessage(
                    v.commitMessage,
                  );
                  const displayMessage = isExpanded
                    ? v.commitMessage
                    : messageText;

                  return (
                    <tr
                      key={v.id || index}
                      className={cn(
                        "hover:bg-slate-50 transition-colors",
                        isLatest &&
                          "bg-ship-50/50 border-l-2 border-l-ship-500",
                      )}
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={cn(
                            "text-sm font-semibold font-mono",
                            isLatest ? "text-ship-700" : "text-slate-900",
                          )}
                        >
                          v{v.version}
                        </span>
                        <span className="text-xs text-slate-400 ml-1">
                          #{v.buildNumber}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {getStatusBadge(v.deploymentStatus)}
                        {v.deploymentStatus === "ready" &&
                          v.vercelDeploymentUrl && (
                            <a
                              href={v.vercelDeploymentUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ml-1.5 inline-flex"
                            >
                              <ExternalLink className="w-3.5 h-3.5 text-ship-600 hover:text-ship-700" />
                            </a>
                          )}
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        <p
                          className={cn(
                            "text-sm text-slate-700",
                            !isExpanded && "truncate",
                          )}
                        >
                          {displayMessage || "No commit message"}
                        </p>
                        {isTruncated && (
                          <button
                            onClick={() => toggleMessageExpansion(v.id)}
                            className="text-xs text-ship-600 hover:text-ship-700 font-medium"
                          >
                            {isExpanded ? "less" : "more"}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        {v.filesChanged !== null &&
                        v.linesAdded !== null &&
                        v.linesDeleted !== null ? (
                          <div className="flex items-center justify-end gap-2 text-xs">
                            <span className="text-slate-500">
                              {v.filesChanged}f
                            </span>
                            <span className="text-emerald-600 font-medium">
                              +{v.linesAdded}
                            </span>
                            <span className="text-red-500 font-medium">
                              -{v.linesDeleted}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">
                            --
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-sm text-slate-700">
                          {formatRelativeTime(v.deployedAt)}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {v.gitCommit ? (
                          <code className="text-xs text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded font-mono">
                            {v.gitCommit.substring(0, 7)}
                          </code>
                        ) : (
                          <span className="text-xs text-slate-400">
                            --
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Load More / Load All */}
        {hasMore && (
          <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between">
            <p className="text-sm text-slate-600">
              Showing {history.length} of {total}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Loading
                  </>
                ) : (
                  <>
                    Load More
                    <ChevronDown className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
              <button
                onClick={loadAll}
                disabled={loadingMore}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-ship-600 text-white rounded-lg hover:bg-ship-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Loading
                  </>
                ) : (
                  <>
                    Load All ({total - history.length})
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
