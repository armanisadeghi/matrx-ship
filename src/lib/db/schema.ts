import {
  pgTable,
  pgView,
  uuid,
  text,
  integer,
  serial,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";
import { sql, eq } from "drizzle-orm";

// ─────────────────────────────────────────────────
// Existing tables
// ─────────────────────────────────────────────────

/**
 * app_version table — tracks every deployment / ship event.
 * Schema carried over from the real-singles Supabase implementation.
 */
export const appVersion = pgTable(
  "app_version",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    version: text("version").notNull(),
    buildNumber: integer("build_number").notNull().default(1),
    gitCommit: text("git_commit"),
    commitMessage: text("commit_message"),
    linesAdded: integer("lines_added"),
    linesDeleted: integer("lines_deleted"),
    filesChanged: integer("files_changed"),
    deployedAt: timestamp("deployed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deploymentStatus: text("deployment_status").default("pending"),
    vercelDeploymentId: text("vercel_deployment_id"),
    vercelDeploymentUrl: text("vercel_deployment_url"),
    deploymentError: text("deployment_error"),
  },
  (table) => [
    index("idx_app_version_vercel_deployment_id").on(table.vercelDeploymentId),
    index("idx_app_version_git_commit").on(table.gitCommit),
    index("idx_app_version_build_number").on(table.buildNumber),
  ],
);

/**
 * api_keys table — stores API keys for authenticating CLI and client requests.
 */
export const apiKeys = pgTable("api_keys", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull().unique(),
  label: text("label").notNull().default("default"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  isActive: integer("is_active").notNull().default(1),
});

/**
 * logs table — stores application and system logs for the unified logging system.
 */
export const logs = pgTable(
  "logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    timestamp: timestamp("timestamp", { withTimezone: true })
      .notNull()
      .defaultNow(),
    level: text("level").notNull().default("info"), // info, warn, error, debug, fatal
    source: text("source").notNull().default("app"), // app identifier
    environment: text("environment").notNull().default("production"), // production, preview, dev
    message: text("message").notNull(),
    metadata: jsonb("metadata"),
    requestId: text("request_id"),
    traceId: text("trace_id"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_logs_source_timestamp").on(table.source, table.timestamp),
    index("idx_logs_level_timestamp").on(table.level, table.timestamp),
    index("idx_logs_timestamp").on(table.timestamp),
    index("idx_logs_environment").on(table.environment),
    index("idx_logs_request_id").on(table.requestId),
  ],
);

// Type exports for existing tables
export type AppVersion = typeof appVersion.$inferSelect;
export type NewAppVersion = typeof appVersion.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
export type Log = typeof logs.$inferSelect;
export type NewLog = typeof logs.$inferInsert;

// ─────────────────────────────────────────────────
// Ticketing system tables
// ─────────────────────────────────────────────────

/**
 * tickets — Current state snapshot of each ticket.
 * Optimized for fast filtering and pipeline views.
 * Full history lives in ticket_activity.
 */
export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ticketNumber: serial("ticket_number").notNull(),
    projectId: text("project_id").notNull(),
    source: text("source").notNull(), // sdk, portal, mcp, api, admin
    ticketType: text("ticket_type").notNull(), // bug, feature, suggestion, task, enhancement
    title: text("title").notNull(),
    description: text("description").notNull(),

    // Status / Resolution split
    status: text("status").notNull().default("new"),
    // Statuses: new, triaged, approved, in_progress, in_review, user_review, resolved, closed
    resolution: text("resolution"),
    // Resolutions: fixed, wont_fix, duplicate, deferred, invalid, cannot_reproduce

    priority: text("priority"), // low, medium, high, critical
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),

    // Context
    route: text("route"),
    environment: text("environment"), // production, staging, development
    browserInfo: text("browser_info"),
    osInfo: text("os_info"),

    // Reporter
    reporterId: text("reporter_id").notNull(),
    reporterName: text("reporter_name"),
    reporterEmail: text("reporter_email"),

    // Assignment & Direction
    assignee: text("assignee"),
    direction: text("direction"),

    // AI Triage
    aiAssessment: text("ai_assessment"),
    aiSolutionProposal: text("ai_solution_proposal"),
    aiSuggestedPriority: text("ai_suggested_priority"),
    aiComplexity: text("ai_complexity"), // simple, moderate, complex
    aiEstimatedFiles: text("ai_estimated_files").array(),
    autonomyScore: integer("autonomy_score"), // 1-5

    // Work queue
    workPriority: integer("work_priority"),

    // Testing (latest result — history in activity)
    testingResult: text("testing_result"), // pending, pass, fail, partial

    // Follow-up system
    needsFollowup: boolean("needs_followup").notNull().default(false),
    followupNotes: text("followup_notes"),
    followupAfter: timestamp("followup_after", { withTimezone: true }),

    // Relationships
    parentId: uuid("parent_id"),

    // Idempotency
    clientReferenceId: text("client_reference_id"),

    // Timestamps & tracking
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedBy: text("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    // Pipeline views
    index("idx_tickets_project_status").on(table.projectId, table.status),
    index("idx_tickets_project_status_created").on(
      table.projectId,
      table.status,
      table.createdAt,
    ),
    // My tickets
    index("idx_tickets_reporter").on(table.reporterId),
    // Human-readable lookups
    index("idx_tickets_number").on(table.ticketNumber),
    // Work queue (partial index via raw SQL in migration)
    index("idx_tickets_work_priority").on(table.workPriority),
    // Idempotent creation
    uniqueIndex("idx_tickets_idempotent")
      .on(table.projectId, table.clientReferenceId)
      .where(sql`${table.clientReferenceId} IS NOT NULL`),
    // Follow-up reminders
    index("idx_tickets_followup")
      .on(table.needsFollowup, table.followupAfter)
      .where(sql`${table.needsFollowup} = true`),
    // Child ticket lookups
    index("idx_tickets_parent").on(table.parentId),
  ],
);

