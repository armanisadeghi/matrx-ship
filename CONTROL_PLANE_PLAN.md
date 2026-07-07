# Matrx Ship — Total Control Plane + Real-Infra Agent Access

> Active build plan. Vocabulary from [NAMING.md](NAMING.md). This is the durable, teammate-visible copy; the agent's working copy is at `/root/.claude/plans/`.

## Goal

1. **Total UI control plane.** The Ship admin UI gives the operator *full, direct* control over **everything** — AWS, every box, every container, real interactive terminals — because the operator almost never SSHes to the server and wouldn't know what to do there.
2. **Real-infra agent access (hijack the sandbox mechanism).** Give *coding agents* REAL live access (like a human operator) to **this `/srv` host** and the **management containers** — explicitly NOT sandboxes and NOT what end-users get. Gated + audited.

## The central insight — why "hijack the sandbox" works

The sandbox agent-access stack is four generic, target-agnostic layers:

1. **`matrx_agent` daemon** (`matrx-sandbox/sandbox-image/sdk/matrx_agent/`, port 8000 in each box). Plain shell/fs/git/pty/processes/search over HTTP. **No auth of its own** (trusts the network boundary). Only sandbox-ism = hardcoded `/home/agent` root → parametrize with `WORKSPACE_ROOT`. Routes: `POST /exec/stream` (SSE), `WS /pty` (real `pty.fork` bash), `/fs/*`, `/git/*`, `/processes`, `/ports`, `/search/*`, `WS /fs/watch`, `/credentials`.
2. **Orchestrator proxy** (`matrx-sandbox/orchestrator/`). `/{sandbox_id}/{fs,exec,git,pty,...}` → `http://<container_ip>:8000/<path>`. Auth enforced here, not on the daemon. `routes/sandboxes.py:583-689`.
3. **Scoped-token auth** (`orchestrator/auth/sandbox_token.py`). HMAC-SHA256 JWT (`MATRX_ACCESS_TOKEN_SECRET`). `POST /sandboxes/{id}/agent-binding` mints `{base_url, access_token, root_path, expires_at}`, TTL ≤900s.
4. **Consumer** (`aidream/packages/matrx-ai/matrx_ai/tools/_sandbox_proxy.py`). Tools read `SandboxBinding` from `AppContext.metadata["active_sandbox"]`, call `{base_url}/fs/...` with `X-Sandbox-Access-Token`. **Tools have zero knowledge they're in a sandbox.**

**So:** to give an agent real fs/shell/git/pty on the `/srv` host or a management container, run a `matrx_agent` daemon there (localhost-bound), register the target, mint a scoped token, hand over the same binding shape. No agent-tool changes. Recommended transport = daemon-on-target + thin proxy; alternative = back the same routes with `docker exec`/SSM.

## Workstream A — UI control plane for everything

- **A0** AWS SDK + `matrx-admin` cred into the Manager (`@aws-sdk/client-{ssm,ec2,ecr,cloudwatch-logs,cloudtrail,s3}`; cred in `/srv/apps/server-manager/.env`; new `src/aws.js`). *Unblocks all AWS work.*
- **A1** Run a command on any EC2 box from the UI (`POST /api/hosts/:id/exec` → SSM SendCommand + SSE stream).
- **A2** Real browser terminals (the headline): host + containers via the `matrx_agent` `WS /pty` proxy; EC2 via SSM StartSession. One xterm.js component, target picker. *Net-new — no PTY/WS/xterm exists today.*
- **A3** AWS views + EC2 lifecycle (describe/start/stop/reboot, ECR, CloudWatch Logs, CloudTrail audit, S3).
- **A4** Round out local control (~~HTTP file editor~~ **DELIVERED 2026-07-07 as `/admin/files`** — host + both EC2 boxes over SSM, `.bak` on save; plus Secrets EC2 remote stores w/ Apply-restart. Remaining: surface `docker_*` as UI actions, safe command console).
- **A5** "Fleet"/"Hosts" registry (activate `infra_servers`) — single pane over `/srv` + both EC2 boxes.

## Workstream B — real-infra agent access (the hijack)

- **B0** Parametrize `matrx_agent` (`WORKSPACE_ROOT`) + run it on real targets (systemd on `/srv` localhost-bound; privileged sidecar w/ docker socket for mgmt containers).
- **B1** Register real targets (`host:/srv`, `container:<name>`, `ec2:i-…`) in a Manager-side `infra_targets` registry (kept OUT of `sandbox_instances`).
- **B2** Mint scoped, short-TTL, audited bindings for infra targets (reuse HMAC machinery).
- **B3** Hand the binding to matrx-ai via `AppContext.metadata["active_sandbox"]` → fs/shell/git tools operate on real infra unchanged. UI "Grant agent access to <target>".
- **B4** Audit + revocation (Manager audit store + CloudTrail; expiring/revocable tokens; optional allowlists).
- **B-alt** For containers we won't run a daemon in: back the same contract with `docker exec` behind a daemon-shaped shim.

## Security model (mandatory, both workstreams)

Maximum power + strong audit + easy revocation, **no approval gates** (matches operator intent). Reuse existing auth; invent nothing new.
1. Never expose a `matrx_agent` daemon publicly — localhost/private only, all access via the authenticated proxy.
2. Roles `admin`/`deployer`/`viewer` + new `agent` (`sk_agent_*`). Terminal + real-infra exec = admin/agent only.
3. Scoped, time-boxed, revocable tokens (HMAC `jti`).
4. Audit everything (Manager audit log + CloudTrail for SSM) with a `/audit` UI.
5. Cred hygiene: `matrx-admin` only in `/srv/apps/server-manager/.env`; fix the stale `matrx-ship/.env` AWS key.
6. Keep the destructive-op guard (`MATRX_DESTRUCTIVE_OPS=1`).

## Fleet facts (verified 2026-05-25)

- **Cred:** `matrx-admin` (AdministratorAccess + SSM) in `/srv/projects/sec/aws_matrx-admin_accessKeys.csv` — works; SSM reaches both EC2 boxes. Host has boto3 1.42, no aws-cli. Manager (Node) has no AWS SDK yet.
- **EC2 (acct 872515272894, us-east-1):** `i-084f757c1e47d4efb` matrx-sandbox-host-dev (EC2 orchestrator, systemd; slim sandboxes run here); `i-0241f4fee60fb02f6` matrx-python-server (aidream backend, docker; env from `/etc/aidream/app.env`).
- **Mgmt containers:** traefik, postgres, pgadmin, matrx-manager, matrx-deploy, matrx-orchestrator, agent-1. ~13 Deployment stacks. Sandboxes: `sbx-*` slim + deprecated `sandbox-1..5`.

## Phasing

0 persistence → 1 A0 → 2 A1 → 3 B0+B1 → 4 A2 (terminals) → 5 B2+B3 → 6 A5 → 7 B4 + A3/A4 hardening. Each phase independently useful; ~2 weeks total.

## Manager deploy reminder

Build context = **repo root**: `docker build -t matrx-ship-manager:latest -f server-manager/Dockerfile .` then `cd /srv/apps/server-manager && docker compose up -d --force-recreate`. Admin UI typecheck: `cd server-manager/admin && ./node_modules/.bin/tsc --noEmit`. To check if FE wires an endpoint, grep the `API.*` constant name, not the raw URL.
