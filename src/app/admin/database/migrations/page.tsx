"use client";

import { useState, useEffect } from "react";
import { Loader2, AlertCircle, ArrowLeft, GitBranch, Clock } from "lucide-react";
import Link from "next/link";
import { PageShell } from "@/components/admin/page-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Migration {
  version: string;
  tag: string;
  createdAt: number;
}

export default function MigrationsPage() {
  const [migrations, setMigrations] = useState<Migration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchMigrations() {
      try {
        const res = await fetch("/api/admin/database/migrations");
        if (!res.ok) throw new Error("Failed to fetch migrations");
        const data = await res.json();
        setMigrations(data.migrations);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setLoading(false);
      }
    }
    fetchMigrations();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading migrations...</p>
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
          <Button onClick={() => window.location.reload()}>Try Again</Button>
        </div>
      </div>
    );
  }

  return (
    <PageShell
      title="Migrations"
      description={`${migrations.length} migrations applied`}
      actions={
        <Button variant="outline" size="sm" asChild>
          <Link href="/admin/database">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Link>
        </Button>
      }
    >
      {migrations.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <GitBranch className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground">No migrations found</p>
          </div>
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="divide-y divide-border/50">
            {migrations.map((migration, idx) => {
              const date = new Date(migration.createdAt);
              const isLatest = idx === 0;

              return (
                <div
                  key={migration.version}
                  className="px-5 py-4 flex items-start gap-4"
                >
                  <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0 mt-0.5">
                    <GitBranch className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <code className="font-mono text-sm text-foreground">
                        {migration.tag}
                      </code>
                      {isLatest && <Badge>Latest</Badge>}
                    </div>
                    <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        <span>
                          {date.toLocaleDateString("en-US", {
                            dateStyle: "medium",
                          })}{" "}
                          at{" "}
                          {date.toLocaleTimeString("en-US", {
                            timeStyle: "short",
                          })}
                        </span>
                      </div>
                      <code className="bg-muted px-1.5 py-0.5 rounded text-[10px]">
                        {migration.version.substring(0, 12)}...
                      </code>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </PageShell>
  );
}
