TO make sure we understand this, it's critical we know what role each server plays.

Traffic is handling proxies, etc. It's not our package so there isn't much we can do about it.

THen, we have the BIG BOSS, which manages essentially everything (except for itself):
https://manager.dev.codematrx.com/admin/

- ✓ COMPLETED: Renamed from "mcp" to "manager" (mcp.dev → manager.dev)
- This is not an mcp server. It can manage mcp servers but that's not what it is.
- ✓ Auto-migration added to ship.ts to update old configs automatically

The server manager is designed to be the central souce that deploys and controls everything.
- But what about when the server manager itself needs redployment or management? Then, we have the "Deploy" server

Some current confusion  with the ui and the flow:
- The primary purpose of the deploy  server is to manage the main server so that's what most of its ui should be dedicated to.

The first tab should give us absolutely all of the things we'd need to fully debug everything for that server, including but not limited to:
- Show current status, current health, etc.
- Show current logs
- Provide terminal access to it
- Show all builds (containers or whatever versions we have)
- Allow rollbacks
- Show changes that are available to be pushed to a new deployment
- Allow for backups with a click that pushes it to aws
- Anything else we could possibly need to fully and completley manage the primary server without getting into this physical vps environemnt.

But then, we can still keep the other functionality for the individual servers and all of that, but that's not the purpose of the deploy server. It needs to be "Obsessed with giving absolutely everything we could ever need to manage, fix and update the main server, if things are wrong"

Here are the things we need to do:
1. Figure out the naming situation for the server manager and hopefully correct it so 'mcp' can then be used for actual mcp servers.
2. Make sure the deploy server gives everything we need for the manager, in case that is down and we need to do things.
- As part of this, it's valuable for the deploy system to also manage all other servers, but as a secondary task, not the priimary.
- The UI of the dploy server needs to stop trying to do everyting in one place. Things need to be separated into separate pages so that it's clear what we're showing, what we're updating and what is going on.
3. The server manager needs to then manage all other servers in the exaxt way that the depoy server will now manage it.
- The same list of things listed above need to be managed here.
- It also needs  to allow for control of the database within these packages. From what I can see, these containers may not properly be gettting their dedicated postgress inside of them in some cases so we need to confirm.
4. We need to create a set of docs that are accessible on the server manager and deploy server that include all of the information you just gave me and more. These are the 'how to' documents I need to have when things go wrong.
5. It appears we have certain things set up and working, but if this server is taken down and we push the source code to a new server, we would lose everything!
- This is a major problem because the goal is that the Matrx Ship package and the other two packages we have, matrx-mcp-template and matrx-sandbox whould contain absolutely everything needed to push to a new server and have the entire system operational with only smoe env variables.
- Right now, much of this is missing. We have to make sure that evderything for traffic, postgres, agents, etc. are all coming from the sources. If you don't know where something belongs, then it should probably be in the ship package, since that's the parent that controls all else.
6. We need to develop a solution for persistence of data, settings and more.
- We have some options so just tell me what's best for this.

This is the option I can think of but we should do whatever is the best practice that enterprises would use:
-- Use our primary supabase database to create one or more tables that can store everything this system needs for persistence so that if the server crashes, we have a way to spin up a new server, connect it to the table and have it fully regenrate.
-- Use aws buckets for anything else that cannot be stored in supabase. 

Goal: Ensure absolute persistence, no local logic, no local data that is not backed up, no way to have massive failures, everything managed from a web ui, not locally on the vps, as we're doing now.

## Server Architecture: Roles, Naming, and Priority Tasks

Before we get into tasks, we need to be crystal clear on the **hierarchy and purpose** of each layer:

**Layer 0 — Traefik:** Reverse proxy. Third-party package, we don't control it beyond config. It routes traffic. That's it.

**Layer 1 — Server Manager (currently misnamed "mcp"):** The **primary control plane**. It deploys, monitors, and manages every other service on this server — every Ship instance, every custom service, databases, agents, everything. It is the single pane of glass for operating the entire server.

**Layer 2 — Deploy Server:** Exists for **one critical reason**: to manage the Server Manager itself. If the Server Manager goes down, the Deploy server is our lifeline. It must provide every possible tool to diagnose, fix, roll back, and redeploy the Server Manager without SSH access to the VPS. Managing individual app instances is a secondary capability, not its primary purpose.

**Layer 3 — App Instances:** The Ship instances, sandbox orchestrator, MCP servers, etc. These are managed *by* the Server Manager, not directly.

This hierarchy means: Deploy watches the Manager. The Manager watches everything else. Each layer is the safety net for the layer below it.

---

### Task 1: Fix the Naming ✓ COMPLETED

The Server Manager has been renamed from `mcp.dev.codematrx.com` to `manager.dev.codematrx.com`.

**What was done:**
- ✓ Updated all code references to use `manager.dev.codematrx.com`
- ✓ Added auto-migration logic in ship.ts to update old saved configs
- ✓ Updated DEFAULT_MCP_SERVER constant to correct URL
- ✓ Updated all documentation references

**Note:** Users with old saved configs at `~/.config/matrx-ship/server.json` will be automatically migrated on next run.

---

### Task 2: Rebuild the Deploy Server UI — Manager-First Design

The Deploy server's UI currently tries to do too much in one view. It needs to be restructured into **separate, clearly scoped pages** — not one crowded dashboard.

**Primary page (Tab 1) — Server Manager Control Panel:**
This page must provide **everything** needed to fully operate the Server Manager without SSH. Think of it as an emergency operations console. It needs:

