import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sql } from "drizzle-orm";

type Row = Record<string, unknown>;

const QUERY_TIMEOUT_MS = 5000;

// Dangerous statements that should never be allowed
const DANGEROUS_PATTERNS = [
  /\bDROP\s+DATABASE\b/i,
  /\bDROP\s+SCHEMA\b/i,
  /\bTRUNCATE\b/i,
];

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { query: userQuery } = body;

    if (!userQuery || typeof userQuery !== "string") {
      return NextResponse.json(
        { error: "Query is required and must be a string" },
        { status: 400 },
      );
    }

    const trimmed = userQuery.trim();
    if (!trimmed) {
      return NextResponse.json(
        { error: "Query cannot be empty" },
        { status: 400 },
      );
    }

    // Check for dangerous patterns
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(trimmed)) {
        return NextResponse.json(
          { error: "This query type is not allowed for safety reasons" },
          { status: 403 },
        );
      }
    }

    // Set statement timeout for this session
    await db.execute(sql.raw(`SET statement_timeout = '${QUERY_TIMEOUT_MS}'`));

    const startTime = Date.now();
    const result: Row[] = await db.execute(sql.raw(trimmed));
    const duration = Date.now() - startTime;

    // Reset timeout
    await db.execute(sql.raw(`RESET statement_timeout`));

    return NextResponse.json({
      rows: result,
      rowCount: result.length,
      fields: result.length > 0
        ? Object.keys(result[0]).map((name) => ({ name }))
        : [],
      duration,
    });
  } catch (error) {
    // Reset timeout on error too
    try {
      await db.execute(sql.raw(`RESET statement_timeout`));
    } catch {
      // Ignore reset errors
    }

    const message = error instanceof Error ? error.message : "Query execution failed";
    logger.error({ err: error }, "[database/query] Error");

    return NextResponse.json(
      { error: message },
      { status: 400 },
    );
  }
}
