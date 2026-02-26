# Supabase Studio Evaluation & Database Management Architecture for Matrx Ship

**Date:** 2026-02-26
**Status:** Research Complete — Architectural Plan Ready
**Decision:** Hybrid approach — NocoDB or Mathesar for client-facing data UI + custom provisioning in admin dashboard (see Section 7)

---

## Executive Summary

This evaluation analyzes whether Supabase Studio (the open-source database dashboard) can serve as the database management UI for Matrx Ship clients — specifically non-technical users who need to create, design, and manage databases through a friendly interface.

**Key finding:** Supabase Studio *can* run as a minimal 3-container setup (Studio + postgres-meta + Postgres), but it has critical limitations for our multi-database, multi-tenant use case. A hybrid approach — using NocoDB as the client-facing data management layer while building lightweight provisioning into the Ship admin dashboard — gives the best UX for non-technical users with the least engineering overhead.

---

## 1. The User Journey (What We're Solving For)

```
                          THE FLASHCARD APP CREATOR
                          ─────────────────────────

 1. Discovers AI Matrx → Signs up → Gets AI integrations, workflows
 2. Decides to build a full app → AI assistant scaffolds a project
    (git repo, Next.js template, MCP server, admin dashboard)
 3. Deploys with a few clicks → Gets a running full-stack app at
    https://flashcards.dev.codematrx.com
 4. Needs a database → Goes to dashboard → "Create Database"
    → Schema designed through UI → Tables: users, decks, flashcards
 5. Manages data → Views rows, edits records, exports data
    → All through a spreadsheet-like UI (NO SQL knowledge needed)
```

**Critical constraint:** These users don't know what PostgreSQL, SQL, Docker, or connection strings are. Everything must feel like clicking buttons in a spreadsheet app.

---

## 2. Current State: How Ship Instances Work Today

### Provisioning Flow (already works)

```
CLI: pnpm ship:init my-project "My Project"
  → Server Manager: createInstance()
    → Generates docker-compose.yml + .env
    → Starts 2 containers:
       ├── {name}      (Next.js app, matrx-ship:latest)
       └── db-{name}   (postgres:17-alpine)
    → Drizzle migrations run on first boot
    → Seeds: v1.0.0 record + API key
    → Traefik: HTTPS certificate via Let's Encrypt
    → Live at: https://{name}.dev.codematrx.com
```

### What each instance gets today

| Component | Container | Details |
|-----------|-----------|---------|
| App | `{name}` | Next.js standalone, port 3000, Traefik-routed |
| Database | `db-{name}` | PostgreSQL 17, user=ship, db=ship, docker volume |
| Storage | Docker volume `pgdata` | Persistent across restarts |
| Backups | `/srv/apps/backups/{name}/` | pg_dump SQL files |

### Existing Admin Database UI (`/admin/database/`)

| Page | What it does | File |
|------|-------------|------|
| Table Browser | Lists tables with row counts, sizes | `src/app/admin/database/page.tsx` |
| Schema Browser | Columns, types, indexes, foreign keys | `src/app/admin/database/schema/page.tsx` |
| SQL Console | CodeMirror editor, execute queries, history | `src/app/admin/database/query/page.tsx` |
| Table Viewer | Paginated rows, sorting, delete | `src/app/admin/database/[table]/page.tsx` |
| Migrations | Drizzle migration history | `src/app/admin/database/migrations/page.tsx` |

