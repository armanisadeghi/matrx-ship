import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sql } from "drizzle-orm";

type Row = Record<string, unknown>;

/**
 * GET /api/logs/database
 * Query pg_stat_statements (slow queries) and pg_stat_activity (active connections).
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "activity";

    if (type === "statements") {
      // Try to get slow queries from pg_stat_statements
      try {
        const result: Row[] = await db.execute(sql`
          SELECT
            query,
            calls,
            total_exec_time::numeric(10,2) AS total_time_ms,
            mean_exec_time::numeric(10,2) AS mean_time_ms,
            rows
          FROM pg_stat_statements
          WHERE query NOT LIKE '%pg_stat%'
          ORDER BY mean_exec_time DESC
          LIMIT 20
        `);
        return NextResponse.json({ statements: result });
      } catch {
        return NextResponse.json({
          statements: [],
          note: "pg_stat_statements extension is not enabled",
        });
      }
    }

    // Active connections
    const activity: Row[] = await db.execute(sql`
      SELECT
        pid,
        usename,
        application_name,
        state,
        query_start,
        state_change,
        LEFT(query, 200) AS query
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid != pg_backend_pid()
      ORDER BY query_start DESC NULLS LAST
      LIMIT 20
    `);

    return NextResponse.json({ activity });
  } catch (error) {
    logger.error({ err: error }, "[logs/database] Error");
    return NextResponse.json(
      { error: "Failed to fetch database logs" },
      { status: 500 },
    );
  }
}
