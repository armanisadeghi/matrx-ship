"use client";

import { useState, useEffect } from "react";
import {
  Loader2,
  AlertCircle,
  ArrowLeft,
  Key,
  Link2,
  Hash,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/admin/page-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  isUnique: boolean;
  maxLength: number | null;
}

interface IndexInfo {
  name: string;
  columns: string[];
  isUnique: boolean;
  isPrimary: boolean;
}

interface ForeignKeyInfo {
  constraintName: string;
  column: string;
  referencedTable: string;
  referencedColumn: string;
}

interface TableSchema {
  name: string;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  foreignKeys: ForeignKeyInfo[];
}

export default function SchemaPage() {
  const [schemas, setSchemas] = useState<TableSchema[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function fetchSchema() {
      try {
        const res = await fetch("/api/admin/database/schema");
        if (!res.ok) throw new Error("Failed to fetch schema");
        const data = await res.json();
        setSchemas(data.schemas);
        // Expand all tables by default
        setExpandedTables(new Set(data.schemas.map((s: TableSchema) => s.name)));
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setLoading(false);
      }
    }
    fetchSchema();
  }, []);

  const toggleTable = (name: string) => {
    setExpandedTables((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading schema...</p>
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
      title="Schema Browser"
      description={`${schemas.length} tables in public schema`}
      actions={
        <Button variant="outline" size="sm" asChild>
          <Link href="/admin/database">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Link>
        </Button>
      }
    >
      <div className="space-y-4">
        {schemas.map((schema) => {
          const isExpanded = expandedTables.has(schema.name);
          return (
            <div
              key={schema.name}
              className="bg-card rounded-xl border border-border shadow-sm overflow-hidden"
            >
              <button
                onClick={() => toggleTable(schema.name)}
                className="w-full px-5 py-4 flex items-center justify-between hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  )}
                  <span className="font-semibold font-mono text-sm text-foreground">
                    {schema.name}
                  </span>
                  <Badge variant="secondary" className="text-[10px]">
                    {schema.columns.length} columns
                  </Badge>
                  {schema.indexes.length > 0 && (
                    <Badge variant="outline" className="text-[10px]">
                      {schema.indexes.length} indexes
                    </Badge>
                  )}
                  {schema.foreignKeys.length > 0 && (
                    <Badge variant="outline" className="text-[10px]">
                      {schema.foreignKeys.length} FKs
                    </Badge>
                  )}
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-border">
                  {/* Columns */}
                  <div className="px-5 py-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                      Columns
                    </h4>
                    <div className="space-y-1">
                      {schema.columns.map((col) => (
                        <div
                          key={col.name}
                          className="flex items-center gap-3 py-1.5 px-2 rounded-md hover:bg-muted/30"
                        >
                          <div className="w-4">
                            {col.isPrimaryKey && (
                              <Key className="w-3.5 h-3.5 text-warning" />
                            )}
                          </div>
                          <span className="font-mono text-sm text-foreground min-w-[160px]">
                            {col.name}
                          </span>
                          <Badge variant="secondary" className="font-mono text-[10px]">
                            {col.type}
                            {col.maxLength ? `(${col.maxLength})` : ""}
                          </Badge>
                          {col.nullable && (
                            <span className="text-[10px] text-muted-foreground">
                              nullable
                            </span>
                          )}
                          {col.isUnique && (
                            <Badge variant="outline" className="text-[10px]">
                              unique
                            </Badge>
                          )}
                          {col.defaultValue && (
                            <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[200px]">
                              default: {col.defaultValue}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Indexes */}
                  {schema.indexes.length > 0 && (
                    <>
                      <Separator />
                      <div className="px-5 py-3">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                          Indexes
                        </h4>
                        <div className="space-y-1">
                          {schema.indexes.map((idx) => (
                            <div
                              key={idx.name}
                              className="flex items-center gap-3 py-1 px-2"
                            >
                              <Hash className="w-3.5 h-3.5 text-muted-foreground" />
                              <span className="font-mono text-xs text-foreground">
                                {idx.name}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                ({idx.columns.join(", ")})
                              </span>
                              {idx.isPrimary && (
                                <Badge variant="outline" className="text-[10px]">
                                  PRIMARY
                                </Badge>
                              )}
                              {idx.isUnique && !idx.isPrimary && (
                                <Badge variant="outline" className="text-[10px]">
                                  UNIQUE
                                </Badge>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  {/* Foreign Keys */}
                  {schema.foreignKeys.length > 0 && (
                    <>
                      <Separator />
                      <div className="px-5 py-3">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                          Foreign Keys
                        </h4>
                        <div className="space-y-1">
                          {schema.foreignKeys.map((fk) => (
                            <div
                              key={fk.constraintName}
                              className="flex items-center gap-3 py-1 px-2"
                            >
                              <Link2 className="w-3.5 h-3.5 text-muted-foreground" />
                              <span className="font-mono text-xs text-foreground">
                                {fk.column}
                              </span>
                              <span className="text-[10px] text-muted-foreground">→</span>
                              <span className="font-mono text-xs text-primary">
                                {fk.referencedTable}.{fk.referencedColumn}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </PageShell>
  );
}
