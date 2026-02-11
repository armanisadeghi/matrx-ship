"use client";

import { useState, useEffect } from "react";
import { use } from "react";
import {
  Loader2,
  AlertCircle,
  RefreshCw,
  ArrowLeft,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
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

type Row = Record<string, unknown>;

interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
}

interface RowsResponse {
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export default function TableViewerPage({
  params,
}: {
  params: Promise<{ table: string }>;
}) {
  const { table } = use(params);
  const [data, setData] = useState<RowsResponse | null>(null);
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const fetchData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (sortBy) {
        params.set("sortBy", sortBy);
        params.set("sortOrder", sortOrder);
      }

      const [rowsRes, schemaRes] = await Promise.all([
        fetch(`/api/admin/database/${table}/rows?${params}`),
        fetch(`/api/admin/database/schema?table=${table}`),
      ]);

      if (!rowsRes.ok) throw new Error("Failed to fetch rows");
      if (!schemaRes.ok) throw new Error("Failed to fetch schema");

      const rowsData: RowsResponse = await rowsRes.json();
      const schemaData = await schemaRes.json();

      setData(rowsData);
      setColumns(schemaData.columns || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, page, sortBy, sortOrder]);

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(column);
      setSortOrder("desc");
    }
    setPage(1);
  };

  const handleDelete = async (row: Row) => {
    const pkCol = columns.find((c) => c.isPrimaryKey);
    if (!pkCol) return;

    const id = row[pkCol.name];
    if (!confirm(`Delete this row? (${pkCol.name}: ${id})`)) return;

    try {
      const res = await fetch(`/api/admin/database/${table}/rows/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete row");
      fetchData(true);
    } catch (err) {
      console.error("Delete error:", err);
    }
  };

  const formatCellValue = (value: unknown): string => {
    if (value === null || value === undefined) return "NULL";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading table data...</p>
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
          <Button onClick={() => fetchData()}>Try Again</Button>
        </div>
      </div>
    );
  }

  const visibleColumns = columns.length > 0
    ? columns.map((c) => c.name)
    : data?.rows.length ? Object.keys(data.rows[0]) : [];

  return (
    <PageShell
      title={table}
      description={`${data?.total ?? 0} rows · ${columns.length} columns`}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/database">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchData(true)}
            disabled={refreshing}
          >
            <RefreshCw className={cn("w-4 h-4 mr-2", refreshing && "animate-spin")} />
            Refresh
          </Button>
        </div>
      }
    >
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {visibleColumns.map((col) => {
                  const colInfo = columns.find((c) => c.name === col);
                  return (
                    <TableHead
                      key={col}
                      className="cursor-pointer hover:bg-muted/50 whitespace-nowrap"
                      onClick={() => handleSort(col)}
                    >
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-xs">{col}</span>
                        {colInfo?.isPrimaryKey && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5">
                            PK
                          </Badge>
                        )}
                        {sortBy === col && (
                          <span className="text-primary text-xs">
                            {sortOrder === "asc" ? "↑" : "↓"}
                          </span>
                        )}
                      </div>
                      {colInfo && (
                        <span className="text-[10px] text-muted-foreground font-normal">
                          {colInfo.type}
                        </span>
                      )}
                    </TableHead>
                  );
                })}
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={visibleColumns.length + 1}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No rows found.
                  </TableCell>
                </TableRow>
              ) : (
                data?.rows.map((row, idx) => (
                  <TableRow key={idx}>
                    {visibleColumns.map((col) => {
                      const val = row[col];
                      const display = formatCellValue(val);
                      const isNull = val === null || val === undefined;

                      return (
                        <TableCell key={col} className="font-mono text-xs whitespace-nowrap max-w-[300px] truncate">
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
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDelete(row)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {data && data.totalPages > 1 && (
          <div className="px-4 py-3 border-t border-border flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Page {data.page} of {data.totalPages} · {data.total} total rows
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
                onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                disabled={page >= data.totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}
