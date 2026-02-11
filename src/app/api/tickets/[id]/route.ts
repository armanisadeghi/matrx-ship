import { NextResponse } from "next/server";
import { validateTicketAuth } from "@/lib/auth/reporter-token";
import {
  getTicketById,
  updateTicket,
  deleteTicket,
  type ActorInfo,
} from "@/lib/services/tickets";
import { logger } from "@/lib/logger";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/tickets/[id] — Get a single ticket.
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { auth, error } = await validateTicketAuth(request);
    if (error) return error;

    const { id } = await params;
    const ticket = await getTicketById(id);
    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    // Reporter tokens can only see their own tickets
    if (auth === "reporter") {
      const url = new URL(request.url);
      const reporterId = url.searchParams.get("reporter_id");
      if (ticket.reporterId !== reporterId) {
        return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
      }
    }

    return NextResponse.json(ticket);
  } catch (err) {
    logger.error({ err }, "GET /api/tickets/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/tickets/[id] — Update ticket fields.
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { auth, error } = await validateTicketAuth(request);
    if (error) return error;

    // Reporter tokens cannot update tickets (only admins/agents)
    if (auth === "reporter") {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    const actor: ActorInfo = {
      type: body.actor_type ?? "admin",
      name: body.actor_name ?? "Admin",
    };

    // Map snake_case API fields to camelCase service fields
    const changes: Record<string, unknown> = {};
    const fieldMap: Record<string, string> = {
      title: "title",
      description: "description",
      ticket_type: "ticketType",
      priority: "priority",
      tags: "tags",
      route: "route",
      environment: "environment",
      assignee: "assignee",
      direction: "direction",
      ai_assessment: "aiAssessment",
      ai_solution_proposal: "aiSolutionProposal",
      ai_suggested_priority: "aiSuggestedPriority",
      ai_complexity: "aiComplexity",
      ai_estimated_files: "aiEstimatedFiles",
      autonomy_score: "autonomyScore",
      work_priority: "workPriority",
      testing_result: "testingResult",
      needs_followup: "needsFollowup",
      followup_notes: "followupNotes",
      followup_after: "followupAfter",
      resolution: "resolution",
      reporter_name: "reporterName",
      reporter_email: "reporterEmail",
    };

    for (const [apiField, serviceField] of Object.entries(fieldMap)) {
      if (apiField in body) {
        changes[serviceField] = body[apiField];
      }
    }

    const updated = await updateTicket(id, changes, actor);
    if (!updated) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (err) {
    logger.error({ err }, "PATCH /api/tickets/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/tickets/[id] — Soft-delete a ticket.
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const { auth, error } = await validateTicketAuth(request);
    if (error) return error;

    if (auth === "reporter") {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const { id } = await params;
    const actor: ActorInfo = { type: "admin", name: "Admin" };

    const deleted = await deleteTicket(id, actor);
    if (!deleted) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error({ err }, "DELETE /api/tickets/[id] failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
