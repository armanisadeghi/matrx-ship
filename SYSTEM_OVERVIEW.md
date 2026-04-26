# Matrx Ship -- System Overview

Universal deployment, version tracking, environment management, and infrastructure orchestration for all Matrx projects. One repository powers a full-stack platform: a CLI that installs into any project, per-project admin portals backed by PostgreSQL, a centralized server manager, a deploy server for resilience, and infrastructure templates that provision an entire server from scratch.

---

## What This Repository Contains

| Component | Location | Purpose |
|-----------|----------|---------|
| **CLI** | `cli/` | Installed into other projects to ship versions, sync environments, and provision instances |
| **Ship App** | `src/` | Next.js admin portal + API -- one instance deployed per project |
| **Server Manager** | `server-manager/` | Express + MCP server that manages all Ship instances on a host |
| **Deploy Server** | `deploy/` | Next.js UI for rebuilding, rolling back, and emergency-recovering the Server Manager |
| **Admin UI Library** | `packages/admin-ui/` | Shared React component library used by the admin portals |
| **Ticket Widget SDK** | `packages/ticket-widget/` | Embeddable React SDK for submitting and tracking tickets from any app |
| **Infrastructure Templates** | `infrastructure/` | Bootstrap scripts, Traefik, PostgreSQL, agent environments, networking |
| **Database Migrations** | `drizzle/` | Drizzle ORM schema and migrations for the Ship app database |
| **Ops Runbooks** | `docs/ops/` | Seven operational documents covering architecture through disaster recovery |

---

## Architecture at a Glance

```
Developer's Machine                        Matrx Server (/srv)
┌──────────────────────┐     ┌────────────────────────────────────────────┐
│ Any Project Repo     │     │  Traefik (reverse proxy, auto-SSL)        │
│ ├── scripts/matrx/   │     │  PostgreSQL 16 (shared database engine)   │
│ │   ├── ship.ts      │────>│  Server Manager (Express + MCP)           │
│ │   ├── env-sync.sh  │     │  Deploy Server (Next.js rebuild UI)       │
│ │   └── .matrx.json  │     │  ┌──────────────────────────────────┐     │
│ └── .env.local       │     │  │ Ship Instance: project-a         │     │
└──────────────────────┘     │  │  Next.js + own PostgreSQL DB     │     │
                             │  │  /admin portal, /api, /portal    │     │
                             │  ├──────────────────────────────────┤     │
                             │  │ Ship Instance: project-b         │     │
                             │  │  Next.js + own PostgreSQL DB     │     │
                             │  └──────────────────────────────────┘     │
                             │  Agent Environments (optional sysbox)     │
                             └────────────────────────────────────────────┘
```

Each project gets its own Ship instance (a Docker container running the Next.js app with its own database). The CLI in each project talks to its instance's API. The Server Manager orchestrates all instances. The Deploy Server watches over the Server Manager itself.

---

## 1. CLI (`cli/`)

The CLI is the primary developer-facing tool. It is installed into other projects (not run from this repo directly in production) and provides two main capabilities: **Ship** (version tracking + deployment) and **Env-Sync** (Doppler secret management).

### Installation

```bash
# Install into any project
curl -sL https://raw.githubusercontent.com/armanisadeghi/matrx-ship/main/cli/install.sh | bash
```

The installer detects the project type (Node/Python/other), downloads CLI files to `scripts/matrx/`, registers commands in `package.json` or `Makefile`, and walks through configuration to produce `.matrx.json`.

### Ship Commands

Ship bumps the semantic version, records it in the project's Ship instance database, commits, and pushes -- all in one command.

