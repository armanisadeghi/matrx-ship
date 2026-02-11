"use client";

import { useState, useEffect, useRef } from "react";
import {
  Loader2,
  AlertCircle,
  RefreshCw,
  Search,
  Radio,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/admin/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface LogEntry {
  id: string;
  timestamp: string;
  level: string;
  source: string;
  environment: string;
  message: string;
  metadata: Record<string, unknown> | null;
  requestId: string | null;
  durationMs: number | null;
}

const levelBadgeVariants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  info: "secondary",
  warn: "outline",
  error: "destructive",
  debug: "secondary",
  fatal: "destructive",
};

export default function LogsPage() {
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState<string>("all");
  const [source, setSource] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [liveTail, setLiveTail] = useState(false);
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const liveTailRef = useRef<NodeJS.Timeout | null>(null);

  const fetchLogs = async () => {
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "50" });
      if (level !== "all") params.set("level", level);
      if (source !== "all") params.set("source", source);
      if (searchQuery) params.set("search", searchQuery);

      const res = await fetch(`/api/logs?${params}`);
      if (!res.ok) throw new Error("Failed to fetch logs");
      const data = await res.json();
      setLogEntries(data.logs);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, level, source]);

  // Live tail polling
  useEffect(() => {
    if (liveTail) {
      liveTailRef.current = setInterval(fetchLogs, 5000);
    }
    return () => {
      if (liveTailRef.current) clearInterval(liveTailRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveTail, level, source, searchQuery]);

  const handleSearch = () => {
    setPage(1);
    fetchLogs();
  };

  const toggleExpand = (id: string) => {
    setExpandedLogs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading && logEntries.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading logs...</p>
        </div>
      </div>
    );
  }

  if (error && logEntries.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-foreground mb-2">Failed to load</h2>
          <p className="text-muted-foreground mb-4">{error}</p>
          <Button onClick={() => fetchLogs()}>Try Again</Button>
        </div>
      </div>
    );
  }

  return (
    <PageShell
      title="Logs"
      description="Application and system logs"
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant={liveTail ? "default" : "outline"}
            size="sm"
            onClick={() => setLiveTail(!liveTail)}
          >
            <Radio className={cn("w-4 h-4 mr-2", liveTail && "animate-pulse")} />
            {liveTail ? "Live" : "Live Tail"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setPage(1);
              fetchLogs();
            }}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
      }
    >
      <Tabs defaultValue="all" className="space-y-4">
        <TabsList>
          <TabsTrigger value="all">All Logs</TabsTrigger>
          <TabsTrigger value="application">Application</TabsTrigger>
          <TabsTrigger value="database">Database</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-4">
          {/* Filters */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search logs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="pl-9 h-9"
              />
            </div>
            <Select value={level} onValueChange={(v) => { setLevel(v); setPage(1); }}>
              <SelectTrigger className="w-[130px] h-9">
                <SelectValue placeholder="Level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Levels</SelectItem>
                <SelectItem value="debug">Debug</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warn">Warning</SelectItem>
                <SelectItem value="error">Error</SelectItem>
                <SelectItem value="fatal">Fatal</SelectItem>
              </SelectContent>
            </Select>
            <Select value={source} onValueChange={(v) => { setSource(v); setPage(1); }}>
              <SelectTrigger className="w-[130px] h-9">
                <SelectValue placeholder="Source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                <SelectItem value="app">App</SelectItem>
                <SelectItem value="api">API</SelectItem>
                <SelectItem value="external">External</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Log Entries */}
          <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {total} total logs
              </p>
              {liveTail && (
                <Badge variant="default" className="animate-pulse">
                  <Radio className="w-3 h-3 mr-1" />
                  Live
                </Badge>
              )}
            </div>

            <div className="divide-y divide-border/50">
              {logEntries.length === 0 ? (
                <div className="px-4 py-12 text-center text-muted-foreground text-sm">
                  No log entries found
                </div>
              ) : (
                logEntries.map((entry) => {
                  const isExpanded = expandedLogs.has(entry.id);
                  return (
                    <div
                      key={entry.id}
                      className="px-4 py-2.5 hover:bg-muted/20 transition-colors cursor-pointer"
                      onClick={() => toggleExpand(entry.id)}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap w-[140px] shrink-0">
                          {new Date(entry.timestamp).toLocaleString("en-US", {
                            dateStyle: "short",
                            timeStyle: "medium",
                          })}
                        </span>
                        <Badge
                          variant={levelBadgeVariants[entry.level] || "secondary"}
                          className="text-[10px] w-12 justify-center shrink-0"
                        >
                          {entry.level.toUpperCase()}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          {entry.source}
                        </Badge>
                        <span className="text-sm text-foreground truncate flex-1">
                          {entry.message}
                        </span>
                        {entry.durationMs !== null && (
                          <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                            {entry.durationMs}ms
                          </span>
                        )}
                        <ChevronDown
                          className={cn(
                            "w-4 h-4 text-muted-foreground shrink-0 transition-transform",
                            isExpanded && "rotate-180",
                          )}
                        />
                      </div>

                      {isExpanded && (
                        <div className="mt-2 ml-[152px] space-y-2">
                          {entry.requestId && (
                            <p className="text-xs text-muted-foreground">
                              Request ID: <code className="bg-muted px-1 rounded">{entry.requestId}</code>
                            </p>
                          )}
                          {entry.metadata && (
                            <pre className="text-xs bg-muted rounded-lg p-3 overflow-x-auto text-foreground font-mono">
                              {JSON.stringify(entry.metadata, null, 2)}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-border flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="application" className="space-y-4">
          <div className="bg-card rounded-xl border border-border shadow-sm p-8 text-center">
            <p className="text-muted-foreground">
              Application logs filter — coming with Pino integration (Phase 4)
            </p>
          </div>
        </TabsContent>

        <TabsContent value="database" className="space-y-4">
          <DatabaseLogs />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

function DatabaseLogs() {
  const [activity, setActivity] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchActivity() {
      try {
        const res = await fetch("/api/logs/database?type=activity");
        if (!res.ok) throw new Error("Failed");
        const data = await res.json();
        setActivity(data.activity || []);
      } catch {
        // Silently fail for db logs
      } finally {
        setLoading(false);
      }
    }
    fetchActivity();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-medium text-foreground">
          Active Connections ({activity.length})
        </h3>
      </div>
      <div className="divide-y divide-border/50">
        {activity.length === 0 ? (
          <div className="px-4 py-8 text-center text-muted-foreground text-sm">
            No active connections
          </div>
        ) : (
          activity.map((conn, idx) => (
            <div key={idx} className="px-4 py-3">
              <div className="flex items-center gap-3 text-xs">
                <Badge variant="outline" className="text-[10px]">
                  PID: {String(conn.pid)}
                </Badge>
                <Badge variant="secondary" className="text-[10px]">
                  {String(conn.state || "unknown")}
                </Badge>
                <span className="text-muted-foreground">
                  {String(conn.application_name || "—")}
                </span>
              </div>
              {conn.query ? (
                <code className="block mt-1.5 text-xs text-muted-foreground font-mono truncate">
                  {String(conn.query)}
                </code>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
