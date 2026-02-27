import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { customMcpTools } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "@/lib/logger";

/**
 * GET /api/admin/mcp-tools/:id
 * Get a single custom MCP tool.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const [tool] = await db
      .select()
      .from(customMcpTools)
      .where(eq(customMcpTools.id, id))
      .limit(1);

    if (!tool) {
      return NextResponse.json({ error: "Tool not found" }, { status: 404 });
    }

    return NextResponse.json({ tool });
  } catch (error) {
    logger.error({ err: error }, "[mcp-tools] Error fetching tool");
    return NextResponse.json(
      { error: "Failed to fetch tool" },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/admin/mcp-tools/:id
 * Update a custom MCP tool.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const updates: Record<string, unknown> = {};

    if (body.description !== undefined) updates.description = body.description;
    if (body.input_schema !== undefined) {
      updates.inputSchema = body.input_schema
        ? typeof body.input_schema === "string"
          ? body.input_schema
          : JSON.stringify(body.input_schema)
        : null;
    }
    if (body.sql_template !== undefined) updates.sqlTemplate = body.sql_template;
    if (body.target_database !== undefined) updates.targetDatabase = body.target_database;
    if (body.is_active !== undefined) updates.isActive = body.is_active;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 },
      );
    }

    updates.updatedAt = new Date();

    const [updated] = await db
      .update(customMcpTools)
      .set(updates)
      .where(eq(customMcpTools.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Tool not found" }, { status: 404 });
    }

    logger.info({ toolId: id }, "[mcp-tools] Updated custom tool");

    return NextResponse.json({ success: true, tool: updated });
  } catch (error) {
    logger.error({ err: error }, "[mcp-tools] Error updating tool");
    return NextResponse.json(
      { error: "Failed to update tool" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/admin/mcp-tools/:id
 * Delete a custom MCP tool.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const [deleted] = await db
      .delete(customMcpTools)
      .where(eq(customMcpTools.id, id))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: "Tool not found" }, { status: 404 });
    }

    logger.info(
      { toolId: id, toolName: deleted.toolName },
      "[mcp-tools] Deleted custom tool",
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, "[mcp-tools] Error deleting tool");
    return NextResponse.json(
      { error: "Failed to delete tool" },
      { status: 500 },
    );
  }
}
