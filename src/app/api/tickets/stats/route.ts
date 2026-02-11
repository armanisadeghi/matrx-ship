import { NextResponse } from "next/server";
import { validateTicketAuth } from "@/lib/auth/reporter-token";
import { getTicketStats, getPipelineCounts } from "@/lib/services/ticket-stats";
import { logger } from "@/lib/logger";

/**
 * GET /api/tickets/stats — Dashboard statistics.
 */
export async function GET(request: Request) {
  try {
    const { auth, error } = await validateTicketAuth(request);
    if (error) return error;

    if (auth === "reporter") {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const url = new URL(request.url);
    const projectId = url.searchParams.get("project_id") ?? undefined;

    const [stats, pipeline] = await Promise.all([
      getTicketStats(projectId),
      getPipelineCounts(projectId),
    ]);

    return NextResponse.json({ stats, pipeline });
  } catch (err) {
    logger.error({ err }, "GET /api/tickets/stats failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