| Action | pnpm (Node) | make (non-Node) | bash (any) |
|--------|-------------|------------------|------------|
| Patch bump + ship | `pnpm ship "msg"` | `make ship MSG="msg"` | `bash scripts/matrx/ship.sh "msg"` |
| Minor bump | `pnpm ship:minor "msg"` | `make ship-minor MSG="msg"` | `bash scripts/matrx/ship.sh --minor "msg"` |
| Major bump | `pnpm ship:major "msg"` | `make ship-major MSG="msg"` | `bash scripts/matrx/ship.sh --major "msg"` |
| Auto-provision instance | `pnpm ship:init PROJECT "Name"` | `make ship-init ARGS='...'` | `bash scripts/matrx/ship.sh init PROJECT "Name"` |
| Save server credentials | `pnpm ship:setup --token TOKEN` | `make ship-setup ARGS='...'` | `bash scripts/matrx/ship.sh setup --token TOKEN` |
| Import git history | `pnpm ship:history` | `make ship-history` | `bash scripts/matrx/ship.sh history` |
| Show current version | `pnpm ship status` | `make ship-status` | `bash scripts/matrx/ship.sh status` |
| Force remove instance | `pnpm ship:force-remove INST` | -- | `bash scripts/matrx/ship.sh force-remove INST` |

**How a ship works:**
1. CLI reads `.matrx.json` for the instance URL and API key.
2. Collects git metadata: commit hash, message, lines added/deleted, files changed.
3. POSTs to the Ship instance at `/api/ship` with the bump type and metadata.
4. Instance bumps the version in its database and returns the new version number.
5. CLI stages changes, commits as `Ship vX.Y.Z: message`, and pushes to origin.

### Env-Sync Commands

Safely merges secrets between Doppler and local `.env` files. Normal pulls/pushes never overwrite -- they only add new keys. Force variants do a full overwrite.

| Action | Command |
|--------|---------|
| Merge Doppler to local | `pnpm env:pull` |
| Merge local to Doppler | `pnpm env:push` |
| Show differences | `pnpm env:diff` |
| Quick summary | `pnpm env:status` |
| Interactive sync | `pnpm env:sync` |
| Overwrite local with Doppler | `pnpm env:pull:force` |
| Overwrite Doppler with local | `pnpm env:push:force` |

### Configuration (`.matrx.json`)

```json
{
  "ship": {
    "url": "https://myproject.dev.codematrx.com",
    "apiKey": "sk_ship_..."
  },
  "env": {
    "doppler": { "project": "my-project", "config": "dev" },
    "file": ".env.local",
    "localKeys": ["DATABASE_URL"]
  }
}
```

### Key Files

| File | Purpose |
|------|---------|
| `cli/ship.ts` | Main CLI entry point (TypeScript, runs via tsx) |
| `cli/ship.sh` | Bash wrapper for non-Node projects |
| `cli/env-sync.sh` | Doppler synchronization script |
| `cli/install.sh` | Installer (downloads CLI into other projects) |
| `cli/migrate.sh` | Migration tool from old `matrx-dev-tools` |
| `cli/lib/colors.sh` | Terminal color utilities |
| `cli/lib/utils.sh` | Shared shell helpers |
| `cli/templates/` | Example config files |

---

## 2. Ship App -- Admin Portal + API (`src/`)

The Ship app is a Next.js 16.1 application. Each project that uses Matrx Ship gets its own running instance of this app, deployed as a Docker container with its own PostgreSQL database.

### Tech Stack

- Next.js 16.1 (App Router) + React 19.2 + TypeScript 5.9
- PostgreSQL 16 + Drizzle ORM
- Tailwind CSS 4.1 + Radix UI + shadcn
- MCP SDK (Model Context Protocol for AI agent integration)
- Pino (structured logging)

### API Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/ship` | API Key | Receive a new version from the CLI |
| GET | `/api/version` | None | Current deployed version |
| GET | `/api/version/history` | None | Paginated version history |
| GET | `/api/version/stats` | None | Deployment statistics |
| POST | `/api/webhooks/vercel` | Webhook secret | Sync Vercel deployment status |
| POST | `/api/webhooks/github` | Webhook secret | GitHub push events |
| GET | `/api/health` | None | Health check |
| GET | `/api/logs/*` | API Key | Structured log retrieval |
| POST | `/api/tickets/*` | Various | Ticket management endpoints |
| POST | `/api/mcp` | API Key | MCP protocol endpoint for AI agents |

