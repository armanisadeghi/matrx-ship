import { NextResponse } from "next/server";
import { validateTicketAuth } from "@/lib/auth/reporter-token";
import { promoteToUserVisible, type ActorInfo } from "@/lib/services/tickets";
import { logger } from "@/lib/logger";

interface RouteParams {
  params: Promise<{ id: string; activityId: string }>;
}

/**
 * POST /api/tickets/[id]/activity/[activityId]/promote — Make internal entry user-visible.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { auth, error } = await validateTicketAuth(request);
    if (error) return error;

    if (auth === "reporter") {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const { activityId } = await params;
    const body = await request.json().catch(() => ({}));

    const actor: ActorInfo = {
      type: "admin",
      name: body.actor_name ?? "Admin",
    };

    const result = await promoteToUserVisible(activityId, actor);
    if (!result) {
      return NextResponse.json(
        { error: "Activity not found or already user-visible" },
        { status: 404 },
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    logger.error({ err }, "POST .../promote failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
