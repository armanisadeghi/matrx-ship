# Servers & Routes — what we actually have

A plain map of every machine, every public URL, and what each one is. Last
verified 2026-05-26 from live `docker ps` + Traefik labels.

---

## 1. Machines (the real "servers")

| Machine | Address | What it is |
|---|---|---|
| **`/srv` dev host** | `srv504398.hstgr.cloud` · `77.37.62.64` · `*.dev.codematrx.com` | The main box. Runs the control plane, all the per-project apps, the shared DB, and the hosted sandbox tier. **This is what the Server Manager manages.** |
| **EC2 `matrx-sandbox-host-dev`** | AWS `i-084f757c1e47d4efb` · `54.144.86.132` | The **EC2 sandbox tier** — runs its own sandbox orchestrator (systemd) + the sandboxes it spawns. **Also now hosts the `matrx-files` microservice** (docker `matrx-files`, port 8080 — see §EC2 services). |
| **EC2 `matrx-python-server`** | AWS `i-0241f4fee60fb02f6` · `54.166.106.252` | The **AI Dream backend** (the real aidream.ai API). Also hosts the OAuth broker. A different system — not a sandbox host. |

> Both EC2 boxes are in AWS account `872515272894`, region `us-east-1`.

### EC2-hosted services (not on `/srv`)

| Host | Service | Runs as | Endpoint | What it is |
|---|---|---|---|---|
| `matrx-sandbox-host-dev` (`i-084f757c1e47d4efb`, `54.144.86.132`) | **Matrx Files** | docker container `matrx-files` (`matrx-files[standalone]==0.1.1` from PyPI, uvicorn :8080, `--restart unless-stopped`) | `http://54.144.86.132:8080` · health `GET /files-service/health` · (DNS `files.matrxserver.com` pending) | The independent file microservice carved out of aidream (all cloud storage / media / PDF / sharing). Own matrx-orm pool onto the shared Supabase `files` schema; Supabase-JWT auth. Env at `/etc/matrx-files.env` (root 600). First matrx-package-template package. Deployed 2026-07-13. Manage via the Manager's host exec (`POST /api/hosts/matrx-sandbox-host-dev/exec` → `sudo docker …`). |


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
- **Monitoring:** system / fleet-health / db-health / activity (audit log).
- **Auth:** `/api/me`, `/api/auth-config`; tokens CRUD (super-admin).

Full route definitions live in [server-manager/src/index.js](server-manager/src/index.js)
and the agent-gateway contract in [AGENT_GATEWAY_API.md](AGENT_GATEWAY_API.md).