- **Live status & health** — current container state, uptime, health check results, resource usage (CPU/memory/disk)
- **Logs** — real-time streaming logs with search/filter, plus historical log access
- **Terminal access** — embedded web terminal (or exec shell) into the Manager container
- **Build history** — every image build and container version, with timestamps and commit hashes
- **Deployment controls** — one-click rebuild, restart, and force-recreate with confirmation dialogs
- **Rollback** — list of previous builds/images with one-click rollback to any prior version
- **Pending changes** — show git diff or changelog of what's available to deploy vs. what's currently running
- **Backup controls** — one-click backup of the Manager's config, state, and data to AWS S3, with backup history and restore capability
- **Environment variables** — view (masked) and edit env vars without SSH
- **Network/routing status** — confirm Traefik is routing to it correctly, show the active route rules

If there's anything else an ops engineer would need at 2 AM when things are broken, it belongs on this page.

**Secondary pages:**
- Individual app instance management (keep existing functionality but on its own page)
- Infrastructure overview (Traefik, Postgres, Agents status)
- Deployment history / audit log across all services

---

### Task 3: Server Manager Must Mirror This for All Other Services

The Server Manager needs to provide the **exact same depth of control** for every service it manages that the Deploy server provides for it. For each managed service:

- Live status, health, resource usage
- Streaming and historical logs
- Terminal/exec access
- Build history and rollback
- Deployment controls (rebuild, restart, force-recreate)
- Pending changes (what's deployable)
- Backup and restore
- Environment variable management

**Additionally — database verification and management:**
Each Ship instance is supposed to have its own dedicated Postgres container. We need to:
- **Audit every instance** to confirm its dedicated database container actually exists, is running, and is properly connected
- Fix any instances where the database is missing or misconfigured
- Provide database controls in the Manager UI: connection status, basic query access, backup/restore per database, and the ability to view schema/tables

---

### Task 4: Operational Documentation — Accessible from Both UIs

Create a comprehensive documentation section accessible directly within both the Deploy server and the Server Manager UIs (not just files on disk). This documentation must include:

- Everything from the deployment guide provided above, kept up to date
- The architecture hierarchy explained in this message
- Runbooks for common failure scenarios (service won't start, database connection lost, Traefik routing broken, disk full, etc.)
- Step-by-step disaster recovery procedures
- Environment variable reference for every service
- Network topology and port mappings
- Backup and restore procedures
- How to add a new Ship instance from scratch

These docs should be versioned and stored in the source repos, rendered in the UI. Not local-only files that disappear if the server dies.

---

### Task 5: Full Infrastructure-as-Code — Everything Reproducible from Source

**This is critical.** Right now, if this VPS dies, we cannot fully recreate the environment from source alone. That's unacceptable. The goal:

> Given a fresh VPS, the source repos, and a set of environment variables, the entire system must be fully operational with a single bootstrap process.

**What needs to be in source control (and currently may not be):**
- Traefik configuration (static config, dynamic config, middleware definitions, TLS settings)
- PostgreSQL initialization scripts, roles, database creation
- Agent environment Dockerfiles and compose configs
- Network creation scripts (the `proxy` network, any others)
- All Docker Compose files for every service
- Bootstrap/setup script that provisions a fresh server: installs Docker, creates directories, sets up networks, pulls repos, builds images, starts everything in the correct order

**Where things belong:**
- If it's part of the core platform → `matrx-ship` repo
- If it's specific to MCP templates → `matrx-mcp-template` repo
- If it's specific to sandbox orchestration → `matrx-sandbox` repo
- If you're unsure → it goes in `matrx-ship` as the parent package

**Deliverable:** A `bootstrap.sh` (or equivalent) in `matrx-ship` that takes a clean Ubuntu VPS from zero to fully operational with only environment variables as input. Document every env var required.

---

### Task 6: Persistence Strategy — Zero Local-Only State

**Goal:** No local data that isn't backed up. No configuration that exists only on the VPS. If the server disappears, we lose nothing.

**Recommended approach (and what I want your input on — confirm or propose better):**

1. **Supabase (primary persistence):** Use our existing Supabase project to store:
   - Service configuration and settings
   - Deployment history and audit logs
   - Environment variable templates (encrypted)
   - System state snapshots
   - Documentation content (if not purely in source control)
   - Any operational metadata the Manager and Deploy services need

2. **AWS S3 (bulk/binary persistence):**
   - Database backups (pg_dump outputs)
   - Docker image archives (for rollback without rebuild)
   - Log archives
   - Any large files that don't belong in a database

3. **Source control (configuration persistence):**
   - All Docker Compose files, Dockerfiles, config files
   - Bootstrap and setup scripts
   - Documentation source

**The rule:** Every piece of state must live in at least one of these three places. If something only exists on the local filesystem and isn't in source control, Supabase, or S3 — it's a bug. Audit everything and flag any gaps.

**Recovery flow should be:** Fresh VPS → clone repos → run bootstrap → bootstrap pulls config from Supabase + backups from S3 → system is fully operational.

---

### Execution Order

1. **Naming fix first** (Task 1) — it's a prerequisite for clarity in everything else
2. **Infrastructure-as-code audit** (Task 5) — understand what's missing before building more
3. **Persistence strategy implementation** (Task 6) — set up the Supabase tables and S3 buckets
4. **Deploy server UI rebuild** (Task 2) — manager-first design
5. **Server Manager feature parity** (Task 3) — full control of all services
6. **Documentation** (Task 4) — write as you build, finalize at the end

---

### Non-Negotiable Standards

- **No local-only state.** Everything persisted externally.
- **No SSH-required operations.** Everything manageable from web UI.
- **Separated concerns in UI.** One page, one purpose. No cramming.
- **Health checks on everything.** Every service must have a health endpoint. Every deployment must verify health before considering itself complete.
- **Atomic deployments.** Build and test new images *before* stopping old containers. Never deploy blind.
- **Audit trail.** Every deployment, rollback, config change, and backup logged with timestamp and initiator.