import { db } from "@/lib/db";
import {
  tickets,
  ticketActivity,
  ticketAttachments,
  type Ticket,
  type NewTicket,
  type TicketActivity,
  type NewTicketActivity,
  type TicketAttachment,
} from "@/lib/db/schema";
import { eq, and, sql, desc, asc, inArray, isNull, or } from "drizzle-orm";
import { logger } from "@/lib/logger";
import path from "path";
import { writeFile, mkdir, readdir, unlink } from "fs/promises";

// ─────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────

export interface ActorInfo {
  type: "user" | "admin" | "agent" | "system";
  name: string;
}

export interface CreateTicketInput {
  projectId: string;
  source: string;
  ticketType: string;
  title: string;
  description: string;
  priority?: string | null;
  tags?: string[];
  route?: string | null;
  environment?: string | null;
  browserInfo?: string | null;
  osInfo?: string | null;
  reporterId: string;
  reporterName?: string | null;
  reporterEmail?: string | null;
  parentId?: string | null;
  clientReferenceId?: string | null;
}

export interface ListTicketsOptions {
  projectId?: string;
  status?: string | string[];
  ticketType?: string | string[];
  priority?: string | string[];
  tags?: string[];
  assignee?: string;
  reporterId?: string;
  needsFollowup?: boolean;
  parentId?: string | null;
  search?: string;
  sort?: "created_at" | "updated_at" | "work_priority" | "ticket_number";
  order?: "asc" | "desc";
  page?: number;
  limit?: number;
  includeDeleted?: boolean;
}

export interface TimelineOptions {
  visibility?: "internal" | "user_visible";
  activityTypes?: string[];
  since?: Date;
  limit?: number;
}

// ─────────────────────────────────────────────────
// Core CRUD
// ─────────────────────────────────────────────────

/**
 * Create a new ticket. Idempotent via client_reference_id.
 */
