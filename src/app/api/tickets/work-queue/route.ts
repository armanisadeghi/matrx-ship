import { NextResponse } from "next/server";
import { validateTicketAuth } from "@/lib/auth/reporter-token";
import { getWorkQueue } from "@/lib/services/tickets";
import { logger } from "@/lib/logger";

/**
 * GET /api/tickets/work-queue — Approved tickets ordered by work_priority.
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

    const queue = await getWorkQueue(projectId);
    return NextResponse.json({ queue, count: queue.length });
  } catch (err) {
    logger.error({ err }, "GET /api/tickets/work-queue failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
