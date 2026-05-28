"use client";

// Reusable dense data table for the admin: sticky header, click-to-sort columns,
// a global filter box, compact rows, an optional row click, and an empty state.
// Built to replace the assorted ad-hoc <Table>/<Card> lists across the admin so
// every list behaves the same: an operator can scan, filter, and sort fast.
//
// Usage:
//   <DataTable
//     rows={items}
//     getRowKey={(r) => r.id}
//     getSearchText={(r) => `${r.name} ${r.status}`}   // powers the filter box
//     onRowClick={(r) => router.push(...)}              // optional
//     initialSort={{ key: "name", dir: "asc" }}
//     columns={[
//       { key: "name", header: "Name", sortValue: (r) => r.name, render: (r) => <b>{r.name}</b> },
//       { key: "status", header: "Status", sortValue: (r) => r.status, render: (r) => <Badge/> },
//       { key: "actions", header: "", sortable: false, align: "right", render: (r) => <Menu/> },
//     ]}
//   />

import { useMemo, useState, type ReactNode } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown, Search } from "lucide-react";
import { Input } from "@matrx/admin-ui/ui/input";
import { CopyControls } from "@/components/admin/copy-controls";

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Cell content. */
  render: (row: T) => ReactNode;
  /** Value used to sort this column. Omit (or set sortable:false) for non-sortable columns. */
  sortValue?: (row: T) => string | number | null | undefined;
  sortable?: boolean; // default: true when sortValue is provided
  align?: "left" | "right" | "center";
  /** Extra classes on the <td>/<th> (e.g. width, whitespace). */
  className?: string;
  /** Hide on small screens. */
  hideBelow?: "sm" | "md" | "lg";
}

type SortDir = "asc" | "desc";

function hideClass(b?: "sm" | "md" | "lg") {
  if (b === "sm") return "hidden sm:table-cell";
  if (b === "md") return "hidden md:table-cell";
  if (b === "lg") return "hidden lg:table-cell";
  return "";
}
function alignClass(a?: "left" | "right" | "center") {
  return a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";
}

export function DataTable<T>({
  rows,
  columns,
  getRowKey,
  getSearchText,
  onRowClick,
  initialSort,
  searchPlaceholder = "Filter…",
  emptyMessage = "Nothing here yet.",
  toolbar,
  copyView,
  copyDescription,
  copyGuidance,
  getRowData,
}: {
  rows: T[];
  columns: Column<T>[];
  getRowKey: (row: T) => string;
  getSearchText?: (row: T) => string;
  onRowClick?: (row: T) => void;
  initialSort?: { key: string; dir: SortDir };
  searchPlaceholder?: string;
  emptyMessage?: string;
  /** Extra controls rendered on the right of the filter bar. */
  toolbar?: ReactNode;
  /** When set (with getRowData), each row gets copy / copy-for-AI buttons and the
   *  toolbar gets a "copy all (filtered)" pair. copyView labels the source. */
  copyView?: string;
  copyDescription?: string;
  copyGuidance?: string;
  getRowData?: (row: T) => Record<string, unknown>;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(initialSort ?? null);

  // When copy is enabled, append a trailing copy column.
  const allColumns: Column<T>[] = useMemo(() => {
    if (!getRowData || !copyView) return columns;
    const copyCol: Column<T> = {
      key: "__copy", header: "", sortable: false, align: "right", className: "w-px",
      render: (row) => (
        <CopyControls
          plain={JSON.stringify(getRowData(row), null, 2)}
          ai={{ view: copyView, description: copyDescription, guidance: copyGuidance, data: getRowData(row) }}
        />
      ),
    };
    return [...columns, copyCol];
  }, [columns, getRowData, copyView, copyDescription, copyGuidance]);

  const colByKey = useMemo(() => Object.fromEntries(allColumns.map((c) => [c.key, c])), [allColumns]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !getSearchText) return rows;
    return rows.filter((r) => getSearchText(r).toLowerCase().includes(q));
  }, [rows, query, getSearchText]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = colByKey[sort.key];
    if (!col?.sortValue) return filtered;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = col.sortValue!(a), bv = col.sortValue!(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // nulls last
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
    });
  }, [filtered, sort, colByKey]);

  function toggleSort(col: Column<T>) {
    if (col.sortable === false || !col.sortValue) return;
    setSort((prev) => {
      if (!prev || prev.key !== col.key) return { key: col.key, dir: "asc" };
      if (prev.dir === "asc") return { key: col.key, dir: "desc" };
      return null; // third click clears
    });
  }

  return (
    <div className="space-y-2">
      {(getSearchText || toolbar || (copyView && getRowData)) && (
        <div className="flex items-center gap-2">
          {getSearchText && (
            <div className="relative flex-1 min-w-40 max-w-sm">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                className="pl-8 h-8 text-sm"
                placeholder={searchPlaceholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          )}
          <div className="flex-1" />
          {toolbar}
          {copyView && getRowData && (
            <CopyControls
              plain={JSON.stringify(sorted.map(getRowData), null, 2)}
              ai={{ view: copyView, description: copyDescription, guidance: (copyGuidance ? copyGuidance + " " : "") + `This is the full ${copyView} list (${sorted.length} rows${sorted.length !== rows.length ? ` filtered from ${rows.length}` : ""}).`, data: sorted.map(getRowData) }}
              size={15}
            />
          )}
          <span className="text-xs text-muted-foreground tabular-nums shrink-0">
            {sorted.length}{sorted.length !== rows.length ? ` / ${rows.length}` : ""}
          </span>
        </div>
      )}

      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur supports-[backdrop-filter]:bg-muted/80">
            <tr className="border-b">
              {allColumns.map((col) => {
                const canSort = col.sortable !== false && !!col.sortValue;
                const active = sort?.key === col.key;
                return (
                  <th
                    key={col.key}
                    onClick={() => toggleSort(col)}
                    className={`px-3 py-2 font-medium text-xs text-muted-foreground select-none ${alignClass(col.align)} ${hideClass(col.hideBelow)} ${canSort ? "cursor-pointer hover:text-foreground" : ""} ${col.className || ""}`}
                  >
                    <span className={`inline-flex items-center gap-1 ${col.align === "right" ? "flex-row-reverse" : ""}`}>
                      {col.header}
                      {canSort && (active
                        ? (sort!.dir === "asc" ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />)
                        : <ChevronsUpDown className="size-3 opacity-30" />)}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={allColumns.length} className="px-3 py-10 text-center text-sm text-muted-foreground">
                {query ? "Nothing matches that filter." : emptyMessage}
              </td></tr>
            ) : sorted.map((row) => (
              <tr
                key={getRowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`border-b last:border-0 ${onRowClick ? "cursor-pointer hover:bg-muted/40" : ""}`}
              >
                {allColumns.map((col) => (
                  <td key={col.key} className={`px-3 py-1.5 align-middle ${alignClass(col.align)} ${hideClass(col.hideBelow)} ${col.className || ""}`}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