export async function createTicket(
  input: CreateTicketInput,
  actor: ActorInfo,
): Promise<Ticket> {
  // Check for idempotent creation
  if (input.clientReferenceId) {
    const existing = await db
      .select()
      .from(tickets)
      .where(
        and(
          eq(tickets.projectId, input.projectId),
          eq(tickets.clientReferenceId, input.clientReferenceId),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      return existing[0];
    }
  }

  const [ticket] = await db
    .insert(tickets)
    .values({
      projectId: input.projectId,
      source: input.source,
      ticketType: input.ticketType,
      title: input.title,
      description: input.description,
      priority: input.priority,
      tags: input.tags ?? [],
      route: input.route,
      environment: input.environment,
      browserInfo: input.browserInfo,
      osInfo: input.osInfo,
      reporterId: input.reporterId,
      reporterName: input.reporterName,
      reporterEmail: input.reporterEmail,
      parentId: input.parentId,
      clientReferenceId: input.clientReferenceId,
      updatedBy: actor.name,
    })
    .returning();

  // Create initial system activity entry
  await addActivity(ticket.id, {
    activityType: "system",
    authorType: "system",
    authorName: "System",
    content: `Ticket created via ${input.source}`,
    visibility: "user_visible",
  });

  logger.info({ ticketId: ticket.id, ticketNumber: ticket.ticketNumber }, "Ticket created");
  return ticket;
}

/**
 * Get a single ticket by ID. Returns null if not found or soft-deleted.
 */
export async function getTicketById(id: string): Promise<Ticket | null> {
  const [ticket] = await db
    .select()
    .from(tickets)
    .where(and(eq(tickets.id, id), isNull(tickets.deletedAt)))
    .limit(1);
  return ticket ?? null;
}

/**
 * Get a single ticket by human-readable number.
 */
export async function getTicketByNumber(
  projectId: string,
  ticketNumber: number,
): Promise<Ticket | null> {
  const [ticket] = await db
    .select()
    .from(tickets)
    .where(
      and(
        eq(tickets.projectId, projectId),
        eq(tickets.ticketNumber, ticketNumber),
        isNull(tickets.deletedAt),
      ),
    )
    .limit(1);
  return ticket ?? null;
}

/**
 * List tickets with comprehensive filtering, sorting, and pagination.
 */
export async function listTickets(
  options: ListTicketsOptions = {},
): Promise<{ tickets: Ticket[]; total: number; page: number; pageSize: number; totalPages: number }> {
  const {
    page = 1,
    limit: pageSize = 20,
    sort = "created_at",
    order = "desc",
    includeDeleted = false,
  } = options;

  const conditions = [];

  if (!includeDeleted) {
    conditions.push(isNull(tickets.deletedAt));
  }
  if (options.projectId) {
    conditions.push(eq(tickets.projectId, options.projectId));
  }
  if (options.status) {
    const statuses = Array.isArray(options.status) ? options.status : [options.status];
    conditions.push(inArray(tickets.status, statuses));
  }
  if (options.ticketType) {
    const types = Array.isArray(options.ticketType) ? options.ticketType : [options.ticketType];
    conditions.push(inArray(tickets.ticketType, types));
  }
  if (options.priority) {
    const priorities = Array.isArray(options.priority) ? options.priority : [options.priority];
    conditions.push(inArray(tickets.priority, priorities));
  }
  if (options.assignee) {
    conditions.push(eq(tickets.assignee, options.assignee));
  }
  if (options.reporterId) {
    conditions.push(eq(tickets.reporterId, options.reporterId));
  }
  if (options.needsFollowup !== undefined) {
    conditions.push(eq(tickets.needsFollowup, options.needsFollowup));
  }
  if (options.parentId !== undefined) {
    if (options.parentId === null) {
      conditions.push(isNull(tickets.parentId));
    } else {
      conditions.push(eq(tickets.parentId, options.parentId));
    }
  }
  if (options.search) {
    conditions.push(
      or(
        sql`${tickets.title} ILIKE ${"%" + options.search + "%"}`,
        sql`${tickets.description} ILIKE ${"%" + options.search + "%"}`,
      ),
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Count total
  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tickets)
    .where(whereClause);
  const total = countResult?.count ?? 0;

  // Sort
  const sortColumn = {
    created_at: tickets.createdAt,
    updated_at: tickets.updatedAt,
    work_priority: tickets.workPriority,
    ticket_number: tickets.ticketNumber,
  }[sort] ?? tickets.createdAt;

  const orderFn = order === "asc" ? asc : desc;

  // Query
  const results = await db
    .select()
    .from(tickets)
    .where(whereClause)
    .orderBy(orderFn(sortColumn))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return {
    tickets: results,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * Update ticket fields. Creates field_change activity entries for each changed field.
 */
export async function updateTicket(
  id: string,
  changes: Partial<Omit<NewTicket, "id" | "ticketNumber" | "createdAt">>,
  actor: ActorInfo,
): Promise<Ticket | null> {
  const existing = await getTicketById(id);
  if (!existing) return null;

  // Track field changes for activity entries
  const fieldChanges: Array<{ field: string; from: unknown; to: unknown }> = [];
  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
    updatedBy: actor.name,
  };

  const trackableFields = [
    "title", "description", "ticketType", "priority", "tags", "route",
    "environment", "assignee", "direction", "aiAssessment",
    "aiSolutionProposal", "aiSuggestedPriority", "aiComplexity",
    "aiEstimatedFiles", "autonomyScore", "workPriority", "testingResult",
    "needsFollowup", "followupNotes", "followupAfter", "resolution",
    "reporterName", "reporterEmail",
  ] as const;

  for (const field of trackableFields) {
    if (field in changes && changes[field as keyof typeof changes] !== undefined) {
      const oldValue = existing[field as keyof Ticket];
      const newValue = changes[field as keyof typeof changes];
      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        fieldChanges.push({ field, from: oldValue, to: newValue });
        updateData[field] = newValue;
      }
    }
  }

  if (Object.keys(updateData).length <= 2) {
    // Only updatedAt and updatedBy — no real changes
    return existing;
  }

  const [updated] = await db
    .update(tickets)
    .set(updateData)
    .where(eq(tickets.id, id))
    .returning();

  // Record field changes in activity
  for (const change of fieldChanges) {
    await addActivity(id, {
      activityType: "field_change",
      authorType: actor.type,
      authorName: actor.name,
      content: `Changed ${change.field}`,
      metadata: change,
      visibility: "internal",
    });
  }

  return updated;
}

/**
 * Soft-delete a ticket.
 */
export async function deleteTicket(id: string, actor: ActorInfo): Promise<boolean> {
  const [result] = await db
    .update(tickets)
    .set({ deletedAt: new Date(), updatedBy: actor.name, updatedAt: new Date() })
    .where(and(eq(tickets.id, id), isNull(tickets.deletedAt)))
    .returning({ id: tickets.id });
  return !!result;
}

// ─────────────────────────────────────────────────
// Status & Pipeline Operations
// ─────────────────────────────────────────────────

/**
 * Change ticket status. Creates a status_change activity entry.
 */
export async function changeStatus(
  id: string,
  newStatus: string,
  actor: ActorInfo,
  notes?: string,
): Promise<Ticket | null> {
  const existing = await getTicketById(id);
  if (!existing) return null;

  const oldStatus = existing.status;
  if (oldStatus === newStatus) return existing;

  // Warn on unusual transitions (but don't block)
  const normalFlow = ["new", "triaged", "approved", "in_progress", "in_review", "user_review", "resolved", "closed"];
  const fromIdx = normalFlow.indexOf(oldStatus);
  const toIdx = normalFlow.indexOf(newStatus);
  if (fromIdx >= 0 && toIdx >= 0 && toIdx < fromIdx && newStatus !== "closed") {
    logger.warn({ ticketId: id, from: oldStatus, to: newStatus }, "Unusual status transition (backwards)");
  }

  const updateData: Record<string, unknown> = {
    status: newStatus,
    updatedAt: new Date(),
    updatedBy: actor.name,
  };

  // Set resolved_at when first reaching resolved
  if (newStatus === "resolved" && !existing.resolvedAt) {
    updateData.resolvedAt = new Date();
  }

  const [updated] = await db
    .update(tickets)
    .set(updateData)
    .where(eq(tickets.id, id))
    .returning();

  await addActivity(id, {
    activityType: "status_change",
    authorType: actor.type,
    authorName: actor.name,
    content: notes ?? `Status changed from ${oldStatus} to ${newStatus}`,
    metadata: { from: oldStatus, to: newStatus },
    visibility: "user_visible",
  });

  return updated;
}

/**
 * Triage a ticket — sets AI fields and changes status to 'triaged'.
 */
export async function triageTicket(
  id: string,
  triageData: {
    aiAssessment?: string;
    aiSolutionProposal?: string;
    aiSuggestedPriority?: string;
    aiComplexity?: string;
    aiEstimatedFiles?: string[];
    autonomyScore?: number;
  },
  actor: ActorInfo,
): Promise<Ticket | null> {
  const existing = await getTicketById(id);
  if (!existing) return null;

  await db
    .update(tickets)
    .set({
      ...triageData,
      priority: triageData.aiSuggestedPriority ?? existing.priority,
      status: "triaged",
      updatedAt: new Date(),
      updatedBy: actor.name,
    })
    .where(eq(tickets.id, id));

  // Record triage as a comment + status change
  await addActivity(id, {
    activityType: "comment",
    authorType: actor.type,
    authorName: actor.name,
    content: triageData.aiAssessment ?? "Ticket triaged",
    metadata: {
      solutionProposal: triageData.aiSolutionProposal,
      complexity: triageData.aiComplexity,
      estimatedFiles: triageData.aiEstimatedFiles,
      autonomyScore: triageData.autonomyScore,
    },
    visibility: "internal",
  });

  if (existing.status !== "triaged") {
    await addActivity(id, {
      activityType: "status_change",
      authorType: actor.type,
      authorName: actor.name,
      content: `Status changed from ${existing.status} to triaged`,
      metadata: { from: existing.status, to: "triaged" },
      visibility: "user_visible",
    });
  }

  return getTicketById(id);
}

/**
 * Approve a ticket — creates decision activity, sets direction and work_priority.
 */
export async function approveTicket(
  id: string,
  direction?: string,
  workPriority?: number,
  actor?: ActorInfo,
): Promise<Ticket | null> {
  const _actor = actor ?? { type: "admin" as const, name: "Admin" };
  const existing = await getTicketById(id);
  if (!existing) return null;

  // Auto-assign work priority if not provided
  let priority = workPriority;
  if (priority === undefined) {
    const [maxResult] = await db
      .select({ max: sql<number>`COALESCE(MAX(work_priority), 0)` })
      .from(tickets)
      .where(eq(tickets.status, "approved"));
    priority = (maxResult?.max ?? 0) + 1;
  }

  await db
    .update(tickets)
    .set({
      status: "approved",
      direction: direction ?? existing.direction,
      workPriority: priority,
      updatedAt: new Date(),
      updatedBy: _actor.name,
    })
    .where(eq(tickets.id, id));

  await addActivity(id, {
    activityType: "decision",
    authorType: _actor.type,
    authorName: _actor.name,
    content: direction ?? "Approved for work",
    metadata: { decision: "approved", direction: direction ?? null },
    visibility: "internal",
  });

  if (existing.status !== "approved") {
    await addActivity(id, {
      activityType: "status_change",
      authorType: _actor.type,
      authorName: _actor.name,
      content: `Status changed from ${existing.status} to approved`,
      metadata: { from: existing.status, to: "approved" },
      visibility: "user_visible",
    });
  }

  return getTicketById(id);
}

/**
 * Reject a ticket — closes with a resolution.
 */
export async function rejectTicket(
  id: string,
  resolution: string,
  reason: string,
  actor: ActorInfo,
): Promise<Ticket | null> {
  const existing = await getTicketById(id);
  if (!existing) return null;

  await db
    .update(tickets)
    .set({
      status: "closed",
      resolution,
      updatedAt: new Date(),
      updatedBy: actor.name,
    })
    .where(eq(tickets.id, id));

  await addActivity(id, {
    activityType: "decision",
    authorType: actor.type,
    authorName: actor.name,
    content: reason,
    metadata: { decision: "rejected", direction: reason },
    visibility: "internal",
  });

  await addActivity(id, {
    activityType: "resolution",
    authorType: actor.type,
    authorName: actor.name,
    content: reason,
    metadata: { resolution, notes: reason },
    visibility: "user_visible",
  });

  await addActivity(id, {
    activityType: "status_change",
    authorType: actor.type,
    authorName: actor.name,
    content: `Status changed from ${existing.status} to closed`,
    metadata: { from: existing.status, to: "closed" },
    visibility: "user_visible",
  });

  return getTicketById(id);
}

/**
 * Resolve a ticket — submits fix for testing.
 */
export async function resolveTicket(
  id: string,
  data: {
    resolutionNotes: string;
    testingInstructions?: string;
    testingUrl?: string;
  },
  actor: ActorInfo,
): Promise<Ticket | null> {
  const existing = await getTicketById(id);
  if (!existing) return null;

  await db
    .update(tickets)
    .set({
      status: "in_review",
      testingResult: "pending",
      updatedAt: new Date(),
      updatedBy: actor.name,
    })
    .where(eq(tickets.id, id));

  await addActivity(id, {
    activityType: "test_result",
    authorType: actor.type,
    authorName: actor.name,
    content: data.resolutionNotes,
    metadata: {
      result: "pending",
      testing_url: data.testingUrl ?? null,
      testing_instructions: data.testingInstructions ?? null,
    },
    visibility: "internal",
  });

  if (existing.status !== "in_review") {
    await addActivity(id, {
      activityType: "status_change",
      authorType: actor.type,
      authorName: actor.name,
      content: `Status changed from ${existing.status} to in_review`,
      metadata: { from: existing.status, to: "in_review" },
      visibility: "user_visible",
    });
  }

  return getTicketById(id);
}

// ─────────────────────────────────────────────────
// Activity Operations
// ─────────────────────────────────────────────────

/**
 * Core function: add an activity entry to a ticket.
 */
export async function addActivity(
  ticketId: string,
  data: Omit<NewTicketActivity, "id" | "ticketId" | "createdAt">,
): Promise<TicketActivity> {
  const [activity] = await db
    .insert(ticketActivity)
    .values({
      ticketId,
      activityType: data.activityType,
      authorType: data.authorType,
      authorName: data.authorName,
      content: data.content,
      metadata: data.metadata,
      visibility: data.visibility ?? "internal",
      requiresApproval: data.requiresApproval ?? false,
      approvedBy: data.approvedBy,
      approvedAt: data.approvedAt,
    })
    .returning();

  return activity;
}

/**
 * Add an internal comment (admin/agent only).
 */
export async function addComment(
  ticketId: string,
  content: string,
  actor: ActorInfo,
): Promise<TicketActivity> {
  return addActivity(ticketId, {
    activityType: "comment",
    authorType: actor.type,
    authorName: actor.name,
    content,
    visibility: "internal",
  });
}

/**
 * Send a user-visible message.
 */
export async function sendMessage(
  ticketId: string,
  content: string,
  actor: ActorInfo,
  requiresApproval = false,
): Promise<TicketActivity> {
  return addActivity(ticketId, {
    activityType: "message",
    authorType: actor.type,
    authorName: actor.name,
    content,
    visibility: "user_visible",
    requiresApproval: actor.type === "agent" ? true : requiresApproval,
  });
}

/**
 * Submit a test result.
 */
export async function submitTestResult(
  ticketId: string,
  result: "pass" | "fail" | "partial",
  details: { content?: string; testingUrl?: string; testingInstructions?: string },
  actor: ActorInfo,
): Promise<TicketActivity> {
  // Update the denormalized testing_result on the ticket
  await db
    .update(tickets)
    .set({ testingResult: result, updatedAt: new Date(), updatedBy: actor.name })
    .where(eq(tickets.id, ticketId));

  return addActivity(ticketId, {
    activityType: "test_result",
    authorType: actor.type,
    authorName: actor.name,
    content: details.content ?? `Test result: ${result}`,
    metadata: {
      result,
      testing_url: details.testingUrl ?? null,
      testing_instructions: details.testingInstructions ?? null,
    },
    visibility: "internal",
  });
}

/**
 * Approve an agent draft message, making it visible to users.
 */
export async function approveDraft(
  activityId: string,
  adminInfo: ActorInfo,
): Promise<TicketActivity | null> {
  const [updated] = await db
    .update(ticketActivity)
    .set({
      approvedBy: adminInfo.name,
      approvedAt: new Date(),
    })
    .where(
      and(
        eq(ticketActivity.id, activityId),
        eq(ticketActivity.requiresApproval, true),
      ),
    )
    .returning();
  return updated ?? null;
}

/**
 * Promote an internal activity entry to user-visible.
 */
export async function promoteToUserVisible(
  activityId: string,
  adminInfo: ActorInfo,
): Promise<TicketActivity | null> {
  const [updated] = await db
    .update(ticketActivity)
    .set({
      visibility: "user_visible",
      approvedBy: adminInfo.name,
      approvedAt: new Date(),
    })
    .where(
      and(
        eq(ticketActivity.id, activityId),
        eq(ticketActivity.visibility, "internal"),
      ),
    )
    .returning();
  return updated ?? null;
}

// ─────────────────────────────────────────────────
// Timeline Operations
// ─────────────────────────────────────────────────

/**
 * Get the full chronological activity stream for a ticket.
 */
export async function getTicketTimeline(
  ticketId: string,
  options: TimelineOptions = {},
): Promise<TicketActivity[]> {
  const conditions = [eq(ticketActivity.ticketId, ticketId)];

  if (options.visibility) {
    conditions.push(eq(ticketActivity.visibility, options.visibility));
  }
  if (options.activityTypes?.length) {
    conditions.push(inArray(ticketActivity.activityType, options.activityTypes));
  }
  if (options.since) {
    conditions.push(sql`${ticketActivity.createdAt} > ${options.since}`);
  }

  const query = db
    .select()
    .from(ticketActivity)
    .where(and(...conditions))
    .orderBy(asc(ticketActivity.createdAt));

  if (options.limit) {
    return query.limit(options.limit);
  }
  return query;
}

/**
 * Get timeline optimized for AI agent consumption.
 * Returns a formatted text narrative.
 */
export async function getTicketTimelineForAgent(ticketId: string): Promise<string> {
  const ticket = await getTicketById(ticketId);
  if (!ticket) return "Ticket not found.";

  const timeline = await getTicketTimeline(ticketId);

  const lines: string[] = [
    `Ticket T-${ticket.ticketNumber}: "${ticket.title}"`,
    `Status: ${ticket.status}${ticket.resolution ? ` | Resolution: ${ticket.resolution}` : ""} | Priority: ${ticket.priority ?? "unset"} | Type: ${ticket.ticketType}`,
    `Reporter: ${ticket.reporterName ?? ticket.reporterId}${ticket.assignee ? ` | Assigned to: ${ticket.assignee}` : ""}`,
    ticket.direction ? `Direction: ${ticket.direction}` : "",
    "",
    "Timeline:",
  ].filter(Boolean);

  for (const entry of timeline) {
    const ts = new Date(entry.createdAt).toISOString().replace("T", " ").slice(0, 19);
    const authorLabel = `${entry.authorType.toUpperCase()}${entry.authorName ? ` (${entry.authorName})` : ""}`;

    switch (entry.activityType) {
      case "status_change": {
        const meta = entry.metadata as { from: string; to: string } | null;
        lines.push(`[${ts}] STATUS: ${meta?.from ?? "?"} → ${meta?.to ?? "?"}`);
        break;
      }
      case "decision": {
        const meta = entry.metadata as { decision: string; direction?: string } | null;
        lines.push(
          `[${ts}] DECISION: ${meta?.decision ?? "?"} by ${authorLabel}${meta?.direction ? ` — "${meta.direction}"` : ""}`,
        );
        break;
      }
      case "test_result": {
        const meta = entry.metadata as { result: string } | null;
        lines.push(`[${ts}] TEST: result=${meta?.result ?? "?"}${entry.content ? ` — ${entry.content}` : ""}`);
        break;
      }
      case "assignment": {
        const meta = entry.metadata as { from?: string; to?: string } | null;
        lines.push(`[${ts}] ASSIGNED: ${meta?.from ?? "unassigned"} → ${meta?.to ?? "unassigned"}`);
        break;
      }
      case "resolution": {
        const meta = entry.metadata as { resolution: string; notes?: string } | null;
        lines.push(`[${ts}] RESOLVED: ${meta?.resolution ?? "?"}${meta?.notes ? ` — ${meta.notes}` : ""}`);
        break;
      }
      case "system":
        lines.push(`[${ts}] SYSTEM: ${entry.content ?? ""}`);
        break;
      case "field_change": {
        const meta = entry.metadata as { field: string; from: unknown; to: unknown } | null;
        lines.push(`[${ts}] CHANGED: ${meta?.field ?? "?"}: ${JSON.stringify(meta?.from)} → ${JSON.stringify(meta?.to)}`);
        break;
      }
      default:
        lines.push(`[${ts}] ${authorLabel}: ${entry.content ?? ""}`);
    }
  }

  return lines.join("\n");
}

/**
 * Get timeline filtered for user visibility (only user_visible + approved entries).
 */
export async function getTicketTimelineForUser(
  ticketId: string,
  reporterId: string,
): Promise<TicketActivity[]> {
  // Verify the reporter owns this ticket
  const ticket = await getTicketById(ticketId);
  if (!ticket || ticket.reporterId !== reporterId) return [];

  return db
    .select()
    .from(ticketActivity)
    .where(
      and(
        eq(ticketActivity.ticketId, ticketId),
        eq(ticketActivity.visibility, "user_visible"),
        or(
          eq(ticketActivity.requiresApproval, false),
          sql`${ticketActivity.approvedAt} IS NOT NULL`,
        ),
      ),
    )
    .orderBy(asc(ticketActivity.createdAt));
}

// ─────────────────────────────────────────────────
// Queue Operations
// ─────────────────────────────────────────────────

/**
 * Get approved tickets ordered by work_priority.
 */
export async function getWorkQueue(projectId?: string): Promise<Ticket[]> {
  const conditions = [
    eq(tickets.status, "approved"),
    isNull(tickets.deletedAt),
  ];
  if (projectId) conditions.push(eq(tickets.projectId, projectId));

  return db
    .select()
    .from(tickets)
    .where(and(...conditions))
    .orderBy(asc(tickets.workPriority));
}

/**
 * Get a batch of untriaged tickets.
 */
export async function getTriageBatch(
  projectId?: string,
  batchSize = 3,
): Promise<Ticket[]> {
  const conditions = [
    eq(tickets.status, "new"),
    isNull(tickets.deletedAt),
  ];
  if (projectId) conditions.push(eq(tickets.projectId, projectId));

  return db
    .select()
    .from(tickets)
    .where(and(...conditions))
    .orderBy(asc(tickets.createdAt))
    .limit(batchSize);
}

/**
 * Get tickets with failed or partial test results (need rework).
 */
export async function getReworkItems(projectId?: string): Promise<Ticket[]> {
  const conditions = [
    inArray(tickets.testingResult, ["fail", "partial"]),
    inArray(tickets.status, ["in_progress", "in_review"]),
    isNull(tickets.deletedAt),
  ];
  if (projectId) conditions.push(eq(tickets.projectId, projectId));

  return db
    .select()
    .from(tickets)
    .where(and(...conditions))
    .orderBy(asc(tickets.updatedAt));
}

/**
 * Get tickets needing follow-up.
 */
export async function getFollowUps(
  projectId?: string,
  dueBy?: Date,
): Promise<Ticket[]> {
  const conditions = [
    eq(tickets.needsFollowup, true),
    isNull(tickets.deletedAt),
  ];
  if (projectId) conditions.push(eq(tickets.projectId, projectId));
  if (dueBy) {
    conditions.push(sql`${tickets.followupAfter} <= ${dueBy}`);
  }

  return db
    .select()
    .from(tickets)
    .where(and(...conditions))
    .orderBy(asc(tickets.followupAfter));
}

// ─────────────────────────────────────────────────
// Attachment Operations
// ─────────────────────────────────────────────────

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "/app/uploads/tickets";

/**
 * Save a file attachment to disk and record metadata.
 */
export async function uploadAttachment(
  ticketId: string,
  file: { buffer: Buffer; originalName: string; mimeType: string; size: number },
  uploaderInfo: ActorInfo,
): Promise<TicketAttachment> {
  const ext = path.extname(file.originalName);
  const filename = `${crypto.randomUUID()}${ext}`;
  const dir = path.join(UPLOAD_DIR, ticketId);

  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), file.buffer);

  const [attachment] = await db
    .insert(ticketAttachments)
    .values({
      ticketId,
      filename,
      originalName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.size,
      uploadedBy: uploaderInfo.name,
    })
    .returning();

  await addActivity(ticketId, {
    activityType: "system",
    authorType: uploaderInfo.type,
    authorName: uploaderInfo.name,
    content: `Attachment uploaded: ${file.originalName}`,
    visibility: "user_visible",
  });

  return attachment;
}

/**
 * Get all attachments for a ticket.
 */
export async function getAttachments(ticketId: string): Promise<TicketAttachment[]> {
  return db
    .select()
    .from(ticketAttachments)
    .where(eq(ticketAttachments.ticketId, ticketId))
    .orderBy(asc(ticketAttachments.createdAt));
}
