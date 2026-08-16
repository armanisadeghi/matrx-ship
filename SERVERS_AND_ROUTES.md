# Servers & Routes — what we actually have

A plain map of every machine, every public URL, and what each one is. Last
verified 2026-05-26 from live `docker ps` + Traefik labels.

---

## 1. Machines (the real "servers")

| Machine | Address | What it is |
|---|---|---|
| **`/srv` dev host** | `srv504398.hstgr.cloud` · `77.37.62.64` · `*.dev.codematrx.com` | The main box. Runs the control plane, all the per-project apps, the shared DB, and the hosted sandbox tier. **This is what the Server Manager manages.** |
| **EC2 `matrx-sandbox-host-dev`** | AWS `i-084f757c1e47d4efb` · `54.144.86.132` | The **EC2 sandbox tier** — runs its own sandbox orchestrator (systemd) + the sandboxes it spawns. **Also hosts the microservices**: `matrx-files` and `matrx-seo`, both behind the one `matrx-files-tls` Caddy container on :443 (`https://files.matrxserver.com`, `https://seo.matrxserver.com` — see §EC2 services). |
| **EC2 `matrx-python-server`** | AWS `i-0241f4fee60fb02f6` · `54.166.106.252` | The **AI Dream backend** (the real aidream.ai API). Also hosts the OAuth broker. A different system — not a sandbox host. |

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

> Health note: `seo-tools-ts.mcp.aimatrx.com` returns **404** (Traefik routes it,
> app not answering). Unrelated to the key issue but unowned — nothing monitors
> this host.

### EC2-hosted services (not on `/srv`)

> Cross-repo system-of-record: `/Users/armanisadeghi/code/common-docs/matrx-files-service/FEATURE.md` — full contract, deploy state, and cutover plan for matrx-files.

| Host | Service | Runs as | Endpoint | What it is |
|---|---|---|---|---|
| `matrx-sandbox-host-dev` (`i-084f757c1e47d4efb`, `54.144.86.132`) | **Matrx Files** | docker container `matrx-files` (`matrx-files[standalone]==0.1.1` from PyPI, uvicorn :8080, `--restart unless-stopped`) | `https://files.matrxserver.com` (Cloudflare-proxied → Caddy TLS :443 → app 127.0.0.1:8080) · health `GET /files-service/health` | The independent file microservice carved out of aidream (all cloud storage / media / PDF / sharing). Own matrx-orm pool onto the shared Supabase `files` schema; Supabase-JWT auth. Env at `/etc/matrx-files.env` (root 600). First matrx-package-template package. Deployed 2026-07-13. Manage via the Manager's host exec (`POST /api/hosts/matrx-sandbox-host-dev/exec` → `sudo docker …`). |
| `matrx-sandbox-host-dev` (`i-084f757c1e47d4efb`, `54.144.86.132`) | **Matrx SEO** | docker container `matrx-seo` (`matrx-seo[standalone]` from PyPI, uvicorn :8081, `--restart unless-stopped`) | `https://seo.matrxserver.com` (Cloudflare-proxied → the SHARED `matrx-files-tls` Caddy :443 → app 127.0.0.1:8081) · health `GET /health` · readiness `GET /health/ready` | The **first domain vertical** — SEO measurement (rankings, search/analytics performance, page performance) for the subset of clients who buy it. Owns the `seo.*` schema on the ONE database and connects as the **`svc_seo` role**, granted only its schema + the platform surfaces in the package's `db/grants.yaml`; it **refuses to boot on a broad role**. Same `SUPABASE_MATRIX_*` env names as every other service — only USER/PASSWORD differ. Env at `/etc/matrx-seo.env` (root 600). Runbook: `aidream/packages/matrx-seo/DEPLOY.md`; deploy/rollback `./deploy.sh <version>`. **LIVE since 2026-07-22** (`0.1.0`) — readiness all-green, public HTTPS 200, anon 401, DB boundary verified (ungranted table → permission denied). Manage via the Manager's host exec, same as matrx-files. |


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
| `aidream-current.dev.codematrx.com` | Aidream Current | Version tracking for AI Dream (the app itself runs on EC2, not here). |
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
| `server.app.matrxserver.com` | The **AI Dream backend** API (EC2 `matrx-python-server`). Also the **OAuth broker** — `/auth/aimatrx` is what this admin logs in through. |
| `sandbox.matrxserver.com` | The **dedicated aidream server** that sandbox-attached chat turns route to (frontend channel `ec2-dedicated`). Runs as systemd `aidream.service` on `matrx-python-server`; env at `/etc/aidream/app.env` (editable from Manager Secrets, remote store `ec2:aidream-app`). Monitored by Fleet Health check `aidream-dedicated` — it once crashlooped 3 days unseen. |
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
