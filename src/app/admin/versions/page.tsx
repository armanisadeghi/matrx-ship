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
import { PageShell } from "@/components/admin/page-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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

const statusVariants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  building: "outline",
  ready: "default",
  error: "destructive",
  canceled: "secondary",
};

const statusLabels: Record<string, string> = {
  pending: "Pending",
  building: "Building",
  ready: "Deployed",
  error: "Failed",
  canceled: "Canceled",
};

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
      const remaining = total - history.length;
      const batchSize = 100;
      const batches = Math.ceil(remaining / batchSize);

      for (let i = 0; i < batches; i++) {
        const offset = history.length + i * batchSize;
        const limit = Math.min(batchSize, remaining - i * batchSize);

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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading version history...</p>
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
          <Button onClick={() => fetchHistory()}>Try Again</Button>
        </div>
      </div>
    );
  }

  return (
    <PageShell
      title="Version History"
      description="Deployment history and status tracking"
      actions={
        <Button
          variant="outline"
          onClick={() => fetchHistory(true)}
          disabled={refreshing}
        >
          <RefreshCw className={cn("w-4 h-4 mr-2", refreshing && "animate-spin")} />
          {refreshing ? "Refreshing..." : "Refresh"}
        </Button>
      }
    >
      {/* Table */}
      <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <p className="text-sm font-medium text-foreground">All Versions</p>
          <p className="text-sm text-muted-foreground">
            {history.length} of {total}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Version
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Message
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Changes
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Deployed
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Commit
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {history.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <GitBranch className="w-12 h-12 text-muted-foreground/30" />
                      <p className="text-sm text-muted-foreground">
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
                  const s = v.deploymentStatus || "pending";

                  return (
                    <tr
                      key={v.id || index}
                      className={cn(
                        "hover:bg-muted/30 transition-colors",
                        isLatest && "bg-accent/30 border-l-2 border-l-primary",
                      )}
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={cn(
                            "text-sm font-semibold font-mono",
                            isLatest ? "text-primary" : "text-foreground",
                          )}
                        >
                          v{v.version}
                        </span>
                        <span className="text-xs text-muted-foreground ml-1">
                          #{v.buildNumber}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Badge variant={statusVariants[s] || "secondary"}>
                          {s === "building" && (
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                          )}
                          {statusLabels[s] || s}
                        </Badge>
                        {s === "ready" && v.vercelDeploymentUrl && (
                          <a
                            href={v.vercelDeploymentUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-1.5 inline-flex"
                          >
                            <ExternalLink className="w-3.5 h-3.5 text-primary hover:text-primary/80" />
                          </a>
                        )}
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        <p
                          className={cn(
                            "text-sm text-foreground/80",
                            !isExpanded && "truncate",
                          )}
                        >
                          {displayMessage || "No commit message"}
                        </p>
                        {isTruncated && (
                          <button
                            onClick={() => toggleMessageExpansion(v.id)}
                            className="text-xs text-primary hover:text-primary/80 font-medium"
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
                            <span className="text-muted-foreground">
                              {v.filesChanged}f
                            </span>
                            <span className="text-success font-medium">
                              +{v.linesAdded}
                            </span>
                            <span className="text-destructive font-medium">
                              -{v.linesDeleted}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            --
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-sm text-foreground/80">
                          {formatRelativeTime(v.deployedAt)}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {v.gitCommit ? (
                          <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">
                            {v.gitCommit.substring(0, 7)}
                          </code>
                        ) : (
                          <span className="text-xs text-muted-foreground">
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
          <div className="px-4 py-3 border-t border-border flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {history.length} of {total}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    Loading
                  </>
                ) : (
                  <>
                    Load More
                    <ChevronDown className="w-3.5 h-3.5 ml-1.5" />
                  </>
                )}
              </Button>
              <Button
                size="sm"
                onClick={loadAll}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    Loading
                  </>
                ) : (
                  <>Load All ({total - history.length})</>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}
