# Matrx Ship

Universal deployment, version tracking, env management, and infrastructure orchestration for all Matrx projects. **One repo runs the whole platform** — a CLI for project authors, a per-project admin app, the host's control plane, and the bootstrap scripts that built the server in the first place.

Already deeply documented. Don't duplicate — read the right doc for the question:

| Question | Read |
|---|---|
| **The big picture — where the whole platform is going** | **[MASTER_PLAN.md](MASTER_PLAN.md) — the North Star + all stages; start here** |
| **Total control plane + real-infra agent access (ACTIVE BUILD)** | **[CONTROL_PLANE_PLAN.md](CONTROL_PLANE_PLAN.md) — making the UI control everything (AWS/boxes/terminals) + agents getting real operator access via the sandbox mechanism** |
| **Give a coding agent real shell/file access to the host or a container (HTTP API)** | **[AGENT_GATEWAY_API.md](AGENT_GATEWAY_API.md) — grant/exec/fs/search/revoke contract; LIVE on the Manager; the API behind the /admin/agent-access portal + remote triggers** |
| **What does this term mean? (instance / sandbox / orchestrator / deployment)** | **[NAMING.md](NAMING.md) — canonical taxonomy; when a word is ambiguous, it wins** |
| **What's getting moved into the UI next** | **[UI_REFACTOR_PLAN.md](UI_REFACTOR_PLAN.md) — read before adding any new ops command (Phase 2 done; see its 2026-05-25 status block)** |
| Architecture, components, how pieces fit | [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md) |
| User-facing CLI reference | [README.md](README.md), [cli/README.md](cli/README.md) |
| Deploy a Ship instance manually | [DEPLOY.md](DEPLOY.md) |
| Bootstrap a fresh server from scratch | [SERVER_BOOTSTRAP.md](SERVER_BOOTSTRAP.md) |
| Operational runbooks (recovery, certs, env vars) | [docs/ops/](docs/ops/) (7 docs) |
| Ticket system (built into Ship app) | [TICKET_SYSTEM_DOCS.md](TICKET_SYSTEM_DOCS.md) |
| CI/CD pipeline | [CICD-SETUP.md](CICD-SETUP.md) |

This file is the **orientation layer** — what each piece is, where the live version of it runs, and what to be careful about. For depth, follow the links above.

---

## Five Things Ship This Way

