# Supabase UI Library Evaluation for Matrx Ship

**Date:** 2026-02-26
**Status:** Research Complete
**Decision:** Pending

---

## Executive Summary

This evaluation analyzes whether the Supabase open-source UI library is suitable for providing database management capabilities across the Matrx Ship platform. After thorough research, the conclusion is that **Supabase's offerings are NOT a good fit for Matrx Ship's multi-database management needs**, but there are strong alternatives worth considering.

---

## 1. Understanding the Matrx Ship Database Landscape

Matrx Ship has **at least 4 distinct database contexts** that need management:

| Context | Database | Location | Purpose |
|---------|----------|----------|---------|
| **Ship App** (main server) | PostgreSQL 16 via Drizzle ORM | `src/lib/db/` | Tracks deployments, API keys, logs, tickets, infrastructure metadata |
| **Per-Instance Databases** | PostgreSQL 17 (one per Ship instance) | Docker containers (`ship-{name}-db`) | Each client's Ship instance gets a dedicated DB |
| **Infrastructure DB** | PostgreSQL 17 + pgvector | `infrastructure/postgres/` | Shared platform-level data store |
| **Supabase (backup)** | Supabase Cloud (PostgREST) | `server-manager/src/supabase.js` | Dual-write backup for disaster recovery |

### The Key Challenge

As Matrx Ship grows, clients will create **custom databases** alongside their Ship instance DB. With MCP tool creation and more advanced features planned, the number of databases to manage will multiply. The admin dashboard at `/admin/database/` currently only manages the single Ship App database. We need a solution that scales to N databases per client.

---

## 2. What Supabase Actually Offers (Open Source)

There are **three separate things** people call "Supabase UI":

### 2a. Supabase UI Library (supabase.com/ui)

**What it is:** A shadcn/ui-compatible component registry you install via CLI.

**Available components:**
- Password-based Auth (sign-up, sign-in, password reset)
- Social Auth (OAuth providers)
- File Upload Dropzone
- Realtime Cursor Sharing
- Current User Avatar
- Realtime Avatar Stack
- Realtime Chat
- Infinite Query Hook

**Verdict:** These are **application-level UI components** (auth flows, realtime features). They contain **zero database management UI** — no table editor, no SQL console, no schema browser. Not relevant for our needs.

### 2b. Supabase Embedded Dashboard (supabase/supabase-embedded-dashboard)

**What it is:** A standalone Next.js app with an embeddable `SupabaseManagerDialog` component.

**Features:**
- Database table browsing, record editing, SQL queries
- Auth configuration management
- Storage bucket management
- User management with analytics
- Secrets management
- Logs and analytics
- Performance suggestions
- AI-powered SQL generation (optional, via OpenAI)

**Tech stack:** Next.js, TypeScript, shadcn/ui, React Query, MIT licensed.

**Critical limitation:** Works exclusively through the **Supabase Management API**. This means it **only manages Supabase Cloud-hosted projects**. It cannot connect to arbitrary PostgreSQL databases or self-hosted instances without replicating the entire Management API.

### 2c. Supabase Studio (apps/studio in the monorepo)

**What it is:** The full dashboard at supabase.com/dashboard. A complete Next.js application.

**Features:** Everything — Table Editor, SQL Editor (Monaco), Schema Visualization, RLS Policy Manager, API Docs, Auth Config, Storage, Realtime Inspector, Edge Functions, and more.

**Critical limitations:**
- **Tightly coupled** to the full Supabase stack (PostgREST, GoTrue, Storage API, Realtime, specific Postgres roles like `supabase_admin`)
- **Does NOT support multiple databases** — self-hosted Studio is hard-wired to a single `postgres` database
- **Not embeddable** — deep dependencies on internal state management, API routes, authentication, Stripe billing
- Extracting individual features (Table Editor, SQL Editor) would require massive refactoring
- Internal packages (`packages/ui`, `packages/ui-patterns`) are not published to npm

---

## 3. Why Supabase UI Doesn't Fit Matrx Ship