### Admin Portal (`/admin`)

A full admin dashboard accessible at each instance's `/admin` path:

- **Dashboard** -- Current version, deployment status, quick stats
- **Versions** -- Complete version history with pagination and details
- **Statistics** -- Deployment metrics broken down by time period
- **Deployments** -- Status timeline with links to Vercel deployments
- **Database** -- Query builder, schema explorer, table viewer
- **Tickets** -- Pipeline view for managing submitted issues (triage, approve, assign, resolve)
- **Logs** -- Application log viewer with filtering
- **Health** -- System health checks
- **Settings** -- Configuration management

### Public Portal (`/portal`)

- **Ticket Submission** -- Users can submit bugs, feature requests, and suggestions
- **Ticket Tracking** -- Look up status by ticket number (T-001, T-002, etc.)

### Database Schema

Managed by Drizzle ORM with migrations in `drizzle/`:

| Table | Purpose |
|-------|---------|
| `app_version` | Version history -- version string, build number, git commit, lines changed, deployment status, Vercel links |
| `api_keys` | CLI authentication keys (`sk_ship_` prefix, auto-generated if not set) |
| `logs` | Structured application logs with level, source, metadata, request/trace IDs |
| `tickets` | Issue tracking -- type, status pipeline, priority, AI triage fields, assignee, resolution |
| `ticket_activity` | Timeline entries -- comments, status changes, test results, with visibility and approval controls |
| `ticket_attachments` | File uploads attached to tickets |

### Ticket System

A built-in issue tracking system with AI integration:

1. **Pipeline:** New -> Triaged -> Approved -> Working -> Completed
2. **AI Triage:** MCP tools let AI agents analyze tickets, suggest priority/complexity, and estimate affected files
3. **Autonomy Scoring:** Tickets scored 1-5; scores of 4-5 can be auto-approved
4. **Work Queue:** Prioritized list of approved tickets ready for work
5. **Activity Timeline:** Chronological record of all comments, status changes, and test results
6. **Embeddable Widget:** `@matrx/ticket-widget` React SDK adds ticket submission to any app

---

## 3. Server Manager (`server-manager/`)

An Express.js application that serves as the central control plane for all Ship instances running on a host machine. It also implements the Model Context Protocol (MCP) for AI agent access.

### What It Manages

- **Instances** -- Create, delete, restart, rebuild Ship containers. Each instance gets its own directory under `/srv/apps/`, its own Docker Compose file, environment file, and database.
- **Builds** -- Build history, rebuild from source, rollback to previous images, cleanup old images.
- **Database Operations** -- Execute queries, list tables, health checks against any instance's database.
- **Backups** -- Database dumps to S3, image snapshots, restore operations.
- **Sandboxes** -- Manage sandbox containers for isolated environments.
- **Tokens** -- Create and manage API tokens with role-based access (admin, deployer, viewer).
- **System Info** -- CPU, memory, disk usage, Docker status.

### Authentication

```bash
# Multiple tokens supported, comma-separated
MANAGER_TOKENS=token1,token2,token3

# Legacy single-token mode
MANAGER_BEARER_TOKEN=single-token

# Per-token roles stored in tokens.json
# Roles: admin, deployer, viewer
```

### MCP Integration

The `/mcp` endpoint exposes tools that AI agents can call:
- System status and health
- Instance management
- Database queries
- Build operations
- Backup/restore

### Host Access

The Server Manager runs in Docker but mounts host paths:
- `/host-srv` -> `/srv` on the host (app directories, configs, Traefik)
- `/host-data` -> `/data` on the host (backups, persistent storage)
- Docker socket mounted for container management

### Key Files

