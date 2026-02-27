import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { customMcpTools } from "@/lib/db/schema";
import { logger } from "@/lib/logger";

/**
 * GET /api/admin/mcp-tools
 * List all custom MCP tools.
 */
export async function GET() {
  try {
    const tools = await db
      .select()
      .from(customMcpTools)
      .orderBy(customMcpTools.createdAt);

    return NextResponse.json({ tools });
  } catch (error) {
    logger.error({ err: error }, "[mcp-tools] Error listing tools");
    return NextResponse.json(
      { error: "Failed to list tools" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/admin/mcp-tools
 * Create a new custom MCP tool.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { tool_name, description, input_schema, sql_template, target_database } = body;

    if (!tool_name || !description || !sql_template) {
      return NextResponse.json(
        { error: "tool_name, description, and sql_template are required" },
        { status: 400 },
      );
    }

    // Validate tool name format (alphanumeric + underscores, starts with letter)
    if (!/^[a-z][a-z0-9_]*$/.test(tool_name)) {
      return NextResponse.json(
        { error: "Tool name must be lowercase, start with a letter, and contain only letters, numbers, and underscores" },
        { status: 400 },
      );
    }

    // Prevent collision with built-in tool names
    const builtinPrefixes = ["submit_ticket", "get_ticket", "triage_ticket", "set_decision", "add_comment", "resolve_ticket", "get_comments", "get_triage", "get_work", "get_rework", "db_"];
    if (builtinPrefixes.some((p) => tool_name.startsWith(p))) {
      return NextResponse.json(
        { error: "Tool name conflicts with built-in tools. Avoid names starting with 'db_' or ticket tool names." },
        { status: 400 },
      );
    }

    // Validate input_schema if provided (must be valid JSON)
    if (input_schema) {
      try {
        const parsed = typeof input_schema === "string" ? JSON.parse(input_schema) : input_schema;
        if (typeof parsed !== "object" || parsed === null) {
          throw new Error("Schema must be a JSON object");
        }
      } catch {
        return NextResponse.json(
          { error: "input_schema must be a valid JSON object" },
          { status: 400 },
        );
      }
    }

    const [created] = await db
      .insert(customMcpTools)
      .values({
        toolName: tool_name,
        description,
        inputSchema: input_schema
          ? typeof input_schema === "string"
            ? input_schema
            : JSON.stringify(input_schema)
          : null,
        sqlTemplate: sql_template,
        targetDatabase: target_database || "ship",
        isActive: true,
        createdBy: "admin",
      })
      .returning();

    logger.info({ toolName: tool_name }, "[mcp-tools] Created custom tool");

    return NextResponse.json({ success: true, tool: created }, { status: 201 });
  } catch (error) {
    logger.error({ err: error }, "[mcp-tools] Error creating tool");
    const message =
      error instanceof Error ? error.message : "Failed to create tool";

    // Handle unique constraint violation
    if (message.includes("unique") || message.includes("duplicate")) {
      return NextResponse.json(
        { error: `A tool named '${(await request.clone().json()).tool_name}' already exists` },
        { status: 409 },
      );
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
