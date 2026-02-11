import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appVersion } from "@/lib/db/schema";
import { gte, count, sum } from "drizzle-orm";

export const dynamic = "force-dynamic";

interface PeriodStats {
  deployments: number;
  linesAdded: number;
  linesDeleted: number;
  filesChanged: number;
}

/**
 * GET /api/version/stats
 * Returns deployment statistics for last 24 hours, week, and month.
 */
export async function GET() {
  try {
    const now = new Date();
    const twentyFourHoursAgo = new Date(
      now.getTime() - 24 * 60 * 60 * 1000,
    );
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Helper: get stats for a time period
    async function getStatsForPeriod(since: Date): Promise<PeriodStats> {
      const [result] = await db
        .select({
          deployments: count(),
          linesAdded: sum(appVersion.linesAdded),
          linesDeleted: sum(appVersion.linesDeleted),
          filesChanged: sum(appVersion.filesChanged),
        })
        .from(appVersion)
        .where(gte(appVersion.deployedAt, since));

      return {
        deployments: result.deployments,
        linesAdded: Number(result.linesAdded) || 0,
        linesDeleted: Number(result.linesDeleted) || 0,
        filesChanged: Number(result.filesChanged) || 0,
      };
    }

    const [today, week, month] = await Promise.all([
      getStatsForPeriod(twentyFourHoursAgo),
      getStatsForPeriod(oneWeekAgo),
      getStatsForPeriod(oneMonthAgo),
    ]);

    // Total count
    const [totalResult] = await db
      .select({ count: count() })
      .from(appVersion);

    // Average time between deployments (using week data)
    let averageTimeBetweenDeployments = "N/A";
    if (week.deployments > 1) {
      const weekVersions = await db
        .select({ deployedAt: appVersion.deployedAt })
        .from(appVersion)
        .where(gte(appVersion.deployedAt, oneWeekAgo))
        .orderBy(appVersion.deployedAt);

      const times = weekVersions.map((v) => v.deployedAt.getTime());
      let totalDiff = 0;
      for (let i = 1; i < times.length; i++) {
        totalDiff += times[i] - times[i - 1];
      }
      const avgDiffMs = totalDiff / (times.length - 1);
      const avgDiffMinutes = avgDiffMs / (1000 * 60);
      const avgDiffHours = avgDiffMs / (1000 * 60 * 60);

      if (avgDiffMinutes < 60) {
        averageTimeBetweenDeployments = `${Math.round(avgDiffMinutes)}m`;
      } else if (avgDiffHours < 24) {
        averageTimeBetweenDeployments = `${Math.round(avgDiffHours)}h`;
      } else {
        averageTimeBetweenDeployments = `${Math.round(avgDiffHours / 24)}d`;
      }
    }

    return NextResponse.json({
      today,
      week,
      month,
      averageTimeBetweenDeployments,
      totalDeployments: totalResult.count,
    });
  } catch (error) {
    console.error("[api/version/stats] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
