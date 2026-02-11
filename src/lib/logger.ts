import pino from "pino";

const isDev = process.env.NODE_ENV === "development";

/**
 * Pino logger instance for structured logging.
 * - JSON output in production (for log aggregation)
 * - Pretty-printed in development
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? "debug" : "info"),
  ...(isDev && {
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss.l",
        ignore: "pid,hostname",
      },
    },
  }),
  base: {
    service: "matrx-ship",
    environment: process.env.NODE_ENV || "development",
    version: process.env.APP_VERSION || "0.1.0",
  },
});

/**
 * Create a child logger with request context.
 */
export function createRequestLogger(context: {
  requestId?: string;
  route?: string;
  method?: string;
}) {
  return logger.child(context);
}

/**
 * Log buffer for batched database insertion.
 * Collects logs and flushes to the database periodically.
 */
interface BufferedLog {
  level: string;
  source: string;
  environment: string;
  message: string;
  metadata: Record<string, unknown> | null;
  requestId: string | null;
  durationMs: number | null;
  timestamp: Date;
}

const LOG_BUFFER: BufferedLog[] = [];
const FLUSH_INTERVAL_MS = 5000;
const FLUSH_THRESHOLD = 50;
let flushTimer: NodeJS.Timeout | null = null;

/**
 * Queue a log entry for batched database insertion.
 */
export function queueLogForDB(entry: Omit<BufferedLog, "timestamp"> & { timestamp?: Date }) {
  LOG_BUFFER.push({
    ...entry,
    timestamp: entry.timestamp || new Date(),
  });

  if (LOG_BUFFER.length >= FLUSH_THRESHOLD) {
    flushLogs();
  }

  if (!flushTimer) {
    flushTimer = setInterval(flushLogs, FLUSH_INTERVAL_MS);
  }
}

/**
 * Flush buffered logs to the database.
 */
async function flushLogs() {
  if (LOG_BUFFER.length === 0) return;

  const batch = LOG_BUFFER.splice(0, LOG_BUFFER.length);

  try {
    // Dynamic import to avoid circular dependency
    const { db } = await import("@/lib/db");
    const { logs } = await import("@/lib/db/schema");

    await db.insert(logs).values(
      batch.map((entry) => ({
        level: entry.level,
        source: entry.source,
        environment: entry.environment,
        message: entry.message,
        metadata: entry.metadata,
        requestId: entry.requestId,
        durationMs: entry.durationMs,
        timestamp: entry.timestamp,
      })),
    );
  } catch (error) {
    // Put entries back on failure (with limit to prevent infinite growth)
    if (LOG_BUFFER.length < 500) {
      LOG_BUFFER.unshift(...batch);
    }
    // Use console here since the logger itself might be broken
    console.error("[logger] Failed to flush logs to database:", error);
  }
}

/**
 * Helper to log and queue in one call.
 */
export function shipLog(
  level: "info" | "warn" | "error" | "debug" | "fatal",
  message: string,
  extra?: {
    source?: string;
    metadata?: Record<string, unknown>;
    requestId?: string;
    durationMs?: number;
  },
) {
  // Log to stdout via pino
  logger[level]({ ...extra?.metadata, source: extra?.source }, message);

  // Queue for database
  queueLogForDB({
    level,
    source: extra?.source || "app",
    environment: process.env.NODE_ENV || "production",
    message,
    metadata: extra?.metadata || null,
    requestId: extra?.requestId || null,
    durationMs: extra?.durationMs || null,
  });
}
