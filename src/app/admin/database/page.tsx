"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Database,
  Table2,
  Loader2,
  AlertCircle,
  RefreshCw,
  HardDrive,
  Rows3,
  Columns3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/admin/page-shell";
import { Button } from "@/components/ui/button";

interface TableInfo {
  name: string;
  schema: string;
  rowCount: number;
  sizeBytes: number;
  sizeFormatted: string;
  columnCount: number;
}

export default function DatabasePage() {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTables = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/database/tables");
      if (!res.ok) throw new Error("Failed to fetch tables");
      const data = await res.json();
      setTables(data.tables);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchTables();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading database tables...</p>
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
          <Button onClick={() => fetchTables()}>Try Again</Button>
        </div>
      </div>
    );
  }

  return (
    <PageShell
      title="Database"
      description="Browse tables, view data, and manage your database"
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/admin/database/schema">Schema</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/admin/database/migrations">Migrations</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/admin/database/query">SQL Console</Link>
          </Button>
          <Button
            variant="outline"
            onClick={() => fetchTables(true)}
            disabled={refreshing}
          >
            <RefreshCw className={cn("w-4 h-4 mr-2", refreshing && "animate-spin")} />
            Refresh
          </Button>
        </div>
      }
    >
      {tables.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <Database className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground">No tables found</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {tables.map((table) => (
            <Link
              key={table.name}
              href={`/admin/database/${table.name}`}
              className="bg-card rounded-xl border border-border shadow-sm p-5 hover:border-primary/40 hover:shadow-md transition-all group"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 bg-primary/10 rounded-lg flex items-center justify-center">
                    <Table2 className="w-4.5 h-4.5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground font-mono text-sm">
                      {table.name}
                    </h3>
                    <p className="text-xs text-muted-foreground">{table.schema}</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 pt-3 border-t border-border">
                <div className="flex items-center gap-1.5">
                  <Rows3 className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    {table.rowCount.toLocaleString()} rows
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Columns3 className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    {table.columnCount} cols
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <HardDrive className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    {table.sizeFormatted}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </PageShell>
  );
}
