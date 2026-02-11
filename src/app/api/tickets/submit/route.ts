import { NextResponse } from "next/server";
import { validateReporterToken } from "@/lib/auth/reporter-token";
import { createTicket, type ActorInfo } from "@/lib/services/tickets";
import { logger } from "@/lib/logger";

/**
 * POST /api/tickets/submit — Public submission endpoint via reporter token.
 * Simplified interface for SDK/portal submissions.
 */
export async function POST(request: Request) {
  try {
    const authError = validateReporterToken(request);
    if (authError) return authError;

    const body = await request.json();

    if (!body.title || !body.description) {
      return NextResponse.json(
        { error: "title and description are required" },
        { status: 400 },
      );
    }

    const actor: ActorInfo = {
      type: "user",
      name: body.reporter_name ?? body.reporter_email ?? "Anonymous",
    };

    const ticket = await createTicket(
      {
        projectId: body.project_id ?? "default",
        source: body.source ?? "portal",
        ticketType: body.ticket_type ?? "bug",
        title: body.title,
        description: body.description,
        priority: body.priority,
        tags: body.tags,
        route: body.route,
        environment: body.environment,
        browserInfo: body.browser_info,
        osInfo: body.os_info,
        reporterId: body.reporter_id ?? body.reporter_email ?? `anon-${Date.now()}`,
        reporterName: body.reporter_name,
        reporterEmail: body.reporter_email,
        clientReferenceId: body.client_reference_id,
      },
      actor,
    );

    // Return limited info — don't expose internal fields to public
    return NextResponse.json(
      {
        id: ticket.id,
        ticket_number: ticket.ticketNumber,
        title: ticket.title,
        status: ticket.status,
        created_at: ticket.createdAt,
      },
      { status: 201 },
    );
  } catch (err) {
    logger.error({ err }, "POST /api/tickets/submit failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
