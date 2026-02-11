import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sql } from "drizzle-orm";

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

async function getPrimaryKeyColumn(table: string): Promise<string | null> {
  const result: Row[] = await db.execute(sql`
    SELECT kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema = 'public'
      AND tc.table_name = ${table}
    LIMIT 1
  `);
  return result.length > 0 ? String(result[0].column_name) : null;
}

function escapeValue(val: unknown): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "number") return String(val);
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  return `'${String(val).replace(/'/g, "''")}'`;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ table: string; id: string }> },
) {
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
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${table}
        AND column_name = ANY(${columns})
    `);
    const validColumns = colCheck.map((r: Row) => String(r.column_name));

    if (validColumns.length === 0) {
      return NextResponse.json(
        { error: "No valid columns to update" },
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
  _request: Request,
  { params }: { params: Promise<{ table: string; id: string }> },
) {
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
