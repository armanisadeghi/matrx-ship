import { NextResponse } from "next/server";
import { validateTicketAuth } from "@/lib/auth/reporter-token";
import { getTriageBatch } from "@/lib/services/tickets";
import { logger } from "@/lib/logger";

/**
 * GET /api/tickets/triage-batch — Get a batch of untriaged tickets.
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
    const batchSize = url.searchParams.has("batch_size")
      ? Number(url.searchParams.get("batch_size"))
      : 3;

    const batch = await getTriageBatch(projectId, batchSize);
    return NextResponse.json({ batch, count: batch.length });
  } catch (err) {
    logger.error({ err }, "GET /api/tickets/triage-batch failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
