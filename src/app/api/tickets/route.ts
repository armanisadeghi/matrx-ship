import { NextResponse } from "next/server";
import { validateTicketAuth } from "@/lib/auth/reporter-token";
import {
  createTicket,
  listTickets,
  type ActorInfo,
} from "@/lib/services/tickets";
import { logger } from "@/lib/logger";

/**
 * GET /api/tickets — List tickets with filtering and pagination.
 */
export async function GET(request: Request) {
  try {
    const { auth, error } = await validateTicketAuth(request);
    if (error) return error;

    const url = new URL(request.url);
    const reporterId = url.searchParams.get("reporter_id") ?? undefined;

    // Reporter tokens can only see their own tickets
    if (auth === "reporter" && !reporterId) {
      return NextResponse.json(
        { error: "Reporter token requires reporter_id parameter" },
        { status: 400 },
      );
    }

    const result = await listTickets({
      projectId: url.searchParams.get("project_id") ?? undefined,
      status: url.searchParams.getAll("status"),
      ticketType: url.searchParams.getAll("type"),
      priority: url.searchParams.getAll("priority"),
      assignee: url.searchParams.get("assignee") ?? undefined,
      reporterId,
      needsFollowup: url.searchParams.has("needs_followup")
        ? url.searchParams.get("needs_followup") === "true"
        : undefined,
      search: url.searchParams.get("search") ?? undefined,
      sort: (url.searchParams.get("sort") as "created_at" | "updated_at" | "work_priority" | "ticket_number") ?? undefined,
      order: (url.searchParams.get("order") as "asc" | "desc") ?? undefined,
      page: url.searchParams.has("page") ? Number(url.searchParams.get("page")) : undefined,
      limit: url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined,
    });

    return NextResponse.json(result);
  } catch (err) {
    logger.error({ err }, "GET /api/tickets failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/tickets — Create a new ticket.
 */
export async function POST(request: Request) {
  try {
    const { auth, error } = await validateTicketAuth(request);
    if (error) return error;

    const body = await request.json();

    if (!body.title || !body.description || !body.ticket_type || !body.reporter_id) {
      return NextResponse.json(
        { error: "title, description, ticket_type, and reporter_id are required" },
        { status: 400 },
      );
    }

    const actor: ActorInfo = {
      type: auth === "reporter" ? "user" : "agent",
      name: body.reporter_name ?? body.reporter_id ?? "Unknown",
    };

    const ticket = await createTicket(
      {
        projectId: body.project_id ?? "default",
        source: body.source ?? (auth === "reporter" ? "portal" : "api"),
        ticketType: body.ticket_type,
        title: body.title,
        description: body.description,
        priority: body.priority,
        tags: body.tags,
        route: body.route,
        environment: body.environment,
        browserInfo: body.browser_info,
        osInfo: body.os_info,
        reporterId: body.reporter_id,
        reporterName: body.reporter_name,
        reporterEmail: body.reporter_email,
        parentId: body.parent_id,
        clientReferenceId: body.client_reference_id,
      },
      actor,
    );

    return NextResponse.json(ticket, { status: 201 });
  } catch (err) {
    logger.error({ err }, "POST /api/tickets failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
