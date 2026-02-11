import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { logs } from "@/lib/db/schema";
import { desc, eq, gte, lte, ilike, and, sql } from "drizzle-orm";

/**
 * GET /api/logs
 * Query logs with filters: level, source, environment, startTime, endTime, search, requestId.
 * Paginated, sorted by timestamp desc.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const level = searchParams.get("level");
    const source = searchParams.get("source");
    const environment = searchParams.get("environment");
    const startTime = searchParams.get("startTime");
    const endTime = searchParams.get("endTime");
    const search = searchParams.get("search");
    const requestId = searchParams.get("requestId");
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? 50)));
    const offset = (page - 1) * pageSize;

    // Build conditions
    const conditions = [];
    if (level) conditions.push(eq(logs.level, level));
    if (source) conditions.push(eq(logs.source, source));
    if (environment) conditions.push(eq(logs.environment, environment));
    if (startTime) conditions.push(gte(logs.timestamp, new Date(startTime)));
    if (endTime) conditions.push(lte(logs.timestamp, new Date(endTime)));
    if (search) conditions.push(ilike(logs.message, `%${search}%`));
    if (requestId) conditions.push(eq(logs.requestId, requestId));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, countResult] = await Promise.all([
      db
        .select()
        .from(logs)
        .where(where)
        .orderBy(desc(logs.timestamp))
        .limit(pageSize)
        .offset(offset),
      db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(logs)
        .where(where),
    ]);

    const total = countResult[0]?.count ?? 0;

    return NextResponse.json({
      logs: rows,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error) {
    logger.error({ err: error }, "[logs] Error");
    return NextResponse.json(
      { error: "Failed to fetch logs" },
      { status: 500 },
    );
  }
}
