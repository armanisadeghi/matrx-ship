import { db } from "@/lib/db";
import { tickets } from "@/lib/db/schema";
import { eq, and, sql, isNull, inArray } from "drizzle-orm";

export interface TicketStats {
  total: number;
  open: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  byPriority: Record<string, number>;
  needingDecision: number;
  needingRework: number;
  followUpsDue: number;
  avgResolutionHours: number | null;
}

export interface PipelineCounts {
  untriaged: number;
  yourDecision: number;
  agentWorking: number;
  testing: number;
  userReview: number;
  done: number;
  followUps: number;
}

/**
 * Get comprehensive ticket statistics for a project.
 */
export async function getTicketStats(projectId?: string): Promise<TicketStats> {
  const baseConditions = [isNull(tickets.deletedAt)];
  if (projectId) baseConditions.push(eq(tickets.projectId, projectId));
  const baseWhere = and(...baseConditions);

  // Total count
  const [totalResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tickets)
    .where(baseWhere);

  // Open count (not closed/resolved)
  const [openResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tickets)
    .where(
      and(
        ...baseConditions,
        sql`${tickets.status} NOT IN ('closed', 'resolved')`,
      ),
    );

  // By status
  const statusCounts = await db
    .select({
      status: tickets.status,
      count: sql<number>`count(*)::int`,
    })
    .from(tickets)
    .where(baseWhere)
    .groupBy(tickets.status);

  // By type
  const typeCounts = await db
    .select({
      ticketType: tickets.ticketType,
      count: sql<number>`count(*)::int`,
    })
    .from(tickets)
    .where(baseWhere)
    .groupBy(tickets.ticketType);

  // By priority
  const priorityCounts = await db
    .select({
      priority: sql<string>`COALESCE(${tickets.priority}, 'unset')`,
      count: sql<number>`count(*)::int`,
    })
    .from(tickets)
    .where(baseWhere)
    .groupBy(sql`COALESCE(${tickets.priority}, 'unset')`);

  // Needing decision (triaged, waiting for admin)
  const [decisionResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tickets)
    .where(and(...baseConditions, eq(tickets.status, "triaged")));

  // Needing rework (failed/partial tests)
  const [reworkResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tickets)
    .where(
      and(
        ...baseConditions,
        inArray(tickets.testingResult, ["fail", "partial"]),
        inArray(tickets.status, ["in_progress", "in_review"]),
      ),
    );

  // Follow-ups due
  const [followUpResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tickets)
    .where(
      and(
        ...baseConditions,
        eq(tickets.needsFollowup, true),
        sql`${tickets.followupAfter} IS NULL OR ${tickets.followupAfter} <= NOW()`,
      ),
    );

  // Average resolution time (hours)
  const [avgResult] = await db
    .select({
      avgHours: sql<number | null>`AVG(EXTRACT(EPOCH FROM (${tickets.resolvedAt} - ${tickets.createdAt})) / 3600)::numeric(10,1)`,
    })
    .from(tickets)
    .where(
      and(
        ...baseConditions,
        sql`${tickets.resolvedAt} IS NOT NULL`,
      ),
    );

  return {
    total: totalResult?.count ?? 0,
    open: openResult?.count ?? 0,
    byStatus: Object.fromEntries(statusCounts.map((r) => [r.status, r.count])),
    byType: Object.fromEntries(typeCounts.map((r) => [r.ticketType, r.count])),
    byPriority: Object.fromEntries(priorityCounts.map((r) => [r.priority, r.count])),
    needingDecision: decisionResult?.count ?? 0,
    needingRework: reworkResult?.count ?? 0,
    followUpsDue: followUpResult?.count ?? 0,
    avgResolutionHours: avgResult?.avgHours ? Number(avgResult.avgHours) : null,
  };
}

/**
 * Get pipeline stage counts for the admin dashboard.
 */
export async function getPipelineCounts(projectId?: string): Promise<PipelineCounts> {
  const baseConditions = [isNull(tickets.deletedAt)];
  if (projectId) baseConditions.push(eq(tickets.projectId, projectId));

  const countFor = async (...extra: ReturnType<typeof eq>[]): Promise<number> => {
    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tickets)
      .where(and(...baseConditions, ...extra));
    return result?.count ?? 0;
  };

  const [untriaged, yourDecision, agentWorking, testing, userReview, done, followUps] =
    await Promise.all([
      countFor(eq(tickets.status, "new")),
      countFor(eq(tickets.status, "triaged")),
      countFor(inArray(tickets.status, ["approved", "in_progress"])),
      countFor(eq(tickets.status, "in_review")),
      countFor(eq(tickets.status, "user_review")),
      countFor(inArray(tickets.status, ["resolved", "closed"])),
      countFor(eq(tickets.needsFollowup, true)),
    ]);

  return { untriaged, yourDecision, agentWorking, testing, userReview, done, followUps };
}
