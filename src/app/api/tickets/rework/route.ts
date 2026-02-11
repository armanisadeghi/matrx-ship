import { NextResponse } from "next/server";
import { validateTicketAuth } from "@/lib/auth/reporter-token";
import { getReworkItems } from "@/lib/services/tickets";
import { logger } from "@/lib/logger";

/**
 * GET /api/tickets/rework — Tickets with failed/partial test results.
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

    const items = await getReworkItems(projectId);
    return NextResponse.json({ items, count: items.length });
  } catch (err) {
    logger.error({ err }, "GET /api/tickets/rework failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
