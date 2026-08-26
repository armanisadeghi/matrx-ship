import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/oauth";

type Row = Record<string, unknown>;

async function validateTableName(name: string): Promise<boolean> {
  const result: Row[] = await db.execute(sql`
    SELECT 1 FROM pg_catalog.pg_tables
    WHERE schemaname = 'public'
      AND tablename = ${name}
      AND tablename NOT LIKE 'drizzle_%'
    LIMIT 1
  `);
  return result.length > 0;
}

// pg_catalog, never information_schema. The information_schema constraint views
// are privilege-FILTERED, so under any session that is not the role we assume a
// table with a perfectly good primary key resolves to null and every PATCH/DELETE
// here fails with "no primary key". (aidream FOUND_DEFECTS: pooled connections
// intermittently run as `authenticated`.)
async function getPrimaryKeyColumn(table: string): Promise<string | null> {
  const result: Row[] = await db.execute(sql`
    SELECT a.attname AS column_name
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
    WHERE i.indisprimary
      AND n.nspname = 'public'
      AND c.relname = ${table}
      AND NOT a.attisdropped
    ORDER BY a.attnum
    LIMIT 1
  `);
  return result.length > 0 ? String(result[0].column_name) : null;
}

function escapeValue(val: unknown): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "number") return String(val);
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  // Objects and arrays must be serialised as JSON. String(val) renders them
  // "[object Object]", which a json/jsonb column rejects outright — so editing
  // any JSONB field through this admin surface simply failed.
  if (typeof val === "object") {
    return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
  }
  return `'${String(val).replace(/'/g, "''")}'`;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ table: string; id: string }> },
) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const { table, id } = await params;

    if (!(await validateTableName(table))) {
      return NextResponse.json(
        { error: `Table "${table}" not found` },
        { status: 404 },
      );
    }

    const pkColumn = await getPrimaryKeyColumn(table);
    if (!pkColumn) {
      return NextResponse.json(
        { error: "Table has no primary key" },
        { status: 400 },
      );
    }

    const body = await request.json();
    if (!body || typeof body !== "object" || Object.keys(body).length === 0) {
      return NextResponse.json(
        { error: "Request body must be a non-empty object" },
        { status: 400 },
      );
    }

    // Validate columns
    const columns = Object.keys(body);
    const colCheck: Row[] = await db.execute(sql`
      SELECT a.attname AS column_name
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = ${table}
        AND a.attname = ANY(${columns})
        AND a.attnum > 0 AND NOT a.attisdropped
    `);
    const validColumns = colCheck.map((r: Row) => String(r.column_name));

    if (validColumns.length === 0) {
      return NextResponse.json(
        { error: "No valid columns to update" },
        { status: 400 },
      );
    }

    // Never write a SUBSET of what was asked for and report success. The old code
    // silently dropped any unrecognized column and returned 200, so a partial
    // write was indistinguishable from a complete one — the POST sibling already
    // rejects the same case with 400.
    const unknownColumns = columns.filter((c: string) => !validColumns.includes(c));
    if (unknownColumns.length > 0) {
      return NextResponse.json(
        { error: `Invalid columns: ${unknownColumns.join(", ")}` },
        { status: 400 },
      );
    }

    const setClauses = validColumns
      .map((c: string) => `"${c}" = ${escapeValue(body[c])}`)
      .join(", ");

    const updateQuery = `UPDATE public."${table}" SET ${setClauses} WHERE "${pkColumn}" = ${escapeValue(id)} RETURNING *`;

    const result: Row[] = await db.execute(sql.raw(updateQuery));

    if (result.length === 0) {
      return NextResponse.json(
        { error: "Row not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ row: result[0] });
  } catch (error) {
    logger.error({ err: error }, "[database/rows/update] Error");
    return NextResponse.json(
      { error: "Failed to update row" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ table: string; id: string }> },
) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const { table, id } = await params;

    if (!(await validateTableName(table))) {
      return NextResponse.json(
        { error: `Table "${table}" not found` },
        { status: 404 },
      );
    }

    const pkColumn = await getPrimaryKeyColumn(table);
    if (!pkColumn) {
      return NextResponse.json(
        { error: "Table has no primary key" },
        { status: 400 },
      );
    }

    const deleteQuery = `DELETE FROM public."${table}" WHERE "${pkColumn}" = ${escapeValue(id)} RETURNING *`;
    const result: Row[] = await db.execute(sql.raw(deleteQuery));

    if (result.length === 0) {
      return NextResponse.json(
        { error: "Row not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ deleted: true, row: result[0] });
  } catch (error) {
    logger.error({ err: error }, "[database/rows/delete] Error");
    return NextResponse.json(
      { error: "Failed to delete row" },
      { status: 500 },
    );
  }
}