| File | Purpose |
|------|---------|
| `server-manager/src/index.ts` | Express server entry point |
| `server-manager/src/mcp/` | MCP protocol implementation |
| `server-manager/src/routes/` | API route handlers |
| `server-manager/src/services/` | Business logic (instances, builds, backups) |

---

## 4. Deploy Server (`deploy/`)

A Next.js application that provides a web interface for managing the Server Manager and infrastructure. Its primary purpose is resilience: if the Server Manager has issues, the Deploy Server can reset and redeploy it.

### Pages

| Page | Purpose |
|------|---------|
| **Deploy** | Trigger rebuilds of any component, view streaming build logs |
| **Docker** | Docker image management and cleanup |
| **Instances** | View all running services and containers |
| **Infrastructure** | Network status, Traefik configuration |
| **History** | Build and deployment history with timestamps |
| **Manager** | Server Manager status, logs, restart controls |
| **Emergency** | Disaster recovery operations (reset Manager, rebuild from scratch) |
| **Docs** | Auto-generated API documentation |

### Key Capabilities

- **Rebuild the Server Manager** -- If the manager crashes or becomes unresponsive, the Deploy Server can rebuild and restart it.
- **Self-Rebuild** -- The Deploy Server can even rebuild itself.
- **Streaming Build Logs** -- SSE-based real-time log output during builds.
- **Rollback** -- Revert to any previous build.
- **S3 Backup Integration** -- Trigger and manage database backups.

### Authentication

```bash
DEPLOY_TOKENS=token1,token2,token3  # Comma-separated bearer tokens
```

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Health check (no auth) |
| GET | `/api/system` | System information |
| GET | `/api/build-info` | Current build information |
| GET | `/api/build-history` | Build history |
| POST | `/api/rebuild` | Trigger a rebuild |
| POST | `/api/rebuild/stream` | Streaming rebuild with SSE logs |
| POST | `/api/rollback` | Rollback to a previous build |
| GET | `/api/instances` | List all running instances |
| POST | `/api/self-rebuild` | Rebuild the Deploy Server itself |

---

## 5. Infrastructure Templates (`infrastructure/`)

Everything needed to provision a complete Matrx server from a bare Ubuntu machine.

### Bootstrap Script (`bootstrap.sh`)

A comprehensive shell script that automates full server provisioning:

1. System packages (Docker, Docker Compose, UFW, Fail2Ban, jq, htop)
2. Docker Engine installation and configuration
3. Docker Compose v2 setup
4. Docker network creation (`proxy` bridge network)
5. Traefik reverse proxy with automatic HTTPS via Let's Encrypt
6. PostgreSQL 16 with pgAdmin web interface
7. Server Manager container deployment
8. Deploy Server container deployment
9. Database initialization and migrations
10. SSL certificate provisioning

**Usage:**
```bash
# Configure secrets
cp infrastructure/.env.bootstrap.example infrastructure/.env.bootstrap
# Edit .env.bootstrap with your values
sudo bash infrastructure/bootstrap.sh
```

### Traefik -- Reverse Proxy (`infrastructure/traefik/`)

- `traefik.yml` -- Static config: dashboard, HTTP/HTTPS entry points, Let's Encrypt resolver, Docker provider
- `dynamic/tls.yml` -- TLS settings and minimum version
- `docker-compose.yml` -- Traefik service definition
- Automatic HTTPS for all containers via Docker labels
- HTTP-to-HTTPS redirect on all traffic

### PostgreSQL (`infrastructure/postgres/`)

- `docker-compose.yml` -- PostgreSQL 16 + pgAdmin service definitions
- `init/01-extensions.sql` -- Database extensions loaded on initialization
- Shared database engine used by all Ship instances (each gets its own database)
- pgAdmin web interface for database administration

### Agent Environments (`infrastructure/agent-envs/`)

Docker Compose templates for spinning up isolated AI agent containers:

- Uses `sysbox-runc` runtime for nested Docker-in-Docker support
- Configurable agent containers (agent-1, agent-2, etc.)
- Resource limits: 4 CPUs, 8GB RAM per agent
- Traefik labels for web terminal access via ttyd
- Docker Compose profiles for selective startup