**Limitation:** Hard-wired to `DATABASE_URL` (the instance's own `ship` database). No multi-database support. No ability to create new databases. Developer-oriented UI (raw SQL).

---

## 3. Supabase Studio: Can It Work?

### What Supabase Studio Is

The full dashboard you see at `supabase.com/dashboard`. Open source (Apache 2.0), part of the `supabase/supabase` monorepo under `apps/studio`.

### Minimal Self-Hosted Setup (3 containers)

Studio can run with just 3 services:

```yaml
services:
  db:
    image: supabase/postgres:15.8.1.085   # or your existing postgres
  meta:
    image: supabase/postgres-meta:v0.95.1  # REST API for pg catalog
    environment:
      PG_META_DB_HOST: db
      PG_META_DB_PASSWORD: ...
  studio:
    image: supabase/studio:latest
    environment:
      STUDIO_PG_META_URL: http://meta:8080
      POSTGRES_PASSWORD: ...
```

Studio talks to `postgres-meta` (a lightweight REST API over the PostgreSQL system catalog). postgres-meta talks to Postgres. No Kong, no GoTrue, no PostgREST needed for basic database management.

### What Works Without the Full Stack

- Table Editor (browse, create, edit, delete rows)
- SQL Editor (Monaco-based, syntax highlighting)
- Schema management (create tables, columns, constraints)
- Database roles and permissions viewer

### What Breaks Without the Full Stack

- Auth management (needs GoTrue)
- Storage management (needs Storage API)
- API documentation (needs PostgREST)
- Realtime inspector (needs Realtime service)
- Edge Functions (needs Edge Runtime)
- Logs/Analytics (needs Logflare/Vector)

### Critical Limitations

| Issue | Impact |
|-------|--------|
| **Single database only** | Studio is hard-wired to one `postgres` database. No switcher. [Discussion #37552](https://github.com/orgs/supabase/discussions/37552) |
| **No multi-tenant support** | Each Studio instance = one database. For N clients, you'd need N Studio instances. |
| **Developer-oriented UX** | Studio assumes SQL knowledge. The table editor is powerful but not "spreadsheet-simple." |
| **Infrastructure overhead** | 2 extra containers per client (Studio + postgres-meta) = significant resource cost at scale |
| **Stubbed env vars** | Many features show errors/empty states without the full stack. Users see broken UI sections. |

### Verdict on Supabase Studio

Studio is an excellent developer tool but the wrong choice for non-technical users who need spreadsheet-like data management. The single-database limitation, developer-oriented UX, and per-client infrastructure overhead make it impractical for Matrx Ship's multi-tenant model.

---

## 4. Alternatives Evaluated

### Mathesar (Strongest fit for transparent Postgres UI)

**What it is:** Open-source spreadsheet-like UI built specifically as a layer over existing PostgreSQL databases. Maintained by a 501(c)(3) nonprofit.

| Aspect | Details |
|--------|---------|
| **UX** | Spreadsheet-like grid — designed for non-technical users |
| **Connect to existing DB** | First-class supported — this is its primary use case |
| **Multiple databases** | Yes — single Mathesar instance connects to multiple Postgres DBs |
| **Schema creation** | Visual table/field creation with types, relations |
| **Row editing** | Inline editing, filtering, sorting, grouping |
| **No proprietary schema** | Works with your data as-is — no NocoDB/Baserow metadata tables |
| **Postgres access control** | Uses native Postgres roles and permissions |
| **Container** | Single container (~200-300MB RAM) |
| **License** | GPL (no row limits, no feature gates) |
| **Import/Export** | CSV/TSV import/export, custom data types (email, URL) |

**Why Mathesar stands out:** Unlike NocoDB/Teable/Baserow which create their own metadata schema in your database, Mathesar uses a separate internal DB for its own metadata and treats your Postgres database as a transparent overlay. Your tables stay exactly as they are.

### NocoDB (Best fit for Airtable-like features)

**What it is:** Open-source Airtable alternative. Spreadsheet UI over any PostgreSQL database.

| Aspect | Details |
|--------|---------|
| **UX** | Spreadsheet/Airtable-like — perfect for non-technical users |
| **Connect to existing DB** | Yes — point it at any Postgres connection string |
| **Multiple databases** | Yes — can connect to multiple external databases |
| **Schema creation** | Visual table/field creation with types, relations |
| **Row editing** | Inline editing, form views, gallery views, kanban |
| **API auto-generation** | REST + GraphQL APIs generated from schema |
| **Views** | Grid, Form, Gallery, Kanban, Calendar |
| **Collaboration** | Role-based access, comments, audit log |
| **Container** | Single container (~500MB with deps) |
| **License** | AGPL-3.0 (free tier has 10k row limit per workspace) |
| **Already configured** | Yes — `infrastructure/nocodb/docker-compose.yml` exists |
| **Caveat** | Creates its own metadata tables in your database |

### Directus (Alternative for CMS-like needs)

Heavier than NocoDB but more extensible. Good for content-heavy applications. Already configured in `infrastructure/directus/`.

### Supabase Embedded Dashboard

MIT-licensed Next.js app with embeddable dialog. Only works through the Supabase Management API (cloud-hosted projects). Not usable for our self-hosted Postgres instances.

### Drizzle Studio Embeddable (Commercial)

Framework-agnostic web component. Multi-database support. Developer-oriented. Commercial B2B pricing.

### PostGUI (Open Source, React)

React app with built-in database picker. Uses PostgREST. Less mature, v2 in progress.

---

## 5. The Real Problem: Two Audiences, Two Needs

| | Non-Technical Client | Platform Admin (You) |
|---|---|---|
| **Goal** | "I want to store my flashcard data" | "I need to see all databases across all instances" |
| **UX need** | Spreadsheet / Airtable | SQL console, schema browser, connection manager |
| **SQL knowledge** | None | Expert |
| **Creates schema by** | Picking field types from dropdown | Writing DDL or Drizzle schema |
| **Manages data by** | Inline editing, forms, filters | SQL queries, bulk operations |
| **Existing solution** | Nothing (gap) | `/admin/database/` (partial) |

These are fundamentally different experiences. Trying to serve both with one UI leads to a compromised experience for everyone.

---

## 6. What Needs to Be Built

### For Non-Technical Clients (the flashcard app creator)

#### A. Database Provisioning (in Ship Admin Dashboard)

The Ship admin dashboard needs a "Database" section with:

```
/admin/databases
  ├── My Databases (list of client's databases)
  │   ├── "Flashcard App" (default ship DB)
  │   └── + Create New Database
  ├── /admin/databases/new
  │   ├── Database name
  │   ├── Template picker (blank, todo app, CRM, e-commerce, etc.)
  │   └── [Create] button
  └── /admin/databases/{id}/manage
      └── Opens NocoDB (embedded or linked)
```

**What "Create New Database" does behind the scenes:**
1. Calls server-manager API to create a new Postgres database in the instance's existing `db-{name}` container (same Postgres, new database — no new containers needed)
2. If a template was selected, runs the template's migration SQL
3. Creates a NocoDB connection to the new database
4. Returns the NocoDB URL for the client to manage their data

#### B. Data Management UI Per-Instance (NocoDB or Mathesar)

Deploy one data management container alongside each Ship instance. Two strong options:

**Option B1: Mathesar** (lighter, transparent Postgres overlay)

```yaml
# Added to each instance's docker-compose.yml
mathesar:
  image: mathesar/mathesar:latest
  container_name: mathesar-{name}
  restart: unless-stopped
  environment:
    MATHESAR_DATABASES: "(ship|postgresql://ship:${POSTGRES_PASSWORD}@db:5432/ship)"
    SECRET_KEY: ${MATHESAR_SECRET_KEY}
  depends_on:
    db:
      condition: service_healthy
  networks:
    - internal
    - proxy
  labels:
    - "traefik.enable=true"
    - "traefik.http.routers.mathesar-{name}.rule=Host(`{name}.dev.codematrx.com`) && PathPrefix(`/data`)"
    - "traefik.http.services.mathesar-{name}.loadbalancer.server.port=8000"
```

**Why Mathesar:**
- Single container (~200-300MB) — lightest option
- Transparent overlay — no proprietary tables added to client databases
- One instance can connect to multiple databases (when client creates new DBs)
- Uses native Postgres roles for access control
- GPL license with no row limits

**Option B2: NocoDB** (richer features, Airtable-like)

```yaml
# Added to each instance's docker-compose.yml
nocodb:
  image: nocodb/nocodb:latest
  container_name: nocodb-{name}
  restart: unless-stopped
  environment:
    NC_DB: "pg://db:5432?u=ship&p=${POSTGRES_PASSWORD}&d=ship"
  depends_on:
    db:
      condition: service_healthy
  networks:
    - internal
    - proxy
  labels:
    - "traefik.enable=true"
    - "traefik.http.routers.nocodb-{name}.rule=Host(`{name}.dev.codematrx.com`) && PathPrefix(`/data`)"
    - "traefik.http.services.nocodb-{name}.loadbalancer.server.port=8080"
```

**Why NocoDB:**
- Richer view types (Grid, Form, Gallery, Kanban, Calendar)
- Form builder lets clients create data entry forms without code
- REST + GraphQL API auto-generation
- Already configured in `infrastructure/nocodb/`
- AGPL license (but 10k row limit on free tier)

**Why either over Supabase Studio:**
- Non-technical users see a familiar spreadsheet, not a developer dashboard
- Both can connect to multiple databases within the same Postgres instance
- Single container vs. Studio + postgres-meta + Kong (~3.6GB)
- No broken UI sections from missing Supabase services

#### C. AI-Assisted Schema Design (the "magic" layer)

The Matrx LLM assistant should be able to:

1. **Understand the client's app idea** — "I'm building a flashcard app"
2. **Propose a schema** — users, decks, flashcards, study_sessions, progress
3. **Generate the migration SQL** — CREATE TABLE statements
4. **Execute it** — Create the tables in the client's database
5. **Configure NocoDB** — Set up views, forms, and relations

This is the biggest differentiator. The user never sees SQL or thinks about data types. They describe what they want, the AI creates it, and they see it in NocoDB's spreadsheet UI.

### For Platform Admins (Internal Team)

#### D. Multi-Database Connection Manager (in existing admin UI)

Extend the current `/admin/database/` with a connection switcher:

1. **Connection Registry** — New `managed_databases` table:
   ```sql
   CREATE TABLE managed_databases (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     instance_name TEXT NOT NULL,
     database_name TEXT NOT NULL,
     display_name TEXT NOT NULL,
     connection_string TEXT NOT NULL,  -- encrypted
     created_at TIMESTAMPTZ DEFAULT NOW(),
     template TEXT  -- which template was used
   );
   ```

2. **Database Switcher** — Dropdown in admin header selecting which database to inspect
3. **Pool Manager** — Lazy-create `postgres()` clients per connection string, cache and reuse
4. **API parameter** — All `/api/admin/database/*` routes accept `?db=<id>`

---

## 7. Recommended Architecture

### Phase 1: Foundation (Immediate)

```
Per Ship Instance (existing)         New Addition
─────────────────────────            ───────────────
┌──────────────┐                     ┌──────────────┐
│  {name}      │  Next.js app        │  nocodb-     │  Spreadsheet UI
│  (app)       │  Admin dashboard    │  {name}      │  at /data/*
│  port 3000   │  + DB provisioning  │  port 8080   │
└──────┬───────┘                     └──────┬───────┘
       │                                     │
       │         ┌───────────────┐           │
       └────────►│  db-{name}   │◄───────────┘
                 │  PostgreSQL   │
                 │  ┌──────────┐│
                 │  │ ship (db)││  ← default instance DB
                 │  │ flash (db)││  ← client-created DB
                 │  │ crm (db) ││  ← client-created DB
                 │  └──────────┘│
                 └──────────────┘
```

**Changes needed:**
1. **Server Manager:** New API endpoint `POST /api/instances/{name}/databases` — creates a new database in the instance's existing Postgres container
2. **Ship Admin UI:** New `/admin/databases` page — list databases, create new ones, link to NocoDB
3. **Docker Compose Generator:** Add NocoDB service to generated compose files
4. **NocoDB Integration:** Auto-configure NocoDB with new database connections

### Phase 2: AI-Assisted Schema Design

- LLM assistant in the admin dashboard for schema creation
- Template library for common app types (todo, CRM, e-commerce, flashcards)
- Visual schema preview before execution

### Phase 3: Advanced Features

- Backup/restore per database (not just per instance)
- Database cloning and migration tools
- Usage analytics and quota management
- Connection sharing between instances (for shared data)

---

## 8. Implementation Checklist

### Server Manager Changes

- [ ] `POST /api/instances/{name}/databases` — Create new database in instance Postgres
- [ ] `GET /api/instances/{name}/databases` — List all databases in instance Postgres
- [ ] `DELETE /api/instances/{name}/databases/{db}` — Drop database (with confirmation)
- [ ] `POST /api/instances/{name}/databases/{db}/query` — Execute SQL against specific database
- [ ] Update `generateCompose()` to include NocoDB service
- [ ] Update `createInstance()` to start NocoDB alongside app + db

### Ship Admin UI Changes

- [ ] New `/admin/databases` page — Database listing and creation
- [ ] New `/admin/databases/new` page — Create database wizard
- [ ] NocoDB iframe/link integration from database list
- [ ] Database switcher in existing `/admin/database/*` pages (for power users)
- [ ] Connection pool manager (`src/lib/db/pool-manager.ts`)

### Schema & Migrations

- [ ] New `managed_databases` table in Drizzle schema
- [ ] Migration for the new table
- [ ] Template SQL files for common schemas (`drizzle/templates/`)

### Infrastructure

- [ ] NocoDB Docker image in base build
- [ ] Traefik routing rules for NocoDB (`/data` path prefix)
- [ ] NocoDB auth integration (tie to Ship admin session)

---

## 9. Why NOT Full Supabase Studio

| Factor | Supabase Studio | Mathesar | NocoDB | Our Hybrid |
|--------|----------------|----------|--------|------------|
| UX for non-technical users | Developer-oriented | Spreadsheet | Airtable-like | Best of both |
| Multi-database | No (1 DB per instance) | Yes (first-class) | Yes | Yes |
| Containers per client | +5-6 (min) | +1 | +1 | +1 |
| Memory per client | ~3.6GB (min with Kong) | ~200-300MB | ~500MB | ~200-500MB |
| Broken UI sections | Yes (without full stack) | No | No | No |
| Proprietary schema in DB | Yes (roles, schemas) | No (transparent) | Yes (metadata tables) | Depends on choice |
| API auto-generation | No (needs PostgREST) | No | Yes (REST + GraphQL) | Depends on choice |
| Form builder | No | No | Yes | Depends on choice |
| SQL console | Yes (Monaco) | No (planned) | Basic | Yes (existing) |
| License | Apache 2.0 | GPL | AGPL (10k row limit) | Mixed |
| Row limits | None | None | 10k free tier | None |

---

## 10. References

- [Supabase Studio Source](https://github.com/supabase/supabase/tree/master/apps/studio) (Apache 2.0)
- [Supabase Self-Hosting Docs](https://supabase.com/docs/guides/self-hosting/docker)
- [postgres-meta](https://github.com/supabase/postgres-meta)
- [Supabase Embedded Dashboard](https://github.com/supabase/supabase-embedded-dashboard) (MIT)
- [Multi-DB Discussion](https://github.com/orgs/supabase/discussions/37552)
- [External DB Discussion](https://github.com/orgs/supabase/discussions/7018)
- [Mathesar](https://mathesar.org/) — [GitHub](https://github.com/mathesar-foundation/mathesar) (GPL)
- [NocoDB](https://github.com/nocodb/nocodb) (AGPL-3.0)
- [Teable](https://github.com/teableio/teable) (AGPL)
- [Baserow](https://github.com/baserow/baserow) (MIT open-core)
- [Directus](https://github.com/directus/directus) (BSL-1.1)
- [Supabase UI Library](https://supabase.com/ui/docs/getting-started/introduction)
- [Drizzle Studio Embeddable](https://github.com/drizzle-team/drizzle-studio-npm)
