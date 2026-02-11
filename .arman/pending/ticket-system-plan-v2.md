---
name: Ticket System for Matrx Ship (v2 — Revised)
overview: Build a standalone, multi-tenant ticketing system into matrx-ship that covers bugs, features, tasks, and enhancements — with admin management UI, user-facing portal, agent MCP/API access, and a distributable React SDK for embedding into any project.
revision_notes: >
  This is a complete revision of the original plan. Key changes from v1:
  1. Unified Activity Stream — merged ticket_comments and ticket_messages into a single ticket_activity table that serves as the complete chronological history of every ticket. This is the most important architectural change.
  2. Status/Resolution split — separated lifecycle status from outcome resolution for cleaner pipeline views.
  3. Renamed is_blocked to needs_followup with additional context fields.
  4. Dropped admin_decision as a column (captured in the activity stream instead).
  5. Added soft deletes, updated_by tracking, and idempotent ticket creation.
  6. Added a Ticket Timeline View as a first-class concept — the primary interface for both humans and AI agents to understand a ticket's full history.
  7. No rigid state machine — transitions are logged but not enforced.
todos:
  - id: phase-1-schema
    content: "Phase 1: Add tickets, ticket_activity, ticket_attachments tables to Drizzle schema and run migrations. Create the ticket_timeline database view."
    status: pending
  - id: phase-1-service
    content: "Phase 1: Build ticket service layer (src/lib/services/tickets.ts) with all CRUD, pipeline, query, and timeline functions"
    status: pending
  - id: phase-2-api
    content: "Phase 2: Create REST API routes (/api/tickets/*) with API key + reporter token auth"
    status: pending
  - id: phase-3-admin-table
    content: "Phase 3: Build admin Tickets page with pipeline table, filters, quick-approve, inline status changes"
    status: pending
  - id: phase-3-admin-detail
    content: "Phase 3: Build ticket detail dialog with tabs including Activity Timeline as the centerpiece"
    status: pending
  - id: phase-3-admin-queue
    content: "Phase 3: Build work queue tab and ticket stats dashboard cards"
    status: pending
  - id: phase-4-mcp
    content: "Phase 4: Create MCP endpoint (/api/mcp) exposing ticket tools for agent access"
    status: pending
  - id: phase-5-portal
    content: "Phase 5: Build standalone user portal (/portal) with submit form, ticket tracking, and messaging"
    status: pending
  - id: phase-6-sdk
    content: "Phase 6: Create distributable React ticket widget package (TicketButton, TicketForm, TicketTracker, TicketProvider)"
    status: pending
isProject: false
---

# Matrx Ship Ticketing System (v2)

## Naming

Rename from "Feedback" to **"Tickets"**. Each item is a **ticket** which covers bugs, features, suggestions, tasks, and enhancements. The system is the **Ticket Tracker**. The sidebar link replaces "Bug Reports" with "Tickets".

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                 Client Submission Sources             │
│                                                      │
│  React SDK    Standalone    MCP Tools    REST API    │
│  (npm pkg)    Web Portal    (agents)     (any client)│
└──────┬────────────┬────────────┬────────────┬────────┘
       │            │            │            │
       ▼            ▼            ▼            ▼