### Network (`infrastructure/network/`)

- `setup.sh` -- Creates the `proxy` Docker network that all containers join
- Enables container-to-container DNS resolution
- Required for Traefik's automatic service discovery

### Scripts (`infrastructure/scripts/`)

- `request-certificate.sh` -- Manual SSL certificate management

### Teardown (`teardown.sh`)

Removes all infrastructure components (reverse of bootstrap). Used for clean server resets.

### Server Directory Layout (After Bootstrap)

```
/srv/
├── traefik/                    # Reverse proxy config and certs
│   ├── traefik.yml
│   ├── dynamic/tls.yml
│   ├── acme/acme.json          # Let's Encrypt certificates
│   └── docker-compose.yml
├── postgres/                   # Shared database engine
│   ├── docker-compose.yml
│   ├── init/01-extensions.sql
│   └── pgdata/                 # Data volume
├── apps/                       # All application containers
│   ├── deploy/                 # Deploy Server
│   ├── server-manager/         # Server Manager
│   ├── {instance-name}/        # One directory per Ship instance
│   │   ├── .env
│   │   ├── docker-compose.yml
│   │   ├── Dockerfile
│   │   └── pgdata/
│   ├── deployments.json        # Instance registry
│   ├── tokens.json             # Managed API tokens
│   └── build-history.json      # Build log
└── projects/                   # Git repositories
    └── matrx-ship/             # This repo (cloned by bootstrap)
```

---

## 6. Shared Packages (`packages/`)

### Admin UI (`packages/admin-ui/`)

A React component library providing reusable admin dashboard UI elements. Used by the Ship app's admin portal and available for other Matrx admin interfaces.

**Exports:**
- `./components/*` -- Page shells, admin layout, build log viewer, code block, theme toggle, markdown renderer
- `./ui/*` -- Low-level components (table, button, card, dialog, dropdown, input, badge, etc.)
- `./lib/*` -- Utilities (CSS class merging via `clsx` + `tailwind-merge`)
- `./styles/*` -- Tailwind-based style system

### Ticket Widget (`packages/ticket-widget/`)

A React SDK for embedding ticket submission and tracking into any application.

**Components:**
- `TicketButton` -- Floating button that opens a ticket submission form
- `TicketTracker` -- Status display component for looking up ticket progress
- `TicketProvider` -- Context wrapper for authentication and configuration

---

## 7. How the Pieces Fit Together

### Provisioning a New Project

```
Developer                CLI               Server Manager          Host Machine
   │                      │                      │                      │
   ├── ship:setup ────────>│                      │                      │
   │   (save token)       │                      │                      │
   │                      │                      │                      │
   ├── ship:init ─────────>│                      │                      │
   │   "my-project"       ├── POST /instances ──>│                      │
   │                      │                      ├── mkdir /srv/apps/x ─>│
   │                      │                      ├── generate API key    │
   │                      │                      ├── generate DB pass    │
   │                      │                      ├── write .env ────────>│
   │                      │                      ├── docker compose up ─>│
   │                      │                      │                      ├── build image
   │                      │                      │                      ├── start container
   │                      │                      │                      ├── run migrations
   │                      │<── URL + API key ────┤                      │
   │                      │                      │                      │
   │<── writes .matrx.json┤                      │                      │
   │                      │                      │                      │
   │   Ready to ship!     │                      │                      │
```

### Daily Shipping Flow

```
Developer                CLI               Ship Instance           Database
   │                      │                      │                      │
   ├── pnpm ship "msg" ──>│                      │                      │
   │                      ├── read .matrx.json   │                      │
   │                      ├── collect git info    │                      │
   │                      ├── POST /api/ship ───>│                      │
   │                      │   {bump, commit,     ├── validate API key   │
   │                      │    lines, files}     ├── read latest ver ──>│
   │                      │                      ├── bump version       │
   │                      │                      ├── INSERT ───────────>│
   │                      │<── {version: 1.2.4} ─┤                      │
   │                      ├── git add .          │                      │
   │                      ├── git commit         │                      │
   │                      ├── git push           │                      │
   │<── Shipped v1.2.4 ───┤                      │                      │
```

