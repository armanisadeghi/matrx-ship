# Matrx Naming — the canonical taxonomy

**Last updated:** 2026-05-25 · **Status:** canonical reference. When a term is ambiguous, this doc wins. UI labels, docs, and new code should use these names.

## Why this exists

The words are dangerously overloaded. "Instance" has meant a Ship deployment, a Postgres container, AND a sandbox. "Sandbox" has meant the source repo, a running agent container, a deprecated static pool, the Docker images, AND a Ship deployment that happens to be named `matrx-sandbox`. Every new capability (slim boxes, warm pool, claim, memory, co-located AI Dream) added nouns without a shared vocabulary. This doc fixes the vocabulary so anyone — human or agent — can reason about the system without guessing.

Read the [Glossary](#glossary-quick-lookup) for a fast answer; read [The named traps](#the-named-traps) for the specific things people get wrong.

---

## The core hierarchy

Top-down. Each level contains the next.

| Term | Definition | Concrete example |
|---|---|---|
| **Server** | A Matrx-managed VPS host. | `srv504398.hstgr.cloud` (the `/srv` dev host). Today there is effectively one; the EC2 sandbox host + the co-located AI Dream box are separate AWS machines (see below). |
| **Project** | A software product with a source repo. | `matrx-ship`, `matrx-sandbox`, `matrx-frontend`, `aidream` |
| **Deployment** | A running container stack of a Project on a Server — its own URL, database, API key, admin portal. (Historically called a "Ship instance" or "app instance".) | the Deployment named `aidream-current`; the Deployment named `matrx-sandbox` (version-tracking only — **not** a sandbox runtime) |
| **Sandbox** | An ephemeral execution environment for an AI agent. Spawned and destroyed on demand by the Orchestrator. | `sbx-14a6b8a17189` |
| **Template** | The flavor of a Sandbox — which image + behavior it boots with. | `slim`, `aidream`, (`core`, `local` are build/legacy — see Templates) |
| **Image** | A Docker image tag that a Template builds from. | `matrx-sandbox:slim`, `matrx-sandbox:aidream`, `matrx-orchestrator:latest`, `matrx-ship:latest` |
| **Tier** | Where a Sandbox physically runs. | `hosted` (this `/srv` Server) or `ec2` (AWS) |
| **Build** | A single image-build event (git commit, status, timestamp). | "build of `matrx-sandbox:slim` at 21:38 on 2026-05-22" |
| **Backup** | A Postgres dump or config snapshot of a Deployment. | "daily pg_dump of `matrx-sandbox`'s DB" |

Read out loud:

> The **matrx-ship** Project has a **Deployment** named `aidream-current` running on this **Server**. A user spawned a **Sandbox** from the `slim` **Template** (which boots the `matrx-sandbox:slim` **Image**) on the `hosted` **Tier**. The latest **Build** of that Image is from 2026-05-22.

---

## The three control-plane services (don't conflate these)

| Name | Container | What it is | URL |
|---|---|---|---|
| **Server Manager** ("the Manager") | `matrx-manager` | The brain of the Server. Creates/manages Deployments, builds images, manages Sandboxes, tokens. Express API + MCP + Next.js admin UI. | `manager.dev.codematrx.com` |
| **Deploy Server** ("Deploy") | `matrx-deploy` | The Manager's lifeline. Recovers/rebuilds the Manager when it's broken. Read-mostly otherwise. | `deploy.dev.codematrx.com` |
| **Sandbox Orchestrator** ("the Orchestrator") | `matrx-orchestrator` | The FastAPI control plane that spawns + manages **Sandboxes**. **Not** the Manager. Same code runs on both Tiers. | `orchestrator.dev.codematrx.com` (hosted); a private EC2 instance (ec2) |

"The Manager" manages **Deployments + the Server**. "The Orchestrator" manages **Sandboxes**. They are different services with different jobs. The Manager *proxies to* the Orchestrator for sandbox operations (`/api/orchestrator-sandboxes/*`), which is why both appear in the Manager admin.

---

## The sandbox vocabulary (the part that grew fastest)

### Templates

A Template is what a user/agent picks when spawning a Sandbox. Each maps to one Image:

| Template | Image | What it is | Persistence | Required? |
|---|---|---|---|---|
| **slim** | `matrx-sandbox:slim` (~886 MB) | Lightweight coding box. The **default** for new spawns. No Chromium, no Playwright. | **git** (clone → work → push). No volume, no S3. | **yes** — orchestrator spawns from it |
| **aidream** | `matrx-sandbox:aidream` (~4.9 GB) | Full AI Dream box — runs the agent loop *inside* the container with credentials baked in. | per-user Docker volume (hosted) / S3 hot-cold (ec2) | **yes** |
| **core** | `matrx-sandbox:core` | Base image. A **build dependency** of `:aidream`; not spawned directly. | n/a | no (build-only) |
| **local** | `matrx-sandbox:local` | The deprecated static starter-pool image (`sandbox-1`…`5`). | per-slot volume | no (legacy) |

"Required" means the Orchestrator actually spawns Sandboxes from it, so its absence breaks spawning (the 2026-04-30 incident). `core`/`local` being absent is not an alarm. The Manager's image-health banner keys on `missing_required` for exactly this reason.

### Sandbox lifecycle nouns

| Term | Meaning |
|---|---|
| **Warm pool** | A set of N pre-booted, unclaimed `slim` Sandboxes the Orchestrator keeps ready. `MATRX_WARM_POOL_SIZE` (hosted=2). |
| **Claim** | `POST /sandboxes/claim` — adopt a warm Sandbox in ~0.5s (vs cold-create's minutes), hydrate the user's memory, replenish the pool. A claimed box gets a DB row; an unclaimed warm box has the `warm_pool=1` label and *no* DB row. |
| **Memory** | Cross-project, per-user state in Postgres (`user_memory`, keyed on `user_id`). Hydrated into `~/.matrx/memory/` on create/claim; captured back on teardown. **Not** the cloud-files bridge. |
| **Expiry / reaper / resume** | The reaper (60s loop) tears down past-TTL Sandboxes (keeps the volume) → status `expired`. `POST /sandboxes/{id}/resume` respawns on the same volume. |
| **Agent-binding** | `POST /sandboxes/{id}/agent-binding` → `{ sandbox_id, base_url, access_token, root_path }`. The handoff object AI Dream uses to drive a Sandbox's tools remotely. `base_url` is the Orchestrator's **private** address on EC2 (LAN-speed tool calls). |

### Co-located AI Dream (the production agent-loop path)

A **full AI Dream** deployment runs on its own EC2 box (`matrx-python-server`) in the **same AWS AZ** as the EC2 sandbox host, so the agent loop's tool calls to the Orchestrator ride the private LAN. This is **not** the Orchestrator and **not** the in-box `aidream` Template — it's a separate full AI Dream whose *tools* reach into lean Sandboxes via the agent-binding. See `matrx-sandbox/docs/COLOCATED_AIDREAM.md`.

---

## Container naming conventions

What you see in `docker ps`, and what each pattern means:

| Pattern | Meaning |
|---|---|
| `<project-name>` (e.g. `aidream-current`, `matrx-sandbox`) | A **Deployment** container |
| `db-<project-name>` (e.g. `db-matrx-sandbox`) | A Deployment's Postgres |
| `matrx-manager` | The Server Manager |
| `matrx-deploy` | The Deploy Server |
| `matrx-orchestrator` | The Sandbox Orchestrator (hosted Tier) |
| `sbx-<12-hex>` (e.g. `sbx-14a6b8a17189`) | A **Sandbox** (orchestrator-spawned) |
| `sandbox-1` … `sandbox-5` | The deprecated static starter pool |
| `traefik`, `postgres`, `pgadmin`, `agent-1` | Shared infra |

---

## The named traps

The specific things people (and agents) get wrong:

1. **The Deployment named `matrx-sandbox` is not a Sandbox.** It's a Ship Deployment that does version-tracking for the matrx-sandbox Project. When you say "the sandbox," you almost always mean a `sbx-*` Sandbox or the matrx-sandbox **Project**, not this Deployment. Always qualify: "the matrx-sandbox **Deployment**" vs "a **Sandbox**" vs "the matrx-sandbox **Project/repo**".

2. **Templates ≠ Images.** A Template (`slim`, `aidream`) is the user-facing choice; an Image (`matrx-sandbox:slim`) is the Docker tag it builds from. One Template → many Builds of one Image over time; the latest is what the Orchestrator pulls.

3. **The Orchestrator ≠ the Manager.** The Orchestrator (`matrx-orchestrator`) spawns Sandboxes. The Manager (`matrx-manager`) manages Deployments + the Server and *proxies* sandbox ops to the Orchestrator. Two services, two jobs.

4. **Co-located AI Dream ≠ the Orchestrator ≠ the in-box `aidream` Template.** Three different things: (a) the Orchestrator spawns boxes; (b) the `aidream` Template is a heavy box that runs the loop *inside* itself; (c) co-located AI Dream is a *separate* full AI Dream on EC2 that drives *lean* boxes remotely. The production direction is (c) + slim boxes.

5. **`cloud-files` ≠ `cld_files`.** `~/cloud-files/` is the user-visible directory inside a Sandbox; `cld_files` is the AIDream Supabase schema it syncs with; `/api/cloud-files/*` is the bridge between them. Different layers, intentionally. (Slim boxes don't use this — they persist via git; the watcher sits dormant there.)

6. **Tier ≠ Server.** Tier (`ec2` | `hosted`) is sandbox-specific. Server is a managed VPS. The `hosted` Tier runs on this `/srv` Server; the `ec2` Tier runs on different AWS infrastructure.

7. **"Memory" is Postgres-backed, not the cloud-files bridge.** Per-user agent memory (`user_memory` table) is separate from cloud-files (`cld_files`). Both end up in `~/.matrx/` and `~/cloud-files/` respectively but are different systems with different backends.

---

## Terms that do NOT change

These are load-bearing or external — renaming them would break contracts. Leave them:

- **`cld_files`** — AIDream's canonical Supabase schema (external to this repo).
- **`sbx-<id>`** — the Sandbox container naming convention; used across both Tiers and in logs/APIs.
- **`sandbox_instances`** — the shared Supabase table both Tiers' Orchestrators write to.
- **`user_memory`** — the per-user memory table.
- **`app_*` MCP tools** (`app_create`, `app_list`, `app_remove`, …) — a public agent contract. The *concept* is "Deployment"; the *tool names* stay. Document the mapping, don't rename the tools.
- **Image tags** (`matrx-ship:latest`, `matrx-sandbox:slim`, etc.) — too invasive to rename; the Template ↔ Image mapping table above is the disambiguation.

The proposed schema rename `infra_instances → infra_deployments` (in the Ship App's inactive multi-host schema) is the one safe rename, because that table isn't queried yet.

---

## Glossary (quick lookup)

| If you hear… | It means… |
|---|---|
| "instance" | Ambiguous — ask. Usually a **Deployment** (Ship) or a **Sandbox** (orchestrator). Avoid the word; say which. |
| "the manager" | **Server Manager** (`matrx-manager`) — manages Deployments + the Server |
| "the orchestrator" | **Sandbox Orchestrator** (`matrx-orchestrator`) — spawns Sandboxes |
| "deploy" / "the deploy server" | **Deploy Server** (`matrx-deploy`) — the Manager's recovery lifeline |
| "a sandbox" | A `sbx-*` ephemeral agent box |
| "the sandbox repo/project" | The `matrx-sandbox` **Project** (source code) |
| "the matrx-sandbox deployment" | The version-tracking Ship Deployment named `matrx-sandbox` |
| "slim / aidream / core / local" | **Templates** (and their Images) |
| "warm pool / claim" | Pre-booted Sandboxes + the ~0.5s adoption call |
| "memory" | Per-user Postgres state hydrated into `~/.matrx/memory/` |
| "cloud-files" | `~/cloud-files/` ↔ `cld_files` bridge (heavy boxes only) |
| "co-located AI Dream" | The full AI Dream on EC2 that drives lean boxes remotely |
| "tier" | `ec2` or `hosted` — where a Sandbox runs |

---

## See also

- `UI_REFACTOR_PLAN.md` — the plan that applies this taxonomy to the admin UI structure.
- `matrx-sandbox/docs/COLOCATED_AIDREAM.md` — the co-located AI Dream topology.
- `matrx-sandbox/CLAUDE.md` — the three-things-named-sandbox orientation (this doc supersedes its terminology section).
- `/srv/CLAUDE.md` — host orientation.
