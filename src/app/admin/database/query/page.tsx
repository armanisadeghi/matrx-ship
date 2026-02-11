"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import {
  Play,
  Loader2,
  ArrowLeft,
  Clock,
  AlertTriangle,
  Rows3,
} from "lucide-react";
import Link from "next/link";
import { PageShell } from "@/components/admin/page-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Dynamic import CodeMirror to avoid SSR issues
const CodeMirrorEditor = dynamic(
  () => import("@/components/admin/sql-editor"),
  { ssr: false },
);

type Row = Record<string, unknown>;

interface QueryResult {
  rows: Row[];
  rowCount: number;
  fields: Array<{ name: string }>;
  duration: number;
}

export default function SQLConsolePage() {
  const [query, setQuery] = useState("SELECT * FROM app_version LIMIT 10;");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [history, setHistory] = useState<string[]>([]);

  const executeQuery = async () => {
    if (!query.trim() || executing) return;
    setExecuting(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/admin/database/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Query execution failed");
        return;
      }

      setResult(data);
      setHistory((prev) => {
        const next = [query.trim(), ...prev.filter((q) => q !== query.trim())];
        return next.slice(0, 20);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setExecuting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      executeQuery();
    }
  };

  return (
    <PageShell
      title="SQL Console"
      description="Execute queries against the database"
      actions={
        <Button variant="outline" size="sm" asChild>
          <Link href="/admin/database">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Link>
        </Button>
      }
    >
      {/* Editor */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="border-b border-border" onKeyDown={handleKeyDown}>
          <CodeMirrorEditor value={query} onChange={setQuery} />
        </div>
        <div className="px-4 py-3 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Press <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">⌘+Enter</kbd> to execute
          </p>
          <Button onClick={executeQuery} disabled={executing || !query.trim()}>
            {executing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Executing...
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-2" />
                Execute
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm text-destructive">Query Error</p>
              <p className="text-sm text-destructive/80 mt-1 font-mono">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <Rows3 className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">
                {result.rowCount} row{result.rowCount !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{result.duration}ms</span>
            </div>
            <Badge variant="secondary" className="text-xs">
              {result.fields.length} columns
            </Badge>
          </div>

          {result.rows.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {result.fields.map((field) => (
                      <TableHead key={field.name} className="font-mono text-xs whitespace-nowrap">
                        {field.name}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.rows.map((row, idx) => (
                    <TableRow key={idx}>
                      {result.fields.map((field) => {
                        const val = row[field.name];
                        const isNull = val === null || val === undefined;
                        const display = isNull
                          ? "NULL"
                          : typeof val === "object"
                            ? JSON.stringify(val)
                            : String(val);

                        return (
                          <TableCell
                            key={field.name}
                            className="font-mono text-xs whitespace-nowrap max-w-[300px] truncate"
                          >
                            {isNull ? (
                              <span className="text-muted-foreground/50 italic">NULL</span>
                            ) : display.length > 80 ? (
                              <span title={display}>{display.substring(0, 80)}...</span>
                            ) : (
                              display
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-muted-foreground text-sm">
              Query returned no rows
            </div>
          )}
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="bg-card rounded-xl border border-border shadow-sm p-4">
          <h3 className="text-sm font-medium text-foreground mb-3">Recent Queries</h3>
          <div className="space-y-1.5">
            {history.map((q, idx) => (
              <button
                key={idx}
                onClick={() => setQuery(q)}
                className="w-full text-left px-3 py-2 rounded-lg text-xs font-mono text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors truncate"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
    </PageShell>
  );
}