| Requirement | Supabase UI Library | Embedded Dashboard | Studio |
|-------------|--------------------|--------------------|--------|
| Manage multiple PostgreSQL databases | N/A (no DB UI) | Only Supabase Cloud projects | No (single DB only) |
| Connect to arbitrary Postgres instances | N/A | No (Management API only) | No (requires full Supabase stack) |
| Embeddable in existing Next.js app | Yes (but irrelevant) | Yes, but wrong API | No |
| Works with Drizzle ORM | N/A | No | No |
| Schema management & migrations | N/A | No | Partial |
| Per-client database isolation | N/A | Via separate Supabase projects | No |
| MIT/Apache licensed | Yes | MIT | Apache 2.0 |

**The fundamental problem:** Supabase's database management UI is built for Supabase's own platform, not for managing arbitrary PostgreSQL databases. The embedded dashboard requires the Supabase Management API (cloud-only), and Studio requires the full Supabase infrastructure stack. Neither supports the "connect to any Postgres instance by connection string" model that Matrx Ship needs.

---

## 4. What Matrx Ship Already Has

The current admin dashboard at `/admin/database/` already provides:

- **Table browser** — Lists all tables with row counts, sizes, column counts (`src/app/admin/database/page.tsx`)
- **Schema browser** — Columns, types, indexes, foreign keys, constraints (`src/app/admin/database/schema/page.tsx`)
- **SQL Console** — CodeMirror editor with query execution, results table, history (`src/app/admin/database/query/page.tsx`)
- **Table data viewer** — Paginated row browsing per table (`src/app/admin/database/[table]/page.tsx`)
- **Migration history** — Drizzle migration tracking (`src/app/admin/database/migrations/page.tsx`)
- **Introspection engine** — PostgreSQL catalog queries for metadata (`src/lib/db/introspect.ts`)

**Current limitation:** All of this is hard-wired to the single `DATABASE_URL` connection — the Ship App's own database. There's no way to switch between databases.

---

## 5. Recommended Alternatives

### Option A: Extend the Existing Admin UI (Recommended)

**Approach:** Add a "database connection switcher" to the existing admin dashboard. The introspection engine (`src/lib/db/introspect.ts`) and all the UI pages already work with raw PostgreSQL queries — they just need to accept a configurable connection.

**What to build:**
1. A database registry (table or config) that stores connection strings for all managed databases
2. A connection switcher dropdown in the admin UI header
3. A connection pool manager that creates/caches Drizzle clients per database
4. Extend the existing API routes to accept a `databaseId` parameter

**Pros:**
- Leverages your existing codebase (no new dependencies)
- Stays within your tech stack (Next.js, Drizzle, shadcn/ui)
- Full control over the UX
- Works with any PostgreSQL instance by connection string
- Naturally integrates with the instance provisioning system

**Cons:**
- More features to build (inline editing, schema visualization, RLS management)
- Maintenance burden

**Effort:** Medium — the foundation is already there.

### Option B: Drizzle Studio Embeddable (Commercial)

**What it is:** A framework-agnostic web component of Drizzle Studio that can be embedded in any UI.

**Pros:**
- Already integrated with your ORM (Drizzle)
- Supports multiple databases
- Customizable theming
- Actively maintained

**Cons:**
- **Commercial B2B product** — pricing depends on platform size and whether customer-facing
- Distributed as a private npm package (requires license)
- You'd depend on a vendor for a core feature

**Best for:** If you want a polished database UI quickly and are willing to pay for it.

### Option C: NocoDB or Directus (Already Configured)

You already have Docker Compose configs for both NocoDB and Directus in `infrastructure/`. Both are open-source, self-hosted database management UIs.

**NocoDB:**
- Spreadsheet-like UI for PostgreSQL
- REST and GraphQL APIs auto-generated
- Supports connecting to external databases
- Good for non-technical users
- Can connect to the same Postgres instances your Ship instances use

**Directus:**
- Headless CMS with auto-generated APIs
- Real-time WebSocket support (already configured with Redis)
- Granular role-based access control
- Extension system for custom modules
- More feature-rich but heavier

**Cons for both:**
- Separate applications (not embedded in your admin dashboard)
- Each manages one database per instance (would need multiple instances or a proxy layer for multi-DB)
- Different look and feel from your admin UI

