import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import {
  createTicket,
  getTicketById,
  getTicketTimelineForAgent,
  getTicketTimeline,
  getTriageBatch,
  getWorkQueue,
  getReworkItems,
  triageTicket,
  approveTicket,
  rejectTicket,
  addComment,
  resolveTicket,
  type ActorInfo,
} from "@/lib/services/tickets";
import * as multiDb from "@/lib/db/multi-db";
import { db } from "@/lib/db";
import { customMcpTools } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "@/lib/logger";

// ─── Auth validation ────────────────────────────
function validateAuth(request: Request): boolean {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;

  const token = authHeader.slice(7);
  const apiKey = process.env.MATRX_SHIP_API_KEY;
  if (apiKey && token === apiKey) return true;

  const adminSecret = process.env.MATRX_SHIP_ADMIN_SECRET;
  if (adminSecret && token === adminSecret) return true;

  return false;
}

// ─── Create the MCP Server ─────────────────────
async function createMcpServer(): Promise<McpServer> {
  const server = new McpServer({
    name: "Matrx Ship Tickets",
    version: "1.0.0",
  });

  // --- submit_ticket ---
  server.tool(
    "submit_ticket",
    "Submit a new ticket (bug, feature, suggestion, task, enhancement)",
    {
      title: z.string().describe("Short summary of the ticket"),
      description: z.string().describe("Full details"),
      ticket_type: z.enum(["bug", "feature", "suggestion", "task", "enhancement"]).describe("Type of ticket"),
      project_id: z.string().optional().describe("Project identifier (default: 'default')"),
      priority: z.enum(["low", "medium", "high", "critical"]).optional().describe("Priority level"),
      route: z.string().optional().describe("Route, file path, or component"),
      reporter_id: z.string().optional().describe("Reporter identifier"),
      reporter_name: z.string().optional().describe("Reporter display name"),
      client_reference_id: z.string().optional().describe("Client-generated ID for idempotent creation"),
    },
    async (params) => {
      const actor: ActorInfo = { type: "agent", name: params.reporter_name ?? "MCP Agent" };
      const ticket = await createTicket({
        projectId: params.project_id ?? "default",
        source: "mcp",
        ticketType: params.ticket_type,
        title: params.title,
        description: params.description,
        priority: params.priority,
        route: params.route,
        reporterId: params.reporter_id ?? "mcp-agent",
        reporterName: params.reporter_name,
        clientReferenceId: params.client_reference_id,
      }, actor);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            id: ticket.id,
            ticket_number: ticket.ticketNumber,
            title: ticket.title,
            status: ticket.status,
          }),
        }],
      };
    },
  );

  // --- get_ticket ---
  server.tool(
    "get_ticket",
    "Get a ticket by ID",
    {
      ticket_id: z.string().describe("The UUID of the ticket"),
    },
    async (params) => {
      const ticket = await getTicketById(params.ticket_id);
      if (!ticket) {
        return { content: [{ type: "text" as const, text: "Ticket not found." }] };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(ticket) }] };
    },
  );

  // --- get_ticket_timeline ---
  server.tool(
    "get_ticket_timeline",
    "Get the full chronological activity timeline for a ticket (agent-optimized narrative format)",
    {
      ticket_id: z.string().describe("The UUID of the ticket"),
    },
    async (params) => {
      const text = await getTicketTimelineForAgent(params.ticket_id);
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // --- get_triage_batch ---
  server.tool(
    "get_triage_batch",
    "Get a batch of untriaged tickets ready for AI triage",
    {
      batch_size: z.number().optional().describe("Number of tickets (default 3)"),
      project_id: z.string().optional().describe("Filter by project"),
    },
    async (params) => {
      const batch = await getTriageBatch(params.project_id, params.batch_size ?? 3);
      return { content: [{ type: "text" as const, text: JSON.stringify({ batch, count: batch.length }) }] };
    },
  );

  // --- get_work_queue ---
  server.tool(
    "get_work_queue",
    "Get approved tickets ordered by work priority",
    {
      project_id: z.string().optional().describe("Filter by project"),
    },
    async (params) => {
      const queue = await getWorkQueue(params.project_id);
      return { content: [{ type: "text" as const, text: JSON.stringify({ queue, count: queue.length }) }] };
    },
  );

  // --- get_rework_items ---
  server.tool(
    "get_rework_items",
    "Get tickets with failed/partial test results that need rework",
    {
      project_id: z.string().optional().describe("Filter by project"),
    },
    async (params) => {
      const items = await getReworkItems(params.project_id);
      return { content: [{ type: "text" as const, text: JSON.stringify({ items, count: items.length }) }] };
    },
  );

  // --- triage_ticket ---
  server.tool(
    "triage_ticket",
    "Push AI triage analysis to a ticket (sets status to 'triaged')",
    {
      ticket_id: z.string().describe("Ticket UUID"),
      ai_assessment: z.string().optional().describe("Full assessment and analysis"),
      ai_solution_proposal: z.string().optional().describe("Proposed fix approach"),
      ai_suggested_priority: z.enum(["low", "medium", "high", "critical"]).optional().describe("Suggested priority"),
      ai_complexity: z.enum(["simple", "moderate", "complex"]).optional().describe("Estimated complexity"),
      ai_estimated_files: z.array(z.string()).optional().describe("Files that likely need changes"),
      autonomy_score: z.number().min(1).max(5).optional().describe("Confidence for auto-approval (1-5)"),
    },
    async (params) => {
      const actor: ActorInfo = { type: "agent", name: "MCP Agent" };
      const ticket = await triageTicket(params.ticket_id, {
        aiAssessment: params.ai_assessment,
        aiSolutionProposal: params.ai_solution_proposal,
        aiSuggestedPriority: params.ai_suggested_priority,
        aiComplexity: params.ai_complexity,
        aiEstimatedFiles: params.ai_estimated_files,
        autonomyScore: params.autonomy_score,
      }, actor);

      if (!ticket) {
        return { content: [{ type: "text" as const, text: "Ticket not found." }] };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, ticket_number: ticket.ticketNumber, status: ticket.status }) }] };
    },
  );

  // --- set_decision ---
  server.tool(
    "set_decision",
    "Set admin decision on a triaged ticket (approve/reject/defer)",
    {
      ticket_id: z.string().describe("Ticket UUID"),
      decision: z.enum(["approved", "rejected", "deferred"]).describe("Decision"),
      direction: z.string().optional().describe("Instructions for the developer/agent"),
      work_priority: z.number().optional().describe("Work queue priority (1 = highest)"),
      resolution: z.string().optional().describe("Resolution reason (required for reject)"),
      reason: z.string().optional().describe("Explanation (required for reject)"),
    },
    async (params) => {
      const actor: ActorInfo = { type: "admin", name: "MCP Admin" };

      if (params.decision === "approved") {
        const ticket = await approveTicket(params.ticket_id, params.direction, params.work_priority, actor);
        if (!ticket) return { content: [{ type: "text" as const, text: "Ticket not found." }] };
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, status: ticket.status }) }] };
      }

      if (params.decision === "rejected") {
        const resolution = params.resolution ?? "wont_fix";
        const reason = params.reason ?? "Rejected";
        const ticket = await rejectTicket(params.ticket_id, resolution, reason, actor);
        if (!ticket) return { content: [{ type: "text" as const, text: "Ticket not found." }] };
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, status: ticket.status, resolution }) }] };
      }

      // deferred
      const ticket = await rejectTicket(params.ticket_id, "deferred", params.reason ?? "Deferred", actor);
      if (!ticket) return { content: [{ type: "text" as const, text: "Ticket not found." }] };
      return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, status: ticket.status, resolution: "deferred" }) }] };
    },
  );

  // --- add_comment ---
  server.tool(
    "add_comment",
    "Add an internal comment to a ticket",
    {
      ticket_id: z.string().describe("Ticket UUID"),
      content: z.string().describe("Comment text"),
      author_name: z.string().optional().describe("Author display name"),
    },
    async (params) => {
      const actor: ActorInfo = { type: "agent", name: params.author_name ?? "MCP Agent" };
      const activity = await addComment(params.ticket_id, params.content, actor);
      return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, activity_id: activity.id }) }] };
    },
  );

  // --- resolve_ticket ---
  server.tool(
    "resolve_ticket",
    "Submit a fix for testing (changes status to in_review)",
    {
      ticket_id: z.string().describe("Ticket UUID"),
      resolution_notes: z.string().describe("Description of what was fixed"),
      testing_instructions: z.string().optional().describe("How to test the fix"),
      testing_url: z.string().optional().describe("URL where fix can be tested"),
    },
    async (params) => {
      const actor: ActorInfo = { type: "agent", name: "MCP Agent" };
      const ticket = await resolveTicket(params.ticket_id, {
        resolutionNotes: params.resolution_notes,
        testingInstructions: params.testing_instructions,
        testingUrl: params.testing_url,
      }, actor);

      if (!ticket) return { content: [{ type: "text" as const, text: "Ticket not found." }] };
      return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, status: ticket.status }) }] };
    },
  );

  // --- get_comments ---
  server.tool(
    "get_comments",
    "Get all comments for a ticket",
    {
      ticket_id: z.string().describe("Ticket UUID"),
    },
    async (params) => {
      const timeline = await getTicketTimeline(params.ticket_id, {
        activityTypes: ["comment"],
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(timeline) }] };
    },
  );

  // ─── Database Management Tools ──────────────────

  server.tool(
    "db_list_databases",
    "List all databases in this instance",
    {},
    async () => {
      const databases = await multiDb.listDatabases();
      return { content: [{ type: "text" as const, text: JSON.stringify({ databases, count: databases.length }) }] };
    },
  );

  server.tool(
    "db_list_tables",
    "List all tables in a database with row counts and sizes",
    {
      database: z.string().optional().describe("Database name (default: 'ship')"),
    },
    async (params) => {
      const tables = await multiDb.listTables(params.database ?? "ship");
      return { content: [{ type: "text" as const, text: JSON.stringify({ tables, count: tables.length }) }] };
    },
  );

  server.tool(
    "db_describe_table",
    "Get column names, types, and constraints for a table",
    {
      table: z.string().describe("Table name"),
      database: z.string().optional().describe("Database name (default: 'ship')"),
    },
    async (params) => {
      const columns = await multiDb.describeTable(params.database ?? "ship", params.table);
      return { content: [{ type: "text" as const, text: JSON.stringify({ table: params.table, columns }) }] };
    },
  );

  server.tool(
    "db_read_rows",
    "Read rows from a table with pagination and sorting",
    {
      table: z.string().describe("Table name"),
      database: z.string().optional().describe("Database name (default: 'ship')"),
      limit: z.number().optional().describe("Max rows to return (default: 100, max: 500)"),
      offset: z.number().optional().describe("Skip this many rows"),
      order_by: z.string().optional().describe("Column to sort by"),
      order_dir: z.enum(["asc", "desc"]).optional().describe("Sort direction"),
    },
    async (params) => {
      const result = await multiDb.readRows(params.database ?? "ship", params.table, {
        limit: params.limit,
        offset: params.offset,
        orderBy: params.order_by,
        orderDir: params.order_dir,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    },
  );

  server.tool(
    "db_insert_row",
    "Insert a new row into a table",
    {
      table: z.string().describe("Table name"),
      data: z.record(z.string(), z.unknown()).describe("Column-value pairs to insert"),
      database: z.string().optional().describe("Database name (default: 'ship')"),
    },
    async (params) => {
      const row = await multiDb.insertRow(params.database ?? "ship", params.table, params.data);
      return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, row }) }] };
    },
  );

  server.tool(
    "db_update_row",
    "Update a row by its primary key",
    {
      table: z.string().describe("Table name"),
      pk_column: z.string().describe("Primary key column name"),
      pk_value: z.string().describe("Primary key value"),
      data: z.record(z.string(), z.unknown()).describe("Column-value pairs to update"),
      database: z.string().optional().describe("Database name (default: 'ship')"),
    },
    async (params) => {
      const row = await multiDb.updateRow(params.database ?? "ship", params.table, params.pk_column, params.pk_value, params.data);
      if (!row) return { content: [{ type: "text" as const, text: "Row not found." }] };
      return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, row }) }] };
    },
  );

  server.tool(
    "db_delete_row",
    "Delete a row by its primary key",
    {
      table: z.string().describe("Table name"),
      pk_column: z.string().describe("Primary key column name"),
      pk_value: z.string().describe("Primary key value"),
      database: z.string().optional().describe("Database name (default: 'ship')"),
    },
    async (params) => {
      const deleted = await multiDb.deleteRow(params.database ?? "ship", params.table, params.pk_column, params.pk_value);
      return { content: [{ type: "text" as const, text: JSON.stringify({ success: deleted }) }] };
    },
  );

  server.tool(
    "db_search",
    "Search across all text columns in a table",
    {
      table: z.string().describe("Table name"),
      query: z.string().describe("Search term (case-insensitive)"),
      database: z.string().optional().describe("Database name (default: 'ship')"),
      limit: z.number().optional().describe("Max results (default: 50)"),
    },
    async (params) => {
      const rows = await multiDb.searchTable(params.database ?? "ship", params.table, params.query, params.limit);
      return { content: [{ type: "text" as const, text: JSON.stringify({ results: rows, count: rows.length }) }] };
    },
  );

  server.tool(
    "db_execute_sql",
    "Execute a raw SQL query against a database (use with care)",
    {
      sql: z.string().describe("SQL query to execute"),
      database: z.string().optional().describe("Database name (default: 'ship')"),
    },
    async (params) => {
      const result = await multiDb.executeQuery(params.database ?? "ship", params.sql);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    },
  );

  // ─── Custom MCP Tools (Dynamic) ───────────────

  // Load custom tools from the database and register them
  try {
    const tools = await db
      .select()
      .from(customMcpTools)
      .where(eq(customMcpTools.isActive, true));

    for (const tool of tools) {
      server.tool(
        tool.toolName,
        tool.description,
        tool.inputSchema ? JSON.parse(tool.inputSchema) : {},
        async (params: Record<string, unknown>) => {
          try {
            // Execute the tool's SQL template with parameter substitution
            let query = tool.sqlTemplate;
            for (const [key, value] of Object.entries(params)) {
              query = query.replace(
                new RegExp(`\\{\\{${key}\\}\\}`, "g"),
                typeof value === "string" ? value : JSON.stringify(value),
              );
            }
            const result = await multiDb.executeQuery(
              tool.targetDatabase ?? "ship",
              query,
            );
            return {
              content: [
                { type: "text" as const, text: JSON.stringify(result) },
              ],
            };
          } catch (err) {
            const message =
              err instanceof Error ? err.message : "Tool execution failed";
            return {
              content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
            };
          }
        },
      );
    }
  } catch {
    // Table might not exist yet on first boot — that's fine
  }

  return server;
}

// ─── Route Handler ──────────────────────────────

export async function POST(request: Request) {
  if (!validateAuth(request)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const server = await createMcpServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless
      enableJsonResponse: true,
    });

    await server.connect(transport);
    const response = await transport.handleRequest(request);
    return response;
  } catch (err) {
    logger.error({ err }, "MCP endpoint error");
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function GET(request: Request) {
  if (!validateAuth(request)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const server = await createMcpServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    await server.connect(transport);
    const response = await transport.handleRequest(request);
    return response;
  } catch (err) {
    logger.error({ err }, "MCP GET endpoint error");
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function DELETE(request: Request) {
  // Session cleanup — stateless mode, so just acknowledge
  return new Response(null, { status: 200 });
}