┌──────────────────────────────────────────────────────┐
│                  Matrx Ship Server                   │
│                                                      │
│  API Routes (/api/tickets/*)                         │
│  MCP Endpoint (/api/mcp)                             │
│  Admin UI (/admin/tickets)                           │
│  User Portal (/portal)                               │
└──────────────────────┬───────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────┐
│                Ship PostgreSQL                        │
│                                                      │
│  tickets            ticket_activity                  │
│  (current state)    (full chronological history)     │
│                                                      │
│  ticket_attachments                                  │
│  (file metadata)                                     │
│                                                      │
│  vw_ticket_timeline                                  │
│  (materialized view for reading full ticket story)   │
└──────────────────────────────────────────────────────┘
```

**Key architectural decisions:**

1. **Drizzle ORM with local PostgreSQL** — all business logic in TypeScript service functions, not stored procedures. Portable and testable.
2. **Unified Activity Stream** — ONE table (`ticket_activity`) captures every meaningful event: comments, messages, status changes, decisions, test results, field changes. This is the single source of truth for "what happened to this ticket."
3. **Status/Resolution Split** — `status` tracks where a ticket is in the pipeline; `resolution` tracks how it ended. Clean separation of lifecycle from outcome.
4. **Timeline-First Design** — The activity stream is the primary interface for both humans and AI agents. A database view (`vw_ticket_timeline`) makes it trivial to get the full, ordered story of any ticket.

---

## The Activity Stream — Core Design Principle

This is the most important concept in the system. Every meaningful event that occurs on a ticket is recorded as an entry in `ticket_activity`. The ticket table itself holds only the **current state** (denormalized for fast queries). The activity table holds the **complete history**.

Think of it like this: the `tickets` table is a snapshot; the `ticket_activity` table is the film.

### Why This Matters (Especially for AI Agents)

AI agents working on tickets need to quickly understand the full context: what was reported, what was tried, what failed, what the admin directed, what the user clarified. With a unified activity stream, an agent makes ONE query and gets the entire story in chronological order. No joining across multiple tables, no missing context.

### Activity Types

Every entry in `ticket_activity` has an `activity_type` that categorizes it:

| activity_type | Description | Example |
|---|---|---|
| `comment` | Internal discussion (admin/agent only by default) | "The auth module needs refactoring before we can fix this" |
| `message` | User-visible communication | "We've identified the issue and are working on a fix" |
| `status_change` | Ticket moved to a new status | metadata: `{ from: "triaged", to: "approved" }` |
| `field_change` | Any field on the ticket was updated | metadata: `{ field: "priority", from: "medium", to: "critical" }` |
| `decision` | Admin approval, rejection, or deferral | metadata: `{ decision: "approved", direction: "Fix via auth refactor" }` |
| `test_result` | Fix verification outcome | metadata: `{ result: "fail", testing_url: "...", instructions: "..." }` |
| `assignment` | Ticket assigned/reassigned | metadata: `{ from: null, to: "agent-claude" }` |
| `resolution` | Ticket resolved or closed | metadata: `{ resolution: "fixed", notes: "Deployed in v2.3.1" }` |
| `system` | Automated system events | "Ticket created from SDK", "Follow-up reminder triggered" |

### Visibility Model

Each activity entry has a `visibility` field:

- **`internal`** — Only admins and agents can see this. Used for internal comments, technical discussions, agent-to-agent communication.
- **`user_visible`** — The reporter/user can see this. Used for messages to the user, status change notifications, resolution notices.

**The "promote to user-visible" workflow:** An agent writes an internal comment explaining a fix. The admin reads it and thinks "the user should see this." One click changes `visibility` from `internal` to `user_visible`. No copy-paste, no duplicate entries.

**The "agent draft" workflow:** An agent writes a message intended for the user but sets `requires_approval = true`. It stays invisible to the user until an admin approves it. On approval: `approved_by` and `approved_at` are set, making it visible.

### Visibility Rules (Enforced at Service Layer)

**User sees:** `visibility = 'user_visible'` AND (`requires_approval = false` OR `approved_at IS NOT NULL`)

**Admin sees:** Everything.

**Agent sees:** Everything (same as admin for reading; writing rules differ — agents always write with `visibility = 'internal'` unless explicitly creating a user-facing draft).

---

## Database Schema (Drizzle)

### Table 1: `tickets` — Current State

This table holds the latest snapshot of each ticket. It's optimized for fast filtering and pipeline views. All historical data lives in `ticket_activity`.

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | uuid | gen_random_uuid() | PK |
| `ticket_number` | serial | auto | Human-readable (T-1, T-2...) |
| `project_id` | text | required | Multi-tenancy — which project this belongs to |
| `source` | text | required | `sdk`, `portal`, `mcp`, `api`, `admin` |
| `ticket_type` | text | required | `bug`, `feature`, `suggestion`, `task`, `enhancement` |
| `title` | text | required | Short summary |
| `description` | text | required | Full details |
| `status` | text | `'new'` | Lifecycle: `new`, `triaged`, `approved`, `in_progress`, `in_review`, `user_review`, `resolved`, `closed` |
| `resolution` | text | null | Only set at resolution/close: `fixed`, `wont_fix`, `duplicate`, `deferred`, `invalid`, `cannot_reproduce` |
| `priority` | text | null | `low`, `medium`, `high`, `critical` |
| `tags` | text[] | `'{}'` | Flexible labels |
| `route` | text | null | Page/component where issue was found |
| `environment` | text | null | `production`, `staging`, `development` — primarily for bugs/enhancements |
| `browser_info` | text | null | Auto-captured from SDK |
| `os_info` | text | null | Auto-captured from SDK |
| `reporter_id` | text | required | External user identifier (or guest ID) |
| `reporter_name` | text | null | Display name |
| `reporter_email` | text | null | For notifications |
| `assignee` | text | null | Who is currently working on it |
| `direction` | text | null | Instructions for the developer/agent working on it |
| `ai_assessment` | text | null | AI triage analysis |
| `ai_solution_proposal` | text | null | AI suggested fix approach |
| `ai_suggested_priority` | text | null | AI priority recommendation |
| `ai_complexity` | text | null | `simple`, `moderate`, `complex` |
| `ai_estimated_files` | text[] | null | Files that likely need changes |
| `autonomy_score` | integer | null | 1-5 confidence for auto-approval |
| `work_priority` | integer | null | Queue ordering (lower = higher priority) |
| `testing_result` | text | null | Latest result: `pending`, `pass`, `fail`, `partial` (history in activity) |
| `needs_followup` | boolean | false | Closed but not fully done — revisit later |
| `followup_notes` | text | null | What needs to be revisited |
| `followup_after` | timestamptz | null | When to revisit (enables "due this week" queries) |
| `parent_id` | uuid | null | FK self-ref — the ticket that spawned this one |
| `client_reference_id` | text | null | SDK-generated ID for idempotent creation |
| `resolved_at` | timestamptz | null | When status first reached `resolved` |
| `created_at` | timestamptz | now() | |
| `updated_at` | timestamptz | now() | Auto-updated on every change |
| `updated_by` | text | null | Who made the last update |
| `deleted_at` | timestamptz | null | Soft delete — null means active |

**Indexes:**

- `(project_id, status)` — pipeline views
- `(project_id, status, created_at)` — sorted pipeline
- `(reporter_id)` — "my tickets" queries
- `(ticket_number)` — human-readable lookups
- `(work_priority) WHERE status = 'approved'` — work queue (partial index)
- `(project_id, client_reference_id) UNIQUE WHERE client_reference_id IS NOT NULL` — idempotent creation
- `(needs_followup, followup_after) WHERE needs_followup = true` — follow-up reminders (partial index)
- `(parent_id)` — child ticket lookups

**Unique constraints:**

- `(project_id, client_reference_id)` where `client_reference_id` is not null

### Table 2: `ticket_activity` — The Complete History

Every meaningful event on a ticket. This is the core of the system.

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | uuid | gen_random_uuid() | PK |
| `ticket_id` | uuid | required | FK → tickets.id |
| `activity_type` | text | required | `comment`, `message`, `status_change`, `field_change`, `decision`, `test_result`, `assignment`, `resolution`, `system` |
| `author_type` | text | required | `user`, `admin`, `agent`, `system` |
| `author_name` | text | null | Display name of the author |
| `content` | text | null | Human-readable text (the comment, message, or description of what happened) |
| `metadata` | jsonb | null | Structured data that varies by activity_type (see below) |
| `visibility` | text | `'internal'` | `internal` or `user_visible` |
| `requires_approval` | boolean | false | Agent drafts needing admin sign-off before becoming user-visible |
| `approved_by` | text | null | Admin who approved (if applicable) |
| `approved_at` | timestamptz | null | When approved |
| `created_at` | timestamptz | now() | |

**Indexes:**

- `(ticket_id, created_at)` — timeline queries (this is the most important index)
- `(ticket_id, activity_type)` — filtered views ("show me all test results for this ticket")
- `(ticket_id, visibility, created_at)` — user-visible timeline

**Metadata Schemas by Activity Type:**

```
status_change: {
  from: string | null,    // previous status (null for initial creation)
  to: string              // new status
}

field_change: {
  field: string,          // which field changed
  from: any,              // previous value
  to: any                 // new value
}

decision: {
  decision: string,       // "approved", "rejected", "deferred"
  direction: string | null // instructions text
}

test_result: {
  result: string,         // "pass", "fail", "partial"
  testing_url: string | null,
  testing_instructions: string | null
}

assignment: {
  from: string | null,    // previous assignee
  to: string | null       // new assignee (null = unassigned)
}

resolution: {
  resolution: string,     // "fixed", "wont_fix", "duplicate", etc.
  notes: string | null    // resolution explanation
}
```

### Table 3: `ticket_attachments` — File Metadata

Files stored on disk (Docker volume). Metadata in the DB.

| Column | Type | Default | Notes |
|---|---|---|---|
| `id` | uuid | gen_random_uuid() | PK |
| `ticket_id` | uuid | required | FK → tickets.id |
| `filename` | text | required | Storage filename (UUID-based) |
| `original_name` | text | required | User's original filename |
| `mime_type` | text | required | |
| `size_bytes` | integer | required | |
| `uploaded_by` | text | required | Who uploaded it |
| `created_at` | timestamptz | now() | |

**Index:** `(ticket_id)`

### Database View: `vw_ticket_timeline`

This is a convenience view that joins ticket info with its activity stream. It's the primary query interface for getting the full story of a ticket.

```sql
CREATE VIEW vw_ticket_timeline AS
SELECT
  t.id AS ticket_id,
  t.ticket_number,
  t.title AS ticket_title,
  t.status AS current_status,
  t.resolution AS current_resolution,
  a.id AS activity_id,
  a.activity_type,
  a.author_type,
  a.author_name,
  a.content,
  a.metadata,
  a.visibility,
  a.requires_approval,
  a.approved_by,
  a.approved_at,
  a.created_at
FROM tickets t
JOIN ticket_activity a ON a.ticket_id = t.id
WHERE t.deleted_at IS NULL
ORDER BY t.id, a.created_at ASC;
```

The service layer will also provide a `getTicketTimeline(ticketId, { visibility?, activityTypes? })` function that uses this view with appropriate filters.

---

## Status Lifecycle

### Status Values (Pipeline Stages)

| Status | Meaning | Who acts next? |
|---|---|---|
| `new` | Just submitted, untouched | Agent (triage) or Admin |
| `triaged` | AI or human has analyzed it | Admin (decision) |
| `approved` | Admin has approved for work | Agent/Developer (pick up) |
| `in_progress` | Someone is actively working on it | Agent/Developer (submit fix) |
| `in_review` | Fix submitted, needs internal verification | Admin (verify) |
| `user_review` | Needs reporter/user input — verification, clarification, testing | User (respond) |
| `resolved` | Verified and done | Admin (close) or auto-close |
| `closed` | Terminal state | — |

### Resolution Values (Only Set at Resolution/Close)

| Resolution | Meaning |
|---|---|
| `fixed` | The issue was addressed |
| `wont_fix` | Intentional decision not to fix |
| `duplicate` | Already covered by another ticket |
| `deferred` | Pushed to a future cycle |
| `invalid` | Not a real issue |
| `cannot_reproduce` | Couldn't replicate the problem |

### Transition Rules

**No rigid state machine.** Any status can transition to any other status. In practice, the typical flow is:

```
new → triaged → approved → in_progress → in_review → user_review → resolved → closed
```

But real work is messy. Tickets get reopened, skip stages, bounce back. The system records every transition in `ticket_activity` as a `status_change` entry, creating a complete audit trail regardless of the path taken.

The service layer MAY log a warning for unusual transitions (e.g., `new` → `resolved`) to catch mistakes, but it does NOT block them.

### Follow-Up System

When closing a ticket that isn't fully done:

1. Set `status = 'closed'` and `resolution = 'fixed'` (or appropriate)
2. Set `needs_followup = true`
3. Set `followup_notes` describing what still needs attention
4. Optionally set `followup_after` to a target date

This allows dashboards to show "closed tickets needing follow-up" and queries like "what follow-ups are due this week?"

### Parent/Child Tickets

- `parent_id` is a soft reference — it records lineage ("this ticket was created because of ticket T-42")
- A parent ticket can be closed while children remain open
- Children are independent tickets with their own lifecycle
- No depth restriction, but typically one level deep
- Use case: Large ticket gets broken into smaller focused tickets. Large ticket is closed (maybe with `needs_followup`), children track the individual work items

---

## Communication Model

All communication flows through the unified `ticket_activity` table.

### Who Can Do What

**Users (reporters):**
- Submit tickets
- View their own tickets
- See activity entries where `visibility = 'user_visible'` AND (`requires_approval = false` OR `approved_at IS NOT NULL`)
- Reply to their own tickets (creates `activity_type: 'message'`, `visibility: 'user_visible'`)
- Upload attachments to their own tickets

**Admins:**
- See everything on all tickets
- Write internal comments (`activity_type: 'comment'`, `visibility: 'internal'`)
- Send messages to users (`activity_type: 'message'`, `visibility: 'user_visible'`)
- Approve agent drafts (sets `approved_by`, `approved_at`)
- Promote internal comments to user-visible (change `visibility` from `internal` to `user_visible`)
- Make all decisions (approve, reject, defer)
- Update any ticket field

**Agents:**
- See everything on all tickets (same read access as admin)
- Write internal comments (`activity_type: 'comment'`, `visibility: 'internal'`)
- Draft user-facing messages (`activity_type: 'message'`, `visibility: 'user_visible'`, `requires_approval: true`) — these remain invisible to users until admin approves
- Perform triage (updates AI fields on ticket + creates `decision` activity entry)
- Submit test results (`activity_type: 'test_result'`)
- Submit fixes/resolutions

### Typical Flow

```
1. User submits ticket
   → activity: { type: 'system', content: 'Ticket created via SDK', visibility: 'user_visible' }
   → ticket.status = 'new'

2. Agent triages
   → activity: { type: 'comment', content: 'Analysis: auth module issue...', visibility: 'internal' }
   → activity: { type: 'status_change', metadata: { from: 'new', to: 'triaged' } }
   → ticket AI fields updated

3. Admin reviews and approves
   → activity: { type: 'decision', content: 'Approved — fix auth module', metadata: { decision: 'approved', direction: '...' } }
   → activity: { type: 'status_change', metadata: { from: 'triaged', to: 'approved' } }

4. Agent picks up work
   → activity: { type: 'assignment', metadata: { from: null, to: 'agent-claude' } }
   → activity: { type: 'status_change', metadata: { from: 'approved', to: 'in_progress' } }

5. Agent has a question, asks internally
   → activity: { type: 'comment', content: 'Should we refactor or patch?', visibility: 'internal' }

6. Admin wants to ask the user for clarification
   → activity: { type: 'message', content: 'Can you confirm which browser?', visibility: 'user_visible' }
   → activity: { type: 'status_change', metadata: { from: 'in_progress', to: 'user_review' } }

7. User responds
   → activity: { type: 'message', content: 'Chrome 120 on Windows', visibility: 'user_visible' }

8. Agent submits fix
   → activity: { type: 'test_result', content: 'Fixed auth redirect', metadata: { result: 'pending', testing_url: '...', testing_instructions: '...' } }
   → activity: { type: 'status_change', metadata: { from: 'in_progress', to: 'in_review' } }

9. Admin tests, it fails
   → activity: { type: 'test_result', content: 'Still failing on Safari', metadata: { result: 'fail' } }
   → activity: { type: 'status_change', metadata: { from: 'in_review', to: 'in_progress' } }

10. Agent fixes again, passes
    → activity: { type: 'test_result', metadata: { result: 'pass' } }
    → activity: { type: 'status_change', metadata: { from: 'in_progress', to: 'in_review' } }

11. Admin resolves and notifies user
    → activity: { type: 'resolution', content: 'Deployed in v2.3.1', metadata: { resolution: 'fixed' } }
    → activity: { type: 'message', content: 'Your issue has been fixed', visibility: 'user_visible' }
    → activity: { type: 'status_change', metadata: { from: 'in_review', to: 'resolved' } }

12. User confirms
    → activity: { type: 'message', content: 'Confirmed working', visibility: 'user_visible' }

13. Ticket closed
    → activity: { type: 'status_change', metadata: { from: 'resolved', to: 'closed' } }
```

At any point, an agent or admin can read the entire timeline and have full context.

---

## Implementation Phases

### Phase 1: Database and Service Layer

**Schema work:**
- Add 3 new tables to `src/lib/db/schema.ts`: `tickets`, `ticket_activity`, `ticket_attachments`
- Create all indexes listed above (including partial indexes for work queue and follow-ups)
- Create the `vw_ticket_timeline` database view
- Run `pnpm db:generate` and `pnpm db:migrate`

**Service layer — `src/lib/services/tickets.ts`:**

Core ticket operations:
- `createTicket(data)` — creates ticket + initial `system` activity entry. Checks `client_reference_id` for idempotency.
- `getTicketById(id)` — returns ticket with current state
- `getTicketByNumber(projectId, number)` — human-readable lookup
- `listTickets(filters)` — paginated list with filters for status, type, priority, tags, assignee, reporter, needs_followup. Supports sorting by created_at, updated_at, work_priority, ticket_number.
- `updateTicket(id, changes, actorInfo)` — updates ticket fields. For every changed field, creates a `field_change` activity entry with before/after values. Sets `updated_by` and `updated_at`.
- `deleteTicket(id, actorInfo)` — soft delete (sets `deleted_at`)

Status and pipeline operations:
- `changeStatus(id, newStatus, actorInfo, notes?)` — updates status, creates `status_change` activity entry. If moving to `resolved`, sets `resolved_at`. If moving to `closed`, prompts for `resolution`.
- `triageTicket(id, triageData, actorInfo)` — sets AI fields on ticket, creates `comment` activity with the assessment, changes status to `triaged`
- `approveTicket(id, direction?, workPriority?, actorInfo)` — creates `decision` activity entry, sets `direction` and `work_priority` on ticket, changes status to `approved`
- `rejectTicket(id, resolution, reason, actorInfo)` — creates `decision` activity entry, changes status to `closed` with the given resolution
- `resolveTicket(id, resolutionNotes, testingInfo?, actorInfo)` — creates `resolution` + `test_result` activity entries, updates `testing_result` on ticket, changes status to `in_review` or `resolved`

Activity operations:
- `addActivity(ticketId, activityData)` — core function, used by everything above. Validates activity_type, sets defaults.
- `addComment(ticketId, content, actorInfo)` — shortcut for internal comment
- `sendMessage(ticketId, content, actorInfo)` — shortcut for user-visible message
- `submitTestResult(ticketId, result, details, actorInfo)` — creates `test_result` entry, updates `testing_result` on ticket
- `approveDraft(activityId, adminInfo)` — sets `approved_by`/`approved_at` on an agent draft
- `promoteToUserVisible(activityId, adminInfo)` — changes `visibility` from `internal` to `user_visible`

Timeline operations (THE KEY FEATURE):
- `getTicketTimeline(ticketId, options?)` — returns the complete chronological activity stream for a ticket. Options:
  - `visibility`: filter to `internal` or `user_visible` (default: all for admin/agent, user_visible for users)
  - `activityTypes`: filter to specific types (e.g., only `test_result` entries)
  - `since`: only entries after a given timestamp (for incremental loading)
- `getTicketTimelineForAgent(ticketId)` — convenience wrapper that returns the full internal timeline in a format optimized for AI consumption (includes all context, formatted clearly)
- `getTicketTimelineForUser(ticketId, reporterId)` — returns only user-visible entries, verifies the reporter owns the ticket

Queue operations:
- `getWorkQueue(projectId)` — approved tickets ordered by `work_priority`, with timeline summary
- `getTriageBatch(projectId, batchSize?)` — untriaged tickets (status = 'new'), default batch of 3
- `getReworkItems(projectId)` — tickets where `testing_result = 'fail'` or `'partial'`
- `getFollowUps(projectId, dueBy?)` — tickets with `needs_followup = true`, optionally filtered by `followup_after <= dueBy`

Attachment operations:
- `uploadAttachment(ticketId, file, uploaderInfo)` — saves file to disk, creates DB record + `system` activity entry
- `getAttachments(ticketId)` — lists all attachments for a ticket

**Stats service — `src/lib/services/ticket-stats.ts`:**
- `getTicketStats(projectId)` — counts by status, type, priority
- `getPipelineCounts(projectId)` — counts per pipeline stage for the admin dashboard
- `getAgentStats(projectId)` — tickets per assignee, average resolution time
- `getFollowUpCount(projectId)` — number of closed tickets needing follow-up

### Phase 2: API Routes

Create REST endpoints at `src/app/api/tickets/` authenticated via the existing API key system plus a new reporter token for user submissions.

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/tickets` | GET, POST | API key or reporter token | List/create tickets |
| `/api/tickets/[id]` | GET, PATCH, DELETE | API key | Get/update/soft-delete ticket |
| `/api/tickets/[id]/timeline` | GET | API key or reporter token | **Full activity timeline** (filtered by auth level) |
| `/api/tickets/[id]/activity` | POST | API key or reporter token | Add activity entry (comment, message, test result) |
| `/api/tickets/[id]/activity/[activityId]/approve` | POST | API key (admin) | Approve an agent draft |
| `/api/tickets/[id]/activity/[activityId]/promote` | POST | API key (admin) | Make internal entry user-visible |
| `/api/tickets/[id]/attachments` | GET, POST | API key or reporter token | File uploads |
| `/api/tickets/triage-batch` | GET | API key | Untriaged items for agents |
| `/api/tickets/work-queue` | GET | API key | Approved items by priority |
| `/api/tickets/rework` | GET | API key | Failed test items |
| `/api/tickets/followups` | GET | API key | Tickets needing follow-up |
| `/api/tickets/stats` | GET | API key | Dashboard statistics |
| `/api/tickets/submit` | POST | Reporter token | Public submission endpoint |

**Reporter token:** A simpler auth for user-facing clients. Generated per-project, included in the SDK config. Only allows: submit tickets, view own tickets, add messages on own tickets, view own timeline (user-visible only), upload attachments on own tickets.

**API Design Notes:**
- All list endpoints support pagination via `?page=1&limit=20`
- All list endpoints support `?sort=created_at&order=desc`
- Ticket list supports `?status=new,triaged&type=bug&priority=high&tags=auth&assignee=agent-claude`
- Timeline endpoint supports `?since=2025-01-01T00:00:00Z&types=comment,message`
- POST to `/api/tickets` with a `client_reference_id` returns the existing ticket if one already exists with that reference (idempotent)

### Phase 3: Admin UI

Replace the "Bug Reports" coming-soon page at `src/app/admin/bug-reports/page.tsx` with a full ticket management UI. Rename the route to `/admin/tickets`.

**Components to build:**

**`TicketTable`** — Pipeline-based view with stage filters:
- Untriaged (status = new)
- Your Decision (status = triaged)
- Agent Working (status = approved or in_progress)
- Ready for Testing (status = in_review)
- User Review (status = user_review)
- Done (status = resolved or closed)
- Follow-ups (needs_followup = true, regardless of status)
- Uses the existing `DataTable` component
- Quick actions: approve, assign, change status inline
- Color-coded priority badges
- Shows ticket number (T-1), title, type, priority, assignee, and time in current status

**`TicketDetailDialog`** — The main ticket view with tabs:
- **Timeline** (default tab, most important) — Chronological activity stream with:
  - Color-coded entries by activity_type
  - Author avatars/badges by author_type
  - Collapsible metadata for status_change, field_change, test_result
  - Inline reply for adding comments or messages
  - "Make visible to user" button on internal entries
  - "Approve" button on agent drafts
  - Filter by activity type
- **Details** — Ticket fields (type, priority, tags, environment, reporter info, etc.) with inline editing
- **AI Analysis** — AI assessment, solution proposal, complexity, estimated files, autonomy score
- **Attachments** — File list with upload dropzone
- **Related** — Parent ticket (if any) and child tickets

**`WorkQueueTab`** — Prioritized agent work queue:
- Shows approved tickets ordered by work_priority
- Drag-to-reorder updates work_priority
- Each item shows: ticket number, title, AI complexity, direction summary, time since approval

**`TicketStats`** — Dashboard cards:
- Total open tickets
- By status (pipeline bar chart)
- By type (bug/feature/task distribution)
- Tickets needing decision
- Failed tests needing rework
- Follow-ups due
- Average time to resolution

**Sidebar update** in `src/app/admin/layout.tsx`: Replace "Bug Reports (Soon)" with "Tickets" link pointing to `/admin/tickets`.

### Phase 4: MCP Endpoint

Create `src/app/api/mcp/route.ts` exposing ticket tools via the MCP protocol.

| Tool | Purpose |
|---|---|
| `submit_ticket` | Create a new ticket |
| `get_ticket` | Retrieve ticket by ID (includes current state) |
| `get_ticket_timeline` | **Get the full chronological activity stream** — this is what agents should call first |
| `get_triage_batch` | Batch of untriaged items |
| `get_work_queue` | Approved items by priority |
| `get_rework_items` | Failed/partial test items |
| `triage_ticket` | Push AI analysis (assessment, solution, priority, complexity, files, autonomy score) |
| `set_decision` | Admin approve/reject/defer with direction |
| `add_comment` | Internal comment |
| `resolve_ticket` | Submit fix for testing (resolution notes + testing info) |
| `get_comments` | Get comments for a ticket (convenience — subset of timeline) |

Auth: API key passed as Bearer token, validated against `api_keys` table.

**Agent Workflow Optimization:** The `get_ticket_timeline` tool is designed so an agent can make ONE call and understand the entire history. The response format should be a clean, chronological narrative that an LLM can easily parse:

```
Ticket T-42: "Auth redirect fails on Safari"
Status: in_progress | Priority: high | Type: bug
Assigned to: agent-claude

Timeline:
[2025-02-01 10:00] SYSTEM: Ticket created via SDK
[2025-02-01 10:00] USER (john@example.com): When I try to log in on Safari...
[2025-02-01 10:30] AGENT (triage-bot): Analysis: The OAuth callback URL doesn't handle...
[2025-02-01 10:30] STATUS: new → triaged
[2025-02-01 11:00] DECISION: Approved by admin — "Fix the Safari redirect handling in auth module"
[2025-02-01 11:00] STATUS: triaged → approved
[2025-02-01 12:00] ASSIGNED: → agent-claude
[2025-02-01 12:00] STATUS: approved → in_progress
[2025-02-01 14:00] AGENT (agent-claude): Fixed redirect in auth/callback.ts...
[2025-02-01 14:00] TEST: result=fail, url=https://staging.example.com
[2025-02-01 14:00] ADMIN: Still failing — check the useragent sniffing
[2025-02-01 14:00] STATUS: in_review → in_progress
```

### Phase 5: User-Facing Portal

Create a lightweight public portal at `/portal` within matrx-ship:

- `/portal` — Landing page with submit form + "Track your ticket" lookup
- `/portal/tickets/[number]` — View ticket status, progress stepper, **user-visible timeline**, messaging thread
- `/portal/submit` — Submission form (reporter ID required — either logged in or guest)

The portal shows:
- Ticket status with a visual progress stepper
- User-visible activity entries in chronological order (the user's view of the timeline)
- A reply input for sending messages
- Attachment upload
- Status change notifications ("Your ticket has been resolved — please verify")

The portal is intentionally minimal and standalone — no sidebar, no admin layout. Uses the same semantic tokens for styling.

### Phase 6: React SDK (Distributable Package)

Create a separate directory `packages/ticket-widget/` containing:

- **`TicketButton`** — Floating bug button that opens a submission form
- **`TicketForm`** — Standalone form component (captures title, description, type, plus auto-captures browser/OS/route)
- **`TicketTracker`** — Embeddable component showing the user's submitted tickets with status tracking and timeline view
- **`TicketProvider`** — Context provider configured with ship URL and reporter token

The package:
- Zero dependency on shadcn/ui — includes its own minimal components
- Ships as ESM + CJS with TypeScript types
- Configurable via `<TicketProvider shipUrl="..." reporterToken="...">`
- Auto-captures browser info, OS, current route
- Supports image upload (paste, drag/drop, file picker)
- Generates `client_reference_id` for each submission to prevent duplicates
- Tailwind-compatible but doesn't require Tailwind (CSS custom properties with sensible defaults)

Distribution: Initially as a copy-in directory. Later, publish to npm as `@matrx/ticket-widget`.

---

## What Changed From v1

| Area | v1 (Original) | v2 (This Plan) |
|---|---|---|
| Communication tables | Two tables: `ticket_comments` + `ticket_messages` | One table: `ticket_activity` — unified chronological history |
| History tracking | No history — just current state | Every status change, field update, decision, and test result recorded |
| Status model | 9 statuses mixing lifecycle and outcome | 8 lifecycle statuses + separate `resolution` field |
| `admin_decision` | Column on ticket | Captured as `decision` activity entry + status change |
| `is_blocked` | Boolean | `needs_followup` + `followup_notes` + `followup_after` |
| `testing_result` | Only latest result | Latest on ticket (denormalized) + full history in activity stream |
| Agent draft approval | Separate table mechanism | Same table, `requires_approval` flag on activity entry |
| Promoting comments | Not possible | Change `visibility` from `internal` to `user_visible` |
| Soft deletes | Not present | `deleted_at` column |
| Update tracking | Not present | `updated_by` column + `field_change` activity entries |
| Duplicate prevention | Not present | `client_reference_id` with unique constraint |
| AI agent readability | Join multiple tables | One `getTicketTimeline()` call returns everything |
| Timeline view | Not a concept | First-class database view + API endpoint + MCP tool |
| State machine | Not defined | Transitions logged but not enforced — flexible |
| Follow-up tracking | Not present | `needs_followup`, `followup_notes`, `followup_after` |

---

## Key Design Principles

1. **Timeline is king.** The activity stream is the single most important feature. Every consumer — UI, agent, API — gets the full story from one query.

2. **Current state is denormalized.** The ticket table holds the latest snapshot for fast filtering. The activity table holds the truth.

3. **Visibility is a spectrum, not a wall.** Internal content can be promoted to user-visible with one update. This encourages agents to write thorough notes knowing the best ones can be shared.

4. **No rigid state machine.** Real work is messy. Log everything, enforce nothing. The audit trail catches mistakes; the pipeline view keeps things organized.

5. **Soft everything.** No hard deletes. Every change creates an activity entry. The system remembers.

6. **AI-agent-first readability.** The timeline format is designed so an LLM can read one response and have full context to act. This is arguably the highest-ROI feature since agents are doing most of the work.
