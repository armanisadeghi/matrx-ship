# TASK: manage the matrx-files microservice from the Server Manager dashboard

> **STATUS 2026-07-21 — DONE, and generalised.** §4's "add matrx-files to whatever
> service registry you build" is now the `MICROSERVICES` registry in
> [server-manager/src/index.js](server-manager/src/index.js): one entry per service
> (host, container, port, health/ready paths, optDir, envFile, PyPI package,
> Dockerfile path, build arg, docker-run extras, auto-deploy toggle, attempts ledger)
> driving PyPI polling, SSM upgrade+rollback, fleet-health, the Secrets store, and the
> `/api/microservices/*` routes. `matrx-seo` is the second entry. The original
> `/api/matrx-files/*` routes remain as aliases. Add the next vertical by adding a
> registry entry — no new code path.

**For:** an agent working in `matrx-ship/server-manager/`.
**Goal:** make the operator able to see, control, and configure the new **matrx-files**
microservice (running on the EC2 sandbox host) from the Manager admin UI — status, logs,
restart, version, and its env — without SSHing.

## What matrx-files is + where it runs (facts)

- Independent file microservice (cloud storage / media / PDF / sharing), carved out of
  aidream. Live at **https://files.matrxserver.com** (Cloudflare-proxied, us-east-1).
- **Host:** EC2 `matrx-sandbox-host-dev` / `i-084f757c1e47d4efb` — already in
  `server-manager/src/aws.js::FLEET_HOSTS` (key `matrx-sandbox-host-dev`).
- **Two containers on the box:**
  - `matrx-files` — the app (`matrx-files:0.1.3`, uvicorn on `127.0.0.1:8080`,
    `--restart unless-stopped`, `--env-file /etc/matrx-files.env`).
  - `matrx-files-tls` — a `caddy:2` sidecar terminating HTTPS `:443` → `127.0.0.1:8080`.
- **Machine-readable descriptor already on the box:** `/opt/matrx-files/service.json`
  (version, containers, port, env_file, security_group, health URL, manage commands).
  Read this to render the service without hardcoding anything.
- **Env:** `/etc/matrx-files.env` (root, 0600). Complete variable list:
  aidream `packages/matrx-files/DEPLOY.md`.

## You already have the primitives

`server-manager/src/index.js` exposes (all `requireSuperadmin`):
- `POST /api/hosts/matrx-sandbox-host-dev/exec {command}` — run a shell command on the box
  via SSM. **This alone does status/logs/restart today:**
  - status: `sudo docker ps --filter name=matrx-files --format '{{.Names}} {{.Image}} {{.Status}}'`
  - logs: `sudo docker logs matrx-files --tail 200`
  - restart app: `sudo docker restart matrx-files`
  - restart TLS: `sudo docker restart matrx-files-tls`
  - health: `curl -s localhost:8080/files-service/health`
  - descriptor: `cat /opt/matrx-files/service.json`

So the fastest win is a **Services panel** that shells these out; no new infra.

## What to BUILD

### 1. A "Services" view (extend the Hosts page)
For each FLEET host, discover services by reading `/opt/*/service.json` (via one
`exec`: `for f in /opt/*/service.json; do cat "$f"; echo ,; done`). Render each: name,
version, health (curl the health URL through exec), container status, and buttons:
**Restart**, **Logs** (stream via the existing `exec` or the web-terminal), **Health check**.
matrx-files is the first; the descriptor format makes it generic for the next service.

### 2. Env management for `/etc/matrx-files.env` (the important one)
The operator must edit this service's env from the UI (add/rotate a key, change a bucket)
without SSH.
- **Read (masked):** `exec` → `sudo cat /etc/matrx-files.env` → render keys with values
  masked; never log the plaintext.
- **Edit:** write the new file atomically via `exec`
  (`sudo tee /etc/matrx-files.env.new > /dev/null <<'EOF' … EOF && sudo mv … && sudo chmod 600 …`),
  then **recreate** the container (NOT restart — `--env-file` is only read at
  `docker run`): `sudo docker rm -f matrx-files && sudo docker run -d … --env-file /etc/matrx-files.env …`
  (the exact run line is in `/opt/matrx-files/service.json` / aidream `DEPLOY.md`).
- Treat this like secrets: superadmin-only, audited, values masked in the UI + never in
  logs. This env-editor is reusable for every service you add later.

### 3. Version bump / redeploy action
A button that: `exec` → edit `/opt/matrx-files/Dockerfile` version pin →
`sudo docker build -t matrx-files:<v> /opt/matrx-files` → recreate the container → verify
health. Or accept a target version as input. Reference: aidream
`packages/matrx-files/DEPLOY.md`.

## Register it (data, not code)

Add matrx-files to whatever service registry you build, keyed off the host + the on-box
`service.json`. It's already recorded in this repo's `SERVERS_AND_ROUTES.md` (§EC2
services) and the cross-repo system-of-record
`/Users/armanisadeghi/code/common-docs/matrx-files-service/FEATURE.md`.

## Guardrails

- **Env editing = secrets handling.** Superadmin-only, masked, audited, never logged.
- **Recreate, not restart, on env change** — `--restart` reuses the old env snapshot.
- Don't break the `matrx-files-tls` sidecar or the security group (443-from-Cloudflare-only;
  8080 is NOT world-exposed).
- The DB is the shared Supabase (us-west-1 today) — this service does not own it.

## Verify

After wiring: from the Manager UI, view matrx-files status + health (green), pull logs,
restart it, and do a no-op env round-trip (read → write same → recreate → health green).
Then `curl https://files.matrxserver.com/files-service/health` still returns
`{"status":"ok","package":"matrx-files"}`.