| Component | Lives in | Runs as | URL on this server |
|---|---|---|---|
| **CLI** ("Ship" + "Env-Sync") | [cli/](cli/) | Installed into other projects under `scripts/matrx/` | n/a — runs on developer machines |
| **Ship App** (per-project admin + version API) | [src/](src/) | Next.js 16.1 in Docker, one container per project | `<project>.dev.codematrx.com/admin` |
| **Server Manager** (control plane + MCP) | [server-manager/](server-manager/) | Express + MCP, container `matrx-manager` | `manager.dev.codematrx.com` |
| **Deploy Server** (Manager's lifeline) | [deploy/](deploy/) | Next.js, container `matrx-deploy` | `deploy.dev.codematrx.com` |
| **Infrastructure templates** | [infrastructure/](infrastructure/) | Provisions a host on first run | n/a — bootstrap-only |

Plus two shared packages: [packages/admin-ui/](packages/admin-ui/) (component library used by Ship admin and Manager admin) and [packages/ticket-widget/](packages/ticket-widget/) (embeddable React SDK for ticket submission).

---

## CLI ([cli/](cli/))

The most-touched surface area. Installed into other projects via `curl ... install.sh | bash`. Provides:

- **Ship** — `pnpm ship "msg"` bumps semver, records the version in the project's Ship instance DB via `POST /api/ship`, then commits and pushes.
- **Env-Sync** — safe Doppler ↔ local `.env` merging (no overwrites by default; `--force` variants exist).
- **Provisioning** — `pnpm ship:init <name> "Display"` calls the Server Manager to spin up a brand-new Ship instance.

Key files: [cli/ship.ts](cli/ship.ts) (TS entry), [cli/ship.sh](cli/ship.sh) (bash wrapper for non-Node projects), [cli/env-sync.sh](cli/env-sync.sh), [cli/install.sh](cli/install.sh), [cli/migrate.sh](cli/migrate.sh) (migrates from old `matrx-dev-tools`).

The CLI is **published by URL** — `install.sh` and `migrate.sh` are fetched from GitHub raw, so changes there ship the moment they hit `main`. Test before merging.

---

## Ship App ([src/](src/))

Next.js 16.1 + Drizzle + Postgres. **One container per project** — every Ship instance is a full copy of this app with its own database. Image: `matrx-ship:latest`.

- **Public surface:** `/api/ship` (CLI auth via `sk_ship_…` API key), `/api/version*`, `/api/webhooks/{vercel,github}`, `/api/health`, `/api/mcp`.
- **Admin portal:** `/admin` — versions, stats, deployments, DB query builder, tickets, logs, health, settings.
- **Public portal:** `/portal` — ticket submission and status lookup.
- **Schema** ([drizzle/](drizzle/)): `app_version`, `api_keys`, `logs`, `tickets`, `ticket_activity`, `ticket_attachments`.

Editing this app changes every project's admin portal once `matrx-ship:latest` is rebuilt and instances are recreated. See `SERVER-RUNBOOK.md` for the rebuild-all-instances loop.

Built-in **ticket system** has an AI-triage workflow (autonomy scores, MCP tools for agents to triage). See [TICKET_SYSTEM_DOCS.md](TICKET_SYSTEM_DOCS.md).

---

## Server Manager ([server-manager/](server-manager/))

Express server (single ~2,500-line [server-manager/src/index.js](server-manager/src/index.js) — there is no separate `routes/`, `services/`, or `mcp/` directory; everything lives in this one file) + Next.js admin UI ([server-manager/admin/](server-manager/admin/)). Runs as `matrx-manager`. **The brain of the host** — owns `/srv/apps/deployments.json` and is the only thing that should be writing it.

- Mounts host paths: `/srv` → `/host-srv`, `/data` → `/host-data`, plus the Docker socket. So it can read/write any file under `/srv` and manage any container on the host.
- Auth: `MANAGER_TOKENS` (comma-separated) for env-defined tokens, plus a hashed-token store at `/srv/apps/tokens.json` for managed tokens with roles (`admin` / `deployer` / `viewer`). Legacy `MANAGER_BEARER_TOKEN` still supported.
- Two router rules in Traefik:
  - API/MCP traffic (`/api`, `/mcp`, `/health`) → port 3000 (Express)
  - Everything else → port 3001 (Next.js admin UI)
- Exposes ~40 MCP tools at `/mcp` for AI agents to manage instances, run shell commands, query DBs, build images, manage backups.

**Key tools:** `app_create`, `app_list`, `app_remove`, `app_backup`, `app_rebuild`, `app_logs`, `app_env_update`. Plus a wide set of system/Docker/Traefik/PostgreSQL utilities.

When developing here, the live deployment compose lives at `/srv/apps/server-manager/docker-compose.yml` (separate from this source repo).

---

## Deploy Server ([deploy/](deploy/))

Next.js. Runs as `matrx-deploy`. Its **only purpose is to recover the Server Manager** when the Manager is broken — and to rebuild itself if needed.

- Pages: Deploy (rebuilds w/ streaming SSE logs), Docker, Instances, Infrastructure, History, Manager, **Emergency** (reset Manager, rebuild from scratch), Docs.
- Auth: `DEPLOY_TOKENS` (comma-separated bearer tokens).
- Has its own image, its own deployment under `/srv/apps/deploy/`. Can rebuild itself via `/api/self-rebuild`.

Treat this as the safety net. Don't pile features into it that depend on Manager being healthy — that defeats the point.

---

## Infrastructure ([infrastructure/](infrastructure/))

Bootstrap and templates. **Used to provision a fresh server**, not for day-to-day operation. Once the host exists, `apps/` is what actually runs.

- [bootstrap.sh](infrastructure/bootstrap.sh) — installs Docker, creates the `proxy` network, brings up Traefik + Postgres + Manager + Deploy. Driven by [infrastructure/.env.bootstrap.example](infrastructure/.env.bootstrap.example).
- [traefik/](infrastructure/traefik/), [postgres/](infrastructure/postgres/), [agent-envs/](infrastructure/agent-envs/), [network/](infrastructure/network/) — compose templates copied to `/srv/<name>/` during bootstrap.
- [teardown.sh](infrastructure/teardown.sh) — reverse of bootstrap.

If you change anything here, it does **not** affect the live host until someone re-bootstraps. The live `traefik/`, `postgres/`, etc. on the host are the actual configs.

---

## Workspace & Build

- pnpm workspaces ([pnpm-workspace.yaml](pnpm-workspace.yaml)): `packages/*`, `server-manager`, `deploy`. Root is the Ship app itself.
- Root [Dockerfile](Dockerfile) builds `matrx-ship:latest` (the Ship app image used by every instance).
- [server-manager/Dockerfile](server-manager/Dockerfile) builds the Manager image (multi-stage: Express + Next.js admin UI).
- [deploy/Dockerfile](deploy/Dockerfile) builds the Deploy image.
- [drizzle/](drizzle/) holds Ship app schema + migrations. `pnpm db:push` for dev, migrations for prod. Note: the schema includes `infra_servers` + `infra_instances` tables that aren't actively queried yet — they're reserved for the future multi-host work in [UI_REFACTOR_PLAN.md](UI_REFACTOR_PLAN.md) Phase 6.
- This repo's own `.matrx.json` points at `https://matrx-ship.dev.codematrx.com` — **the platform ships itself** through its own pipeline.

---

## Capability matrix (current state, updated 2026-05-24)

The numbers and gaps below are the working ground truth for [UI_REFACTOR_PLAN.md](UI_REFACTOR_PLAN.md). Update these alongside the plan when capabilities ship.

### Server Manager

- **70 HTTP routes + 35 MCP tools** in [server-manager/src/index.js](server-manager/src/index.js) (~2,600 lines).
- **Full UI coverage today:** instance lifecycle (create/delete/start/stop/restart/backup/restore/env-edit/exec/db-query), build pipeline for `matrx-ship:latest` (rebuild + rollback + cleanup with SSE log streaming), token management, static sandbox lifecycle (sandbox-1..5 — restart/stop/start/exec), system info, db-health audit, docs browser. Self-rebuild via SSE.
- **Orchestrator sandboxes (expanded 2026-05-24):** **create** (`POST /api/orchestrator-sandboxes` → new-sandbox form, hosted tier) + list + detail + diagnostics + logs + agent-env + fs-list + fs-read + **reset**, plus **lifecycle control — destroy / extend / resume** (proxied to the orchestrator, role-gated), a **"Last updated" staleness column** (red badge when a live row hasn't been refreshed in >5 min — surfaces the orchestrator losing track of a box), **image-health card + missing-tag banner** (`GET /api/sandbox-images/health`, distinguishing `missing` vs `missing_required`), **Restart orchestrator** (`POST /api/orchestrator/restart`), and **streaming image rebuilds** — per-variant `matrx-sandbox:{core,slim,local,aidream}` + orchestrator-image buttons that stream `docker build` logs live (SSE `POST /api/sandbox-images/build/stream?variant=…` and `POST /api/orchestrator/build/stream`).
- **Zero-drift migration controls (2026-05-25):** the orchestrator-sandboxes page shows a **"Version drift" card** (when any box is stale) listing each drifted box's `running → current` version with a **"Migrate all"** button. Proxies `GET /api/orchestrator-sandboxes-drift`, `POST .../-migrate-all`, `POST .../:id/migrate` to the orchestrator (role-gated). The swap preserves the per-user volume — no data loss. Full system: [/srv/projects/matrx-sandbox/docs/ZERO_DRIFT.md](../matrx-sandbox/docs/ZERO_DRIFT.md).
- **Fleet Health monitor (2026-05-25):** read-only `GET /api/fleet-health` + `/admin/fleet-health` page + a global red banner. Catches the failures that used to be silent — **cross-host code/config drift** (hosted vs EC2 orchestrator), **stale/missing sandbox images**, and **failed deploy runs** (GitHub Actions via `GITHUB_PAT`; degrades gracefully if absent). This is the start of Stage 3 (observability) in [MASTER_PLAN.md](MASTER_PLAN.md).
- **Image-incident guardrails (2026-05-24):** a **global missing-required-tag banner** across the whole admin UI, and **reverse-tag protection** — `shell_exec` refuses `docker rmi`/`prune -a` of `matrx-sandbox:*`/`matrx-orchestrator` images unless `MATRX_DESTRUCTIVE_OPS=1`. Together with the above, this closes the 2026-04-30 incident end-to-end (detect → rebuild → can't-accidentally-delete).
- **EC2-tier orchestrator wired in (2026-05-26):** the Manager now does **tier-aware routing** — per-box actions (diagnostics/logs/agent-env/fs/lifecycle/migrate) route to the box's OWN orchestrator (`orchFetchForSandbox` + a sandbox_id→tier cache; `MATRX_EC2_ORCHESTRATOR_URL`/`_API_KEY` set on the Manager). List + detail come from the hosted orchestrator (shared DB → both tiers). So ec2 boxes are now visible + manageable from the Manager. Caveat: the in-browser terminal + local CPU/mem gauges stay hosted-only (ec2 containers are on a remote host); ec2 health is via the Diagnostics tab. Verified: ec2 box diagnostics/logs via the Manager → 200.
- **Backend exists, UI missing** (cheap wins, [Plan Phase 1](UI_REFACTOR_PLAN.md#phase-1--cheap-ui-wins-12-days)): Supabase sync/restore (`POST /api/supabase/{sync,restore}`), Deploy server self-rebuild proxy, Traefik reload (via `docker_compose` MCP tool), `docker system prune` (via `shell_exec`).
- **Not implemented at all** ([Plan Phases 3-5](UI_REFACTOR_PLAN.md)): repo `git pull`, generic config-file editor, backup scheduling, cert observability, host job inventory.

### Deploy Server

- **22 endpoints, 8 pages.** Read-mostly emergency surface. Has `/api/self-rebuild/stream` for self-recovery. Cannot create instances or modify secrets — those require the Manager.

### Ship App (per-project admin)

- **14 admin routes + 30+ API routes.** Per-project versioning + ticketing + audit trail + database browser. Strictly per-project — no cross-instance ops. Schema: `app_version`, `api_keys`, `logs`, `tickets`, `ticket_activity`, `ticket_attachments`, plus the inactive `infra_servers` / `infra_instances` mentioned above.

### CLI

- **Versioning, env-sync, instance provisioning.** Auth: `sk_ship_*` API keys for the Ship app, `MATRX_SHIP_SERVER_TOKEN` for the Manager.
- **No sandbox or orchestrator commands yet.** [Plan Phase 2 + 3](UI_REFACTOR_PLAN.md) extend the CLI to mirror the Manager UI's new image-build / repo-pull capabilities.

### admin-ui package

- **Top reusables:** `Button`, `Card`, `Table`, `Dialog`, `Sheet`, `Input`, `Select`, `Badge`, `Tabs`, `Collapsible`, `DropdownMenu`, `Tooltip`, `Label`, `BuildLogViewer` (terminal-styled SSE log display), `PageShell`, `AdminShell`, `ThemeProvider`, `CodeBlock`, `MarkdownRenderer`, `sonner` toast.
- **No `ConfirmDialog` primitive yet** — destructive-action dialogs are ad-hoc Dialog+Button compositions per page. Worth consolidating once we add a third one.

### ticket-widget package

- **Published as `@matrx/ticket-widget`.** Stable public API: `TicketProvider`, `TicketButton`, `TicketForm`, `TicketTracker`, `useTicketConfig`. Embedded in external apps; treat the contract as stable.

---

## Working Here

- The Ship app is multi-tenant in the *deployment* sense (one container per project) but **not in the data sense** — every instance has its own DB, its own API key. Don't add cross-instance data assumptions.
- The CLI has shell wrappers + TS for a reason: not every Matrx project is a Node project. When adding commands, update both `cli/ship.ts` and `cli/ship.sh` (and the Makefile target list in `install.sh`/`migrate.sh`).
- **Admin UIs depend on `packages/admin-ui/`.** Breaking changes there cascade into Ship admin and Manager admin. Bump carefully.
- Ticket widget ([packages/ticket-widget/](packages/ticket-widget/)) is published as `@matrx/ticket-widget` and embedded in external apps. Treat its public API as stable.
- When changing `matrx-ship:latest` (the image), you need to rebuild it and force-recreate every instance for changes to land. Single-instance changes — only a problem if a project has frozen on an old version.
- The Server Manager **directly mutates the host filesystem and Docker daemon**. Bugs there can wipe instances or corrupt the deployments registry. Test on `apps/<test-name>/` before letting changes touch real instances.
