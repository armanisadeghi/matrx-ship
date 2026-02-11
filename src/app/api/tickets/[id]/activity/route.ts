import { NextResponse } from "next/server";
import { validateTicketAuth } from "@/lib/auth/reporter-token";
import {
  addComment,
  sendMessage,
  submitTestResult,
  changeStatus,
  approveTicket,
  rejectTicket,
  resolveTicket,
  triageTicket,
  type ActorInfo,
} from "@/lib/services/tickets";
import { logger } from "@/lib/logger";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/tickets/[id]/activity — Add an activity entry.
 *
 * Body: { action, content, ...action-specific fields }
 * Actions: comment, message, test_result, change_status, approve, reject, resolve, triage
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { auth, error } = await validateTicketAuth(request);
    if (error) return error;

    const { id } = await params;
    const body = await request.json();

    const action = body.action;
    if (!action) {
      return NextResponse.json(
        { error: "action is required" },
        { status: 400 },
      );
    }

    const actor: ActorInfo = {
      type: body.actor_type ?? (auth === "reporter" ? "user" : "admin"),
      name: body.actor_name ?? "Unknown",
    };

    // Reporter tokens can only send messages
    if (auth === "reporter" && action !== "message") {
      return NextResponse.json(
        { error: "Reporter tokens can only send messages" },
        { status: 403 },
      );
    }

    switch (action) {
      case "comment": {
        if (!body.content) {
          return NextResponse.json({ error: "content is required" }, { status: 400 });
        }
        const result = await addComment(id, body.content, actor);
        return NextResponse.json(result, { status: 201 });
      }

      case "message": {
        if (!body.content) {
          return NextResponse.json({ error: "content is required" }, { status: 400 });
        }
        const result = await sendMessage(id, body.content, actor, body.requires_approval);
        return NextResponse.json(result, { status: 201 });
      }

      case "test_result": {
        if (!body.result) {
          return NextResponse.json({ error: "result is required (pass/fail/partial)" }, { status: 400 });
        }
        const result = await submitTestResult(id, body.result, {
          content: body.content,
          testingUrl: body.testing_url,
          testingInstructions: body.testing_instructions,
        }, actor);
        return NextResponse.json(result, { status: 201 });
      }

      case "change_status": {
        if (!body.status) {
          return NextResponse.json({ error: "status is required" }, { status: 400 });
        }
        const result = await changeStatus(id, body.status, actor, body.content);
        if (!result) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
        return NextResponse.json(result);
      }

      case "approve": {
        const result = await approveTicket(id, body.direction, body.work_priority, actor);
        if (!result) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
        return NextResponse.json(result);
      }

      case "reject": {
        if (!body.resolution || !body.reason) {
          return NextResponse.json({ error: "resolution and reason are required" }, { status: 400 });
        }
        const result = await rejectTicket(id, body.resolution, body.reason, actor);
        if (!result) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
        return NextResponse.json(result);
      }

      case "resolve": {
        if (!body.resolution_notes) {
          return NextResponse.json({ error: "resolution_notes is required" }, { status: 400 });
        }
        const result = await resolveTicket(id, {
          resolutionNotes: body.resolution_notes,
          testingInstructions: body.testing_instructions,
          testingUrl: body.testing_url,
        }, actor);
        if (!result) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
        return NextResponse.json(result);
      }

      case "triage": {
        const result = await triageTicket(id, {
          aiAssessment: body.ai_assessment,
          aiSolutionProposal: body.ai_solution_proposal,
          aiSuggestedPriority: body.ai_suggested_priority,
          aiComplexity: body.ai_complexity,
          aiEstimatedFiles: body.ai_estimated_files,
          autonomyScore: body.autonomy_score,
        }, actor);
        if (!result) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
        return NextResponse.json(result);
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 },
        );
    }
  } catch (err) {
    logger.error({ err }, "POST /api/tickets/[id]/activity failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