/**
 * ticket_activity — Unified chronological history of every event.
 * This is the core of the ticketing system. The "film" to ticket's "snapshot."
 *
 * Activity types: comment, message, status_change, field_change,
 *   decision, test_result, assignment, resolution, system
 */
export const ticketActivity = pgTable(
  "ticket_activity",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    activityType: text("activity_type").notNull(),
    // Types: comment, message, status_change, field_change, decision,
    //        test_result, assignment, resolution, system
    authorType: text("author_type").notNull(), // user, admin, agent, system
    authorName: text("author_name"),
    content: text("content"),
    metadata: jsonb("metadata"), // structured data varies by activity_type
    visibility: text("visibility").notNull().default("internal"), // internal, user_visible
    requiresApproval: boolean("requires_approval").notNull().default(false),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Timeline queries (most important index)
    index("idx_activity_timeline").on(table.ticketId, table.createdAt),
    // Filtered views by type
    index("idx_activity_type").on(table.ticketId, table.activityType),
    // User-visible timeline
    index("idx_activity_user_visible").on(
      table.ticketId,
      table.visibility,
      table.createdAt,
    ),
  ],
);

/**
 * ticket_attachments — File metadata for attachments stored on disk.
 */
export const ticketAttachments = pgTable(
  "ticket_attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(), // UUID-based storage name
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    uploadedBy: text("uploaded_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("idx_attachments_ticket").on(table.ticketId)],
);

/**
 * vw_ticket_timeline — Convenience view joining ticket info with activity stream.
 * Primary query interface for getting the full story of a ticket.
 */
export const vwTicketTimeline = pgView("vw_ticket_timeline").as((qb) =>
  qb
    .select({
      ticketId: tickets.id,
      ticketNumber: tickets.ticketNumber,
      ticketTitle: tickets.title,
      currentStatus: tickets.status,
      currentResolution: tickets.resolution,
      activityId: ticketActivity.id,
      activityType: ticketActivity.activityType,
      authorType: ticketActivity.authorType,
      authorName: ticketActivity.authorName,
      content: ticketActivity.content,
      metadata: ticketActivity.metadata,
      visibility: ticketActivity.visibility,
      requiresApproval: ticketActivity.requiresApproval,
      approvedBy: ticketActivity.approvedBy,
      approvedAt: ticketActivity.approvedAt,
      createdAt: ticketActivity.createdAt,
    })
    .from(tickets)
    .innerJoin(ticketActivity, eq(ticketActivity.ticketId, tickets.id))
    .where(sql`${tickets.deletedAt} IS NULL`)
    .orderBy(tickets.id, ticketActivity.createdAt),
);

// Type exports for ticketing system
export type Ticket = typeof tickets.$inferSelect;
export type NewTicket = typeof tickets.$inferInsert;
export type TicketActivity = typeof ticketActivity.$inferSelect;
export type NewTicketActivity = typeof ticketActivity.$inferInsert;
export type TicketAttachment = typeof ticketAttachments.$inferSelect;
export type NewTicketAttachment = typeof ticketAttachments.$inferInsert;
export type TicketTimelineRow = typeof vwTicketTimeline.$inferSelect;
