import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appVersion } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/health
 * Health check endpoint for Coolify / container orchestration.
 * Returns the service status and current version.
 */
export async function GET() {
  try {
    const [latest] = await db
      .select({
        version: appVersion.version,
        buildNumber: appVersion.buildNumber,
      })
      .from(appVersion)
      .orderBy(desc(appVersion.buildNumber))
      .limit(1);

    return NextResponse.json({
      status: "ok",
      service: "matrx-ship",
      project: process.env.PROJECT_NAME || "unknown",
      version: latest?.version ?? "0.0.0",
      buildNumber: latest?.buildNumber ?? 0,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[health] Database check failed:", error);
    return NextResponse.json(
      {
        status: "error",
        service: "matrx-ship",
        error: "Database connection failed",
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
