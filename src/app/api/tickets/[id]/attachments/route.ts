import { NextResponse } from "next/server";
import { validateTicketAuth } from "@/lib/auth/reporter-token";
import {
  getAttachments,
  uploadAttachment,
  type ActorInfo,
} from "@/lib/services/tickets";
import { logger } from "@/lib/logger";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/tickets/[id]/attachments — List all attachments for a ticket.
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { error } = await validateTicketAuth(request);
    if (error) return error;

    const { id } = await params;
    const attachments = await getAttachments(id);
    return NextResponse.json({ attachments });
  } catch (err) {
    logger.error({ err }, "GET .../attachments failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/tickets/[id]/attachments — Upload a file attachment.
 * Expects multipart/form-data with a "file" field.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { error } = await validateTicketAuth(request);
    if (error) return error;

    const { id } = await params;

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "file field is required" },
        { status: 400 },
      );
    }

    // Limit file size (10MB)
    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "File too large (max 10MB)" },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const uploaderName = formData.get("uploader_name") as string | null;
    const uploaderType = (formData.get("uploader_type") as string | null) ?? "user";

    const actor: ActorInfo = {
      type: uploaderType as ActorInfo["type"],
      name: uploaderName ?? "Unknown",
    };

    const attachment = await uploadAttachment(
      id,
      {
        buffer,
        originalName: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
      },
      actor,
    );

    return NextResponse.json(attachment, { status: 201 });
  } catch (err) {
    logger.error({ err }, "POST .../attachments failed");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
