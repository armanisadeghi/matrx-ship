# Servers & Routes — what we actually have

A plain map of every machine, every public URL, and what each one is. Last
verified 2026-08-20 from live health, Cloudflare DNS, AWS, Coolify, and repository configuration.

The canonical cross-platform ownership table is
[`common-docs/systems/infrastructure/production-infrastructure/FEATURE.md`](../common-docs/systems/infrastructure/production-infrastructure/FEATURE.md#live-production-inventory).
This file adds Ship/control-plane machine detail; if a route here appears to disagree with that table,
the canonical inventory wins and the mismatch is an incident to repair.

---

## 1. Machines (the real "servers")

| Machine | Address | What it is |
|---|---|---|
| **AWS ECS/Fargate `matrx-production`** | `us-east-1` · public ALB behind Cloudflare | The primary production plane: two AI Dream API tasks, one workflow worker, one private persistent Cloud Browser worker, two admin-dashboard tasks, and two workflow-Studio tasks across two availability zones. `server.app`, `admin.app`, and `workflows.aimatrx.com` route here; AI Dream reaches the browser worker only through private Cloud Map discovery. |
| **`matrx-main`** | `89.116.187.5` | The residual Coolify plane. Runs the temporary streaming endpoint, scraper, development apps, Directus, and NocoDB. Its two preserved local Postgres resources are Docker-internal only: neither publishes a host port, and the former 5433/5434 proxy sidecars are disabled in Coolify. Its former admin and workflow-worker applications are retired and stopped; the duplicate Studio is still running cleanup debt and is not a production route. It is no longer the public AI Dream API origin. |
| **`/srv` dev host** | `srv504398.hstgr.cloud` · `77.37.62.64` · `*.dev.codematrx.com` | The main box. Runs the control plane, all the per-project apps, the shared DB, and the hosted sandbox tier. **This is what the Server Manager manages.** |
| **EC2 `matrx-sandbox-host-dev`** | AWS `i-084f757c1e47d4efb` · `54.144.86.132` | The **EC2 sandbox tier** — runs its own sandbox orchestrator (systemd) + the sandboxes it spawns. **Also hosts the microservices**: `matrx-files` and `matrx-seo`, both behind the one `matrx-files-tls` Caddy container on :443 (`https://files.matrxserver.com`, `https://seo.matrxserver.com` — see §EC2 services). |
| **Retired EC2 `matrx-python-server`** | AWS `i-0241f4fee60fb02f6` · stopped 2026-08-20 | Retained hardware record only; it runs no production workload. Both sandbox tiers use the private ECS AI Dream endpoint. Release automation and Manager controls cannot revive the former replica. |

> Both EC2 boxes are in AWS account `872515272894`, region `us-east-1`.

### ⚠️ `matrx-coolify-2` — the MCP VPS (was missing from this inventory until 2026-08-09)

| Machine | Address | What it is |
|---|---|---|
| **`matrx-coolify-2`** | `191.101.15.190` · `srv1350760.hstgr.cloud` · `*.mcp.aimatrx.com` | Hostinger KVM 2 (Ubuntu 24.04) running **its own Coolify** — the `matrx-mcp-template` deployment target. Serves `coolify.mcp.aimatrx.com`, `seo-tools-python.mcp.aimatrx.com`, `seo-tools-ts.mcp.aimatrx.com`. **Not** managed by the Server Manager, not the same as aidream's Coolify (`matrx-main` / `89.116.187.5`). |

**🔐 OPEN SECURITY ITEM (2026-08-09):** its **SSH host key changed** —
`known_hosts` holds `SHA256:THIoyvaHTI1yQj/Z9y4kHRv6CvR2u0xizY/CmBrrgnI`, the box
now presents `SHA256:FMEYfCmbm+uy4lr8K77uQS1/qcY9yNgtxxN+RepbLRw`. **A rebuild
was NOT confirmed** — CT logs show only a routine 60-day cert renewal (2026-06-09
→ 2026-08-08), all services stayed up, and the SSH banner only moved
`Ubuntu-3ubuntu13.14` → `13.18` (a patch, which does *not* regenerate host keys).
Every provider credential for this box is empty in `matrx-mcp-template/.env`
(moved to Doppler), so hPanel could not be reached. **Do not re-key or connect**
until the fingerprint is verified against the Hostinger VNC/serial console.
Full write-up: `aidream/FOUND_DEFECTS.md` → "matrx-coolify-2 SSH host key changed".

> Health note: all three public MCP-plane endpoints returned HTTP 200 on
> 2026-08-20. This plane remains separate and is intentionally untouched by the
> production AWS migration.

### EC2-hosted services (not on `/srv`)

> Cross-repo system-of-record: `/Users/armanisadeghi/code/common-docs/systems/matrx-files-service/FEATURE.md` — full contract, deploy state, and cutover plan for matrx-files.

| Host | Service | Runs as | Endpoint | What it is |
|---|---|---|---|---|
| `matrx-sandbox-host-dev` (`i-084f757c1e47d4efb`, `54.144.86.132`) | **Matrx Files** | docker container `matrx-files` (v0.2.62 verified 2026-08-20, uvicorn :8080, `--restart unless-stopped`) | `https://files.matrxserver.com` (Cloudflare-proxied → public ACME origin TLS :443 → app 127.0.0.1:8080) · health `GET /files-service/health` | The independent file microservice carved out of aidream (all cloud storage / media / PDF / sharing). Own matrx-orm pool onto the shared East Supabase `files` schema; Supabase-JWT auth. Env at `/etc/matrx-files.env` (root 600). Manage via the Manager's host exec (`POST /api/hosts/matrx-sandbox-host-dev/exec` → `sudo docker …`). |
| `matrx-sandbox-host-dev` (`i-084f757c1e47d4efb`, `54.144.86.132`) | **Matrx SEO** | docker container `matrx-seo` (v0.1.95 verified 2026-08-20, uvicorn :8081, `--restart unless-stopped`) | `https://seo.matrxserver.com` (Cloudflare-proxied → the shared public ACME origin TLS :443 → app 127.0.0.1:8081) · health `GET /health` · readiness `GET /health/ready` | The **first domain vertical** — SEO measurement for subscribed clients. Owns the `seo.*` schema on the ONE East database and connects as the restricted **`svc_seo` role**. Env at `/etc/matrx-seo.env` (root 600). Runbook: `aidream/packages/matrx-seo/DEPLOY.md`; deploy/rollback `./deploy.sh <version>`. Manage via the Manager's host exec, same as matrx-files. |


---

## 2. Control plane & infrastructure (on `/srv`)

| URL | Service | What it does |
|---|---|---|
| `manager.dev.codematrx.com` | **Server Manager** (`matrx-manager`) | The brain — this admin UI. Manages every container, instance, sandbox, and the host itself. |
| `deploy.dev.codematrx.com` | **Deploy Server** (`matrx-deploy`) | The recovery lifeline — rebuilds the Manager if it breaks. |
| `orchestrator.dev.codematrx.com` | **Sandbox Orchestrator** (`matrx-orchestrator`) | Spawns/manages the hosted-tier agent sandboxes. |
| `traefik.dev.codematrx.com` | **Traefik** (`traefik`) | Reverse proxy — routes ALL these URLs + manages TLS certs. |
| `pg.dev.codematrx.com` | **pgAdmin** (`pgadmin`) | Web UI for the databases. |
| *(no public URL)* | **Shared Postgres** (`postgres`, pgvector) | The main shared database. |
| *(no public URL — 127.0.0.1:5499 ONLY)* | **Replay Mirror** (`matrx-replay-mirror`, `pgvector/pgvector:pg17`) | A full writable **mirror of Matrx Main** for real-execution replay (Dynamic Agent Graph D-25 / C-22). Replay executes REAL tool calls; DB writes land here instead of production. 🚨 **Contains a complete copy of production data (incl. `auth.users`, `users.user_secrets`) — it is bound to loopback only and must NEVER be published or Traefik-routed.** Volume `matrx-replay-mirror-data`; config + tooling in `/srv/matrx-replay-mirror/` (root 700; `.env.source`/`.env.mirror` root 600). Refresh: `/srv/matrx-replay-mirror/run-refresh.sh` (drops and rebuilds the DB; freshness stamped in `mirror.sync_info`). Contract: `aidream/db/mirror/FEATURE.md`. Placed here rather than on `matrx-main` because that host runs tight on storage. |
| `agent-1.dev.codematrx.com` | **Agent VM** (`agent-1`) | A sysbox isolated VM environment (shell-only). |

---

## 3. Per-project apps — "Ship instances" (on `/srv`)

Each is a copy of the **Matrx Ship** app (image `matrx-ship:latest`) giving a
project its own admin portal + version tracking, with its own `db-<name>`
Postgres. Routed at `<name>.dev.codematrx.com/admin`.

| URL | Instance | Notes |
|---|---|---|
| `matrx-ship.dev.codematrx.com` | Matrx Ship | The Ship platform's own instance. |
| `ai-matrx-admin.dev.codematrx.com` | AI Matrx Admin | |
| `aidream-current.dev.codematrx.com` | Aidream Current | Version tracking for AI Dream (primary applications run on AWS ECS/Fargate; Coolify carries only stream/scraper residuals). |
| `ai-dream.dev.codematrx.com` | Ai Dream | |
| `matrx-sandbox.dev.codematrx.com` | Matrx Sandbox | Version tracking for the sandbox project (≠ the orchestrator). |
| `matrx-dev-tools.dev.codematrx.com` | Matrx Dev Tools | |
| `matrx-mcp-template.dev.codematrx.com` | Matrx Mcp Template | |
| `matrx-mcp-servers.dev.codematrx.com` | Matrx Mcp Servers | |
| `matrx-dm.dev.codematrx.com` | Matrx Dm | |
| `matrx-engine.dev.codematrx.com` | Matrx Engine | |
| `matrx-platform.dev.codematrx.com` | Matrx Platform | |

Each one also has a private `db-<name>` Postgres container (no public URL).

---

## 4. Sandboxes (agent scratch machines)

| URL / how to reach | What it is |
|---|---|
| via `orchestrator.dev.codematrx.com` → `sbx-*` containers | **Hosted tier** — dynamically spawned, per-user volumes. The real flow. |
| `http://54.144.86.132:8000` (EC2 box) | **EC2 tier** — its own orchestrator + sandboxes. Barely used. |
| `sandbox-1.dev.codematrx.com` … `sandbox-5` | **Starter pool** (deprecated) — 5 static web-terminal sandboxes, predate the orchestrator. Being retired. |

---

## 5. External / production endpoints (NOT on `/srv`)

| URL | What it is |
|---|---|
| `server.app.matrxserver.com` | The primary **AI Dream backend** API and OAuth broker. Cloudflare-proxied to the AWS production ALB and two ECS/Fargate tasks; `/health/detailed` must report `role=app_server`. |
| `db.matrxserver.com` | The canonical Supabase project `brsgrqvjdzwihsvnfqkf` in `us-east-1`. The former West project is rollback-only; its cron jobs must remain disabled. |
| `scraper.app.matrxserver.com` | The canonical scraper endpoint on Coolify `matrx-main`; valid Let's Encrypt TLS, HTTP→HTTPS redirect, liveness/readiness/version endpoints. `scraper.matrxserver.com` is a stale certificate-less alias and must not be used by consumers. |
| `www.aimatrx.com` | The **identity/OAuth provider** (Supabase-backed). Where you actually sign in. |

---

## 6. Server Manager's own API (`manager.dev.codematrx.com/api/*`)

Not for browsing — the admin UI calls these. Grouped by area:

- **Instances:** create / list / start / stop / restart / backup / restore / env / logs / exec / db-query.
- **Sandboxes (hosted):** create / list / detail / logs / diagnostics / fs / reset / extend / resume / destroy / migrate / drift.
- **Builds & images:** rebuild `matrx-ship` (streamed) / rollback / cleanup; sandbox image health + per-variant rebuilds; orchestrator restart/rebuild.
- **Hosts & access (super-admin):** EC2 SSM exec + power; local-host + container exec; live terminals (`/api/terminal` WS); agent gateway (grant/exec/fs/revoke + target catalog).
- **Microservices (the EC2 PyPI-deployed services — §1 "EC2-hosted services"):** `GET /api/microservices` (list + edge health + PyPI latest), `GET /api/microservices/:id/status`, `GET /api/microservices/:id/logs` (super-admin; `?container=tls` for the shared Caddy), `POST /api/microservices/:id/deploy` (super-admin; `?version=` or PyPI latest). Ids come from the `MICROSERVICES` registry in [server-manager/src/index.js](server-manager/src/index.js) — currently `matrx-files`, `matrx-seo`. Legacy `/api/matrx-files/{status,logs,deploy}` still work as aliases pinned to `matrx-files`. Each service also gets a fleet-health check and an `ec2:<id>` Secrets store; a service with no PyPI release reports "not deployed" instead of alarming.
- **Monitoring:** system / fleet-health / db-health / activity (audit log).
- **Auth:** `/api/me`, `/api/auth-config`; tokens CRUD (super-admin).

Full route definitions live in [server-manager/src/index.js](server-manager/src/index.js)
and the agent-gateway contract in [AGENT_GATEWAY_API.md](AGENT_GATEWAY_API.md).