### Resilience Chain

```
Deploy Server ──watches──> Server Manager ──manages──> Ship Instances
     │                          │
     ├── Can rebuild Manager    ├── Can rebuild any instance
     ├── Can rollback Manager   ├── Can rollback any instance
     ├── Can self-rebuild       ├── Manages tokens and access
     └── Emergency recovery     └── S3 backups and restore
```

If a Ship instance fails, the Server Manager can rebuild it. If the Server Manager fails, the Deploy Server can rebuild it. The Deploy Server can even rebuild itself.

---

## 8. Environment Variables

### Ship Instance

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `MATRX_SHIP_API_KEY` | No | API key for CLI auth (auto-generated if blank) |
| `MATRX_SHIP_ADMIN_SECRET` | No | Admin portal secret (defaults to API key) |
| `PROJECT_NAME` | No | Display name in the admin portal |
| `VERCEL_ACCESS_TOKEN` | No | Vercel deployment sync |
| `VERCEL_PROJECT_ID` | No | Vercel project identifier |
| `VERCEL_WEBHOOK_SECRET` | No | Vercel webhook verification |
| `GITHUB_WEBHOOK_SECRET` | No | GitHub webhook verification |

### Server Manager

| Variable | Required | Description |
|----------|----------|-------------|
| `MANAGER_TOKENS` | Yes | Comma-separated bearer tokens |
| `MANAGER_BEARER_TOKEN` | No | Legacy single token (fallback) |
| `SUPABASE_URL` | No | Optional Supabase for persistence |
| `SUPABASE_SERVICE_ROLE_KEY` | No | Supabase service role key |
| `AWS_ACCESS_KEY_ID` | No | S3 backup credentials |
| `AWS_SECRET_ACCESS_KEY` | No | S3 backup credentials |
| `S3_BACKUP_BUCKET` | No | S3 bucket name for backups |

### Deploy Server

| Variable | Required | Description |
|----------|----------|-------------|
| `DEPLOY_TOKENS` | Yes | Comma-separated bearer tokens |
| `AWS_ACCESS_KEY_ID` | No | S3 backup credentials |
| `AWS_SECRET_ACCESS_KEY` | No | S3 backup credentials |
| `HOST_SRV_PATH` | No | Host mount path (default: `/host-srv`) |

### CLI (in the target project)

| Variable | Description |
|----------|-------------|
| `MATRX_SHIP_SERVER` | Manager URL (default: `https://manager.dev.codematrx.com`) |
| `MATRX_SHIP_SERVER_TOKEN` | Token for provisioning new instances |
| `MATRX_SHIP_URL` | Instance URL (overrides `.matrx.json`) |
| `MATRX_SHIP_API_KEY` | Instance API key (overrides `.matrx.json`) |

---

## 9. Existing Documentation

| Document | Location | Covers |
|----------|----------|--------|
| Project README | `README.md` | Overview, CLI reference, API endpoints, tech stack |
| CLI README | `cli/README.md` | Detailed CLI usage |
| Manual Deployment | `DEPLOY.md` | Deploying individual Ship instances via Docker |
| Server Bootstrap | `SERVER_BOOTSTRAP.md` | Full server provisioning from scratch |
| CI/CD Setup | `CICD-SETUP.md` | Pipeline configuration |
| Ticket System | `TICKET_SYSTEM_DOCS.md` | Ticket management features |
| Environment Variables | `infrastructure/env-vars.md` | Complete variable reference |
| Architecture | `docs/ops/01-architecture.md` | System architecture details |
| Deployment Commands | `docs/ops/02-deployment-commands.md` | Operational deployment commands |
| Disaster Recovery | `docs/ops/03-disaster-recovery.md` | Recovery procedures |
| Environment Variables | `docs/ops/04-environment-variables.md` | Variable reference (ops perspective) |
| Runbooks | `docs/ops/05-runbooks.md` | Operational runbooks |
| New Instance Setup | `docs/ops/06-new-instance-setup.md` | Instance provisioning guide |
| Certificate Troubleshooting | `docs/ops/07-certificate-troubleshooting.md` | SSL/TLS certificate issues |

