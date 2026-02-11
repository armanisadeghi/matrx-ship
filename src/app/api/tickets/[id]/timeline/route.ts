import { NextResponse } from "next/server";
import { validateTicketAuth } from "@/lib/auth/reporter-token";
import {
  getTicketById,
  getTicketTimeline,
  getTicketTimelineForUser,
  getTicketTimelineForAgent,
} from "@/lib/services/tickets";
import { logger } from "@/lib/logger";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/tickets/[id]/timeline — Full activity timeline.
 * ?format=agent returns agent-optimized text.
 * Reporter tokens only see user-visible entries.
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { auth, error } = await validateTicketAuth(request);
    if (error) return error;

    const { id } = await params;
    const url = new URL(request.url);
    const format = url.searchParams.get("format");

    // Reporter tokens: only user-visible timeline
    if (auth === "reporter") {
      const reporterId = url.searchParams.get("reporter_id");
      if (!reporterId) {
        return NextResponse.json(
          { error: "reporter_id required" },
          { status: 400 },
        );
      }
      const timeline = await getTicketTimelineForUser(id, reporterId);
      return NextResponse.json({ timeline });
    }

    // Agent-optimized text format
    if (format === "agent") {
      const text = await getTicketTimelineForAgent(id);
      return new Response(text, {
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Full timeline for admin/api
    const visibility = url.searchParams.get("visibility") as "internal" | "user_visible" | null;
    const activityTypes = url.searchParams.getAll("activity_type");

    const timeline = await getTicketTimeline(id, {
      visibility: visibility ?? undefined,
      activityTypes: activityTypes.length > 0 ? activityTypes : undefined,
    });

    const ticket = await getTicketById(id);
    return NextResponse.json({ ticket, timeline });
  } catch (err) {
    logger.error({ err }, "GET /api/tickets/[id]/timeline failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