### Option D: PostGUI (Open Source, React)

**What it is:** A React/TypeScript web app that serves as a front-end to any PostgreSQL database using PostgREST.

**Pros:**
- Built-in **database picker** for multiple PostgreSQL databases from a single instance
- React-based, could be adapted/embedded
- Open source

**Cons:**
- Less mature than the other options
- Requires PostgREST as a dependency
- v2 rewrite in progress

---

## 6. Recommendation

**Short-term (now):** Go with **Option A** — extend the existing admin database UI. Add a connection registry and database switcher. The existing introspection engine, SQL console, table browser, and schema viewer already work with raw PostgreSQL — they just need a configurable connection target. This gives you immediate multi-database support without new dependencies.

**Medium-term (as client base grows):** Consider **Option B** (Drizzle Studio embeddable) if the cost of building and maintaining advanced features (inline cell editing, schema visualization, drag-and-drop schema builder, RLS policy management) outweighs the licensing cost. Since you're already on Drizzle ORM, the integration would be natural.

**For non-technical client access:** Keep **Option C** (NocoDB/Directus) as a complementary tool. Deploy one instance per client or use the multi-tenant capabilities for clients who want spreadsheet-like database access without writing SQL.

---

## 7. Architecture Sketch: Multi-Database Admin UI

```
Ship Admin Dashboard (/admin/database)
    │
    ├── Database Switcher (dropdown)
    │   ├── Ship App DB (default)
    │   ├── Client Instance: "aidream" DB
    │   ├── Client Instance: "myapp" DB
    │   ├── Custom DB: "analytics"
    │   └── + Add Connection
    │
    ├── Selected Database Context
    │   ├── Table Browser (existing)
    │   ├── Schema Browser (existing)
    │   ├── SQL Console (existing)
    │   ├── Migration History (existing)
    │   └── Data Viewer (existing)
    │
    └── Connection Manager
        ├── Store connections in infra_instances or new table
        ├── Pool manager (create Drizzle client per connection)
        ├── Health checks per connection
        └── Permission checks (which user can access which DB)
```

### Key Implementation Details

1. **Connection Registry:** Store in the existing `infra_instances` table — each instance already has `postgres_password` and can derive a `DATABASE_URL`
2. **Pool Manager:** Create a singleton that lazily initializes and caches `postgres()` clients per connection string
3. **API Changes:** Add `?db=<instance-name>` query param to all `/api/admin/database/*` routes
4. **UI Changes:** Add a `<DatabaseSwitcher />` component to the admin layout that sets the active DB in React context
5. **Security:** Validate that the current admin user has access to the selected database

---

## 8. Supabase Components Worth Taking

While the full Supabase database UI doesn't fit, individual ideas and patterns are worth borrowing:

- **Monaco Editor for SQL** — Supabase Studio uses Monaco with PostgreSQL syntax highlighting and autocomplete. The current SQL console uses CodeMirror, which is good, but Monaco would be a step up.
- **AI SQL Generation** — The embedded dashboard's optional OpenAI integration for natural language to SQL is a great UX feature to add later.
- **shadcn/ui component patterns** — The embedded dashboard's approach of using shadcn/ui for all UI components aligns with your existing component system.
- **Table Editor UX** — Studio's inline row editing, column type selectors, and constraint managers are good design references.

---

## References

- [Supabase UI Library](https://supabase.com/ui/docs/getting-started/introduction)
- [Supabase Embedded Dashboard](https://github.com/supabase/supabase-embedded-dashboard) (MIT)
- [Supabase Studio Source](https://github.com/supabase/supabase/tree/master/apps/studio) (Apache 2.0)
- [Multi-DB Discussion](https://github.com/orgs/supabase/discussions/37552)
- [Multi-Org Discussion](https://github.com/orgs/supabase/discussions/4907)
- [External DB Discussion](https://github.com/orgs/supabase/discussions/7018)
- [Drizzle Studio Embeddable](https://github.com/drizzle-team/drizzle-studio-npm)
- [PostGUI](https://github.com/priyank-purohit/PostGUI)
- [Mathesar](https://mathesar.org/)