---

## 10. Tech Stack Summary

| Layer | Technology |
|-------|------------|
| **Ship App** | Next.js 16.1, React 19.2, TypeScript 5.9 |
| **Server Manager** | Express 5.1, MCP SDK 1.12, Zod |
| **Deploy Server** | Next.js (App Router) |
| **Database** | PostgreSQL 16, Drizzle ORM |
| **Styling** | Tailwind CSS 4.1, Radix UI, shadcn |
| **Containerization** | Docker, Docker Compose |
| **Reverse Proxy** | Traefik (automatic HTTPS, Let's Encrypt) |
| **Secrets Management** | Doppler (via CLI env-sync) |
| **Backups** | AWS S3 |
| **Logging** | Pino (structured JSON) |
| **Package Manager** | pnpm 10.29 (workspaces) |
| **Agent Runtime** | sysbox-runc (nested Docker) |

---

## 11. Repository File Map

```
matrx-ship/
├── cli/                           # CLI tools (installed into other projects)
│   ├── ship.ts                    #   Main ship CLI (TypeScript)
│   ├── ship.sh                    #   Bash wrapper for non-Node projects
│   ├── env-sync.sh                #   Doppler environment sync
│   ├── install.sh                 #   Installer for other projects
│   ├── migrate.sh                 #   Migration from old tooling
│   ├── lib/                       #   Shell utilities (colors, helpers)
│   └── templates/                 #   Config file examples
├── src/                           # Ship app source (Next.js)
│   └── app/
│       ├── admin/                 #   Admin portal pages
│       ├── portal/                #   Public ticket portal
│       └── api/
│           ├── ship/              #   Version creation endpoint
│           ├── version/           #   Version query endpoints
│           ├── webhooks/          #   Vercel + GitHub webhooks
│           ├── tickets/           #   Ticket management API
│           ├── logs/              #   Log retrieval API
│           ├── mcp/               #   MCP protocol endpoint
│           └── health/            #   Health check
├── server-manager/                # Server Manager (Express + MCP)
│   └── src/
│       ├── index.ts               #   Entry point
│       ├── routes/                #   API routes
│       ├── services/              #   Business logic
│       └── mcp/                   #   MCP tools
├── deploy/                        # Deploy Server (Next.js)
│   └── src/app/
│       ├── deploy/                #   Rebuild UI
│       ├── manager/               #   Manager status
│       ├── emergency/             #   Disaster recovery
│       └── api/                   #   Deploy API endpoints
├── packages/
│   ├── admin-ui/                  # Shared UI component library
│   └── ticket-widget/             # Embeddable ticket SDK
├── infrastructure/
│   ├── bootstrap.sh               # Full server provisioning
│   ├── teardown.sh                # Server cleanup
│   ├── traefik/                   # Reverse proxy templates
│   ├── postgres/                  # Database templates
│   ├── agent-envs/                # AI agent environment templates
│   ├── network/                   # Docker network setup
│   └── scripts/                   # Certificate and utility scripts
├── drizzle/                       # Database migrations
├── docs/ops/                      # 7 operational runbooks
├── docker-compose.yml             # Local development composition
├── Dockerfile                     # Ship app container image
├── .env.example                   # Environment template
├── README.md                      # Project overview
├── DEPLOY.md                      # Instance deployment guide
├── SERVER_BOOTSTRAP.md            # Infrastructure setup guide
└── TICKET_SYSTEM_DOCS.md          # Ticket system documentation
```
