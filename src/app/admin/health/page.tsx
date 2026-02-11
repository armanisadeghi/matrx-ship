"use client";

import { useState, useEffect } from "react";
import {
  Loader2,
  AlertCircle,
  HeartPulse,
  Database,
  HardDrive,
  Clock,
  RefreshCw,
  Activity,
  Rows3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/admin/page-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface HealthData {
  status: string;
  database: string;
  version: string;
  timestamp: string;
}

interface TableInfo {
  name: string;
  rowCount: number;
  sizeFormatted: string;
}

export default function HealthPage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dbActivity, setDbActivity] = useState<Record<string, unknown>[]>([]);

  const fetchAll = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const [healthRes, tablesRes, activityRes] = await Promise.all([
        fetch("/api/health"),
        fetch("/api/admin/database/tables"),
        fetch("/api/logs/database?type=activity"),
      ]);

      if (healthRes.ok) setHealth(await healthRes.json());
      if (tablesRes.ok) {
        const data = await tablesRes.json();
        setTables(data.tables);
      }
      if (activityRes.ok) {
        const data = await activityRes.json();
        setDbActivity(data.activity || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Running health checks...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-foreground mb-2">Failed to load</h2>
          <p className="text-muted-foreground mb-4">{error}</p>
          <Button onClick={() => fetchAll()}>Try Again</Button>
        </div>
      </div>
    );
  }

  const totalRows = tables.reduce((sum, t) => sum + t.rowCount, 0);

  return (
    <PageShell
      title="Health"
      description="System health and database diagnostics"
      actions={
        <Button
          variant="outline"
          onClick={() => fetchAll(true)}
          disabled={refreshing}
        >
          <RefreshCw className={cn("w-4 h-4 mr-2", refreshing && "animate-spin")} />
          Refresh
        </Button>
      }
    >
      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-card rounded-xl border border-border shadow-sm p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">System Status</p>
              <p className="text-xl font-bold text-foreground mt-1">
                {health?.status === "ok" ? "Healthy" : "Degraded"}
              </p>
            </div>
            <div className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center",
              health?.status === "ok" ? "bg-success/10" : "bg-destructive/10",
            )}>
              <HeartPulse className={cn(
                "w-5 h-5",
                health?.status === "ok" ? "text-success" : "text-destructive",
              )} />
            </div>
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border shadow-sm p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Database</p>
              <p className="text-xl font-bold text-foreground mt-1">
                {health?.database === "connected" ? "Connected" : "Error"}
              </p>
            </div>
            <div className="w-10 h-10 bg-info/10 rounded-xl flex items-center justify-center">
              <Database className="w-5 h-5 text-info" />
            </div>
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border shadow-sm p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Active Connections</p>
              <p className="text-xl font-bold text-foreground mt-1">
                {dbActivity.length}
              </p>
            </div>
            <div className="w-10 h-10 bg-warning/10 rounded-xl flex items-center justify-center">
              <Activity className="w-5 h-5 text-warning" />
            </div>
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border shadow-sm p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Total Rows</p>
              <p className="text-xl font-bold text-foreground mt-1">
                {totalRows.toLocaleString()}
              </p>
            </div>
            <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
              <Rows3 className="w-5 h-5 text-primary" />
            </div>
          </div>
        </div>
      </div>

      {/* Table Sizes */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-muted-foreground" />
            Table Sizes
          </h3>
        </div>
        <div className="divide-y divide-border/50">
          {tables.map((t) => (
            <div key={t.name} className="px-5 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <code className="font-mono text-sm text-foreground">{t.name}</code>
                <Badge variant="secondary" className="text-[10px]">
                  {t.rowCount.toLocaleString()} rows
                </Badge>
              </div>
              <span className="text-sm text-muted-foreground font-mono">
                {t.sizeFormatted}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Uptime */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-5">
        <div className="flex items-center gap-3">
          <Clock className="w-4.5 h-4.5 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium text-foreground">Last Health Check</p>
            <p className="text-xs text-muted-foreground">
              {health?.timestamp
                ? new Date(health.timestamp).toLocaleString("en-US", {
                    dateStyle: "medium",
                    timeStyle: "medium",
                  })
                : "N/A"}
            </p>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
