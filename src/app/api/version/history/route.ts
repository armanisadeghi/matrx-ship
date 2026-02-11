import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { appVersion } from "@/lib/db/schema";
import { desc, count } from "drizzle-orm";
import { syncPendingDeployments } from "@/lib/services/vercel-sync";

export const dynamic = "force-dynamic";

/**
 * GET /api/version/history?limit=20&offset=0
 * Returns paginated version history.
 *
 * Before returning, syncs any pending/building records with Vercel
 * so the caller always receives accurate deployment status.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      Math.max(parseInt(searchParams.get("limit") || "20", 10), 1),
      100,
    );
    const offset = Math.max(
      parseInt(searchParams.get("offset") || "0", 10),
      0,
    );

    await syncPendingDeployments();

    // Total count
    const [totalResult] = await db
      .select({ count: count() })
      .from(appVersion);
    const total = totalResult.count;

    // Paginated versions
    const versions = await db
      .select()
      .from(appVersion)
      .orderBy(desc(appVersion.buildNumber))
      .limit(limit)
      .offset(offset);

    return NextResponse.json({
      versions,
      total,
      limit,
      offset,
    });
  } catch (error) {
    logger.error({ err: error }, "[api/version/history] Error");
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
