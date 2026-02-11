import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sql } from "drizzle-orm";

type Row = Record<string, unknown>;

// Whitelist only public schema tables, prevent SQL injection on table name
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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ table: string }> },
) {
  try {
    const { table } = await params;

    if (!(await validateTableName(table))) {
      return NextResponse.json(
        { error: `Table "${table}" not found` },
        { status: 404 },
      );
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? 50)));
    const sortBy = searchParams.get("sortBy");
    const sortOrder = searchParams.get("sortOrder") === "asc" ? "ASC" : "DESC";
    const offset = (page - 1) * pageSize;

    // Get total count
    const countResult: Row[] = await db.execute(
      sql.raw(`SELECT COUNT(*)::int AS total FROM public."${table}"`)
    );
    const total = Number(countResult[0]?.total ?? 0);

    // Build query with optional sorting
    let query = `SELECT * FROM public."${table}"`;
    if (sortBy) {
      // Validate column exists
      const colCheck: Row[] = await db.execute(sql`
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ${table}
          AND column_name = ${sortBy}
        LIMIT 1
      `);
      if (colCheck.length > 0) {
        query += ` ORDER BY "${sortBy}" ${sortOrder}`;
      }
    } else {
      // Default: try to sort by created_at desc, fallback to no order
      const hasCreatedAt: Row[] = await db.execute(sql`
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ${table}
          AND column_name = 'created_at'
        LIMIT 1
      `);
      if (hasCreatedAt.length > 0) {
        query += ` ORDER BY "created_at" DESC`;
      }
    }

    query += ` LIMIT ${pageSize} OFFSET ${offset}`;

    const result: Row[] = await db.execute(sql.raw(query));

    return NextResponse.json({
      rows: result,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error) {
    logger.error({ err: error }, "[database/rows] Error");
    return NextResponse.json(
      { error: "Failed to fetch rows" },
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ table: string }> },
) {
  try {
    const { table } = await params;

    if (!(await validateTableName(table))) {
      return NextResponse.json(
        { error: `Table "${table}" not found` },
        { status: 404 },
      );
    }

    const body = await request.json();

    if (!body || typeof body !== "object" || Object.keys(body).length === 0) {
      return NextResponse.json(
        { error: "Request body must be a non-empty object" },
        { status: 400 },
      );
    }

    // Validate columns exist
    const columns = Object.keys(body);
    const colCheck: Row[] = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${table}
        AND column_name = ANY(${columns})
    `);

    const validColumns = colCheck.map((r: Row) => String(r.column_name));
    const invalidColumns = columns.filter((c: string) => !validColumns.includes(c));

    if (invalidColumns.length > 0) {
      return NextResponse.json(
        { error: `Invalid columns: ${invalidColumns.join(", ")}` },
        { status: 400 },
      );
    }

    // Build parameterized INSERT
    const colNames = validColumns.map((c: string) => `"${c}"`).join(", ");
    const values = validColumns.map((c: string) => body[c]);
    const placeholders = validColumns.map((_: string, i: number) => `$${i + 1}`).join(", ");

    const insertQuery = `INSERT INTO public."${table}" (${colNames}) VALUES (${placeholders}) RETURNING *`;

    // Use sql template with dynamic values
    let q = sql.raw(insertQuery);
    // For parameterized queries, we need to use sql template tag
    // Build it properly with the sql helper
    const parts: string[] = [];
    parts.push(`INSERT INTO public."${table}" (${colNames}) VALUES (`);

    // Since sql.raw doesn't support params in postgres.js drizzle, use sql template
    const insertSql = sql`SELECT 1`; // placeholder - use raw approach below
    void insertSql; // unused

    // Use a manual approach with sql template
    let rawSql = `INSERT INTO public."${table}" (${colNames}) VALUES (`;
    rawSql += validColumns.map((_: string, i: number) => `$${i + 1}`).join(", ");
    rawSql += `) RETURNING *`;

    // postgres.js via drizzle doesn't support params on sql.raw
    // So we build the query with escaped values inline (safe since we validated columns)
    const escapedValues = validColumns.map((c: string) => {
      const val = body[c];
      if (val === null || val === undefined) return "NULL";
      if (typeof val === "number") return String(val);
      if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
      // Escape single quotes
      return `'${String(val).replace(/'/g, "''")}'`;
    });

    const finalQuery = `INSERT INTO public."${table}" (${colNames}) VALUES (${escapedValues.join(", ")}) RETURNING *`;
    const result: Row[] = await db.execute(sql.raw(finalQuery));

    return NextResponse.json({ row: result[0] }, { status: 201 });
  } catch (error) {
    logger.error({ err: error }, "[database/rows/insert] Error");
    return NextResponse.json(
      { error: "Failed to insert row" },
      { status: 500 },
    );
  }
}
