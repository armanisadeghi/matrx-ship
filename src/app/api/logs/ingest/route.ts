import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { logs } from "@/lib/db/schema";
import { validateApiKey } from "@/lib/auth/api-key";

const MAX_BATCH_SIZE = 100;

interface LogEntry {
  level?: string;
  source?: string;
  environment?: string;
  message: string;
  metadata?: Record<string, unknown>;
  requestId?: string;
  traceId?: string;
  durationMs?: number;
  timestamp?: string;
}

/**
 * POST /api/logs/ingest
 * Batch insert log entries. Auth via API key.
 * Accepts: { entries: LogEntry[] }
 */
export async function POST(request: Request) {
  const authError = await validateApiKey(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const entries: LogEntry[] = body.entries || (body.message ? [body] : []);

    if (!Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json(
        { error: "entries must be a non-empty array of log entries" },
        { status: 400 },
      );
    }

    if (entries.length > MAX_BATCH_SIZE) {
      return NextResponse.json(
        { error: `Maximum ${MAX_BATCH_SIZE} entries per request` },
        { status: 400 },
      );
    }

    const validEntries = entries.filter((e) => e.message && typeof e.message === "string");

    if (validEntries.length === 0) {
      return NextResponse.json(
        { error: "No valid entries (each must have a 'message' string)" },
        { status: 400 },
      );
    }

    const rows = validEntries.map((entry) => ({
      level: entry.level || "info",
      source: entry.source || "external",
      environment: entry.environment || "production",
      message: entry.message,
      metadata: entry.metadata || null,
      requestId: entry.requestId || null,
      traceId: entry.traceId || null,
      durationMs: entry.durationMs || null,
      timestamp: entry.timestamp ? new Date(entry.timestamp) : new Date(),
    }));

    await db.insert(logs).values(rows);

    return NextResponse.json({
      inserted: rows.length,
      total: entries.length,
    });
  } catch (error) {
    logger.error({ err: error }, "[logs/ingest] Error");
    return NextResponse.json(
      { error: "Failed to ingest logs" },
      { status: 500 },
    );
  }
}
