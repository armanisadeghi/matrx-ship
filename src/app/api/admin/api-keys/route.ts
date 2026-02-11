import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { apiKeys } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { generateApiKey } from "@/lib/utils";
import { logger } from "@/lib/logger";

/**
 * GET /api/admin/api-keys
 * List all API keys (masked for security).
 */
export async function GET() {
  try {
    const keys = await db
      .select()
      .from(apiKeys)
      .orderBy(desc(apiKeys.createdAt));

    // Mask the keys for display
    const masked = keys.map((k) => ({
      ...k,
      key: `${k.key.substring(0, 12)}${"•".repeat(20)}`,
    }));

    return NextResponse.json({ keys: masked });
  } catch (error) {
    logger.error({ err: error }, "[api-keys] Failed to list keys");
    return NextResponse.json(
      { error: "Failed to list API keys" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/admin/api-keys
 * Create a new API key.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const label = body.label || "default";
    const key = generateApiKey();

    const [created] = await db
      .insert(apiKeys)
      .values({ key, label })
      .returning();

    // Return the full key ONCE (it won't be shown again)
    return NextResponse.json({ key: created }, { status: 201 });
  } catch (error) {
    logger.error({ err: error }, "[api-keys] Failed to create key");
    return NextResponse.json(
      { error: "Failed to create API key" },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/admin/api-keys
 * Toggle active status of a key.
 */
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, isActive } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const [updated] = await db
      .update(apiKeys)
      .set({ isActive: isActive ? 1 : 0 })
      .where(eq(apiKeys.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json({ key: updated });
  } catch (error) {
    logger.error({ err: error }, "[api-keys] Failed to update key");
    return NextResponse.json(
      { error: "Failed to update API key" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/admin/api-keys
 * Delete an API key.
 */
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const [deleted] = await db
      .delete(apiKeys)
      .where(eq(apiKeys.id, id))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    logger.error({ err: error }, "[api-keys] Failed to delete key");
    return NextResponse.json(
      { error: "Failed to delete API key" },
      { status: 500 },
    );
  }
}
