"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Database,
  Plus,
  Loader2,
  AlertCircle,
  RefreshCw,
  HardDrive,
  Table2,
  ExternalLink,
  Trash2,
  LayoutGrid,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/admin/page-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface ManagedDatabase {
  id: string;
  databaseName: string;
  displayName: string;
  description: string | null;
  template: string | null;
  status: string;
  sizeBytes: number | null;
  tableCount: number | null;
  createdBy: string | null;
  createdAt: string | null;
  isDefault: boolean;
}

const DATA_TOOLS = [
  {
    name: "NocoDB",
    description: "Spreadsheet view — like Airtable",
    path: "/nocodb",
    color: "text-blue-500",
  },
  {
    name: "Mathesar",
    description: "Clean data explorer",
    path: "/mathesar",
    color: "text-emerald-500",
  },
  {
    name: "Directus",
    description: "Content manager — CMS-style",
    path: "/directus",
    color: "text-purple-500",
  },
];

export default function DatabasesPage() {
  const [databases, setDatabases] = useState<ManagedDatabase[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchDatabases = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/databases");
      if (!res.ok) throw new Error("Failed to fetch databases");
      const data = await res.json();
      setDatabases(data.databases);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchDatabases();
  }, []);

  const handleDelete = async (db: ManagedDatabase) => {
    if (db.isDefault) return;
    if (
      !confirm(
        `Are you sure you want to delete "${db.displayName}"?\n\nThis will permanently drop the "${db.databaseName}" database and ALL its data. This cannot be undone.`,
      )
    )
      return;

    setDeletingId(db.id);
    try {
      const res = await fetch(`/api/admin/databases/${db.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete database");
      }
      fetchDatabases(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete database");
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading databases...</p>
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
          <Button onClick={() => fetchDatabases()}>Try Again</Button>
        </div>
      </div>
    );
  }

  return (
    <PageShell
      title="Databases"
      description="Create and manage your databases. Use any of the three data management tools to view and edit your data."
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => fetchDatabases(true)}
            disabled={refreshing}
          >
            <RefreshCw
              className={cn("w-4 h-4 mr-2", refreshing && "animate-spin")}
            />
            Refresh
          </Button>
          <Button asChild>
            <Link href="/admin/databases/new">
              <Plus className="w-4 h-4 mr-2" />
              New Database
            </Link>
          </Button>
        </div>
      }
    >
      {/* Data Management Tools */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-5 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <LayoutGrid className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">
            Data Management Tools
          </h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          All three tools connect to the same databases. Pick whichever view you
          prefer.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {DATA_TOOLS.map((tool) => (
            <a
              key={tool.name}
              href={tool.path}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between px-4 py-3 rounded-lg border border-border hover:border-primary/40 hover:bg-muted/30 transition-all group"
            >
              <div>
                <span className={cn("text-sm font-semibold", tool.color)}>
                  {tool.name}
                </span>
                <p className="text-xs text-muted-foreground">
                  {tool.description}
                </p>
              </div>
              <ExternalLink className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
            </a>
          ))}
        </div>
      </div>

      {/* Database List */}
      <div className="space-y-4">
        {databases.map((db) => (
          <div
            key={db.id}
            className="bg-card rounded-xl border border-border shadow-sm p-5 hover:border-primary/20 transition-colors"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center mt-0.5">
                  <Database className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-foreground">
                      {db.displayName}
                    </h3>
                    {db.isDefault && (
                      <Badge variant="secondary" className="text-[10px]">
                        Default
                      </Badge>
                    )}
                    <Badge
                      variant={
                        db.status === "active" ? "outline" : "destructive"
                      }
                      className="text-[10px]"
                    >
                      {db.status}
                    </Badge>
                    {db.template && db.template !== "blank" && (
                      <Badge variant="outline" className="text-[10px]">
                        {db.template}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm font-mono text-muted-foreground">
                    {db.databaseName}
                  </p>
                  {db.description && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {db.description}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/admin/database?db=${db.databaseName}`}>
                    <Table2 className="w-3.5 h-3.5 mr-1.5" />
                    Browse
                  </Link>
                </Button>
                {!db.isDefault && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(db)}
                    disabled={deletingId === db.id}
                  >
                    {deletingId === db.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </Button>
                )}
              </div>
            </div>

            {/* Stats row */}
            <div className="flex items-center gap-6 mt-3 pt-3 border-t border-border">
              {db.tableCount !== null && (
                <div className="flex items-center gap-1.5">
                  <Table2 className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    {db.tableCount} tables
                  </span>
                </div>
              )}
              {db.sizeBytes !== null && (
                <div className="flex items-center gap-1.5">
                  <HardDrive className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    {formatBytes(db.sizeBytes)}
                  </span>
                </div>
              )}
              {db.createdAt && (
                <span className="text-xs text-muted-foreground">
                  Created{" "}
                  {new Date(db.createdAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </PageShell>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
