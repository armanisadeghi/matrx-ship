# Task: Full UI + agent access to the two EC2 hosts in the Server Manager

**For:** another agent working in `/srv/projects/matrx-ship/server-manager/`
**Goal:** put both EC2 host machines into the Server Manager admin UI with a
live terminal, power/command controls, and agent (MCP) access — so the operator
can run tasks *on the boxes* with clicks instead of the AWS console, and so
agents can be pointed at them. Deploy target is `/srv` (you rebuild + deploy the
Manager yourself — NOT Vercel-gated).

## The two hosts (already registered)

`FLEET_HOSTS` in [server-manager/src/aws.js](server-manager/src/aws.js):
- `matrx-sandbox-host-dev` — `i-084f757c1e47d4efb` — EC2-tier sandbox orchestrator (54.144.86.132, priv 172.31.91.106)
- `matrx-python-server` — `i-0241f4fee60fb02f6` — co-located AI Dream backend (54.166.106.252, priv 172.31.83.75)

Both us-east-1, AWS acct 872515272894, same AZ (us-east-1d).

## What ALREADY EXISTS — extend, don't duplicate

- **[server-manager/src/aws.js](server-manager/src/aws.js):** `ssm()`, `ec2()`, `ssmRun(instanceId, cmd, {timeout})`, `ssmInstances()` (online check), `ec2Describe()`, `ec2Power()`, `FLEET_HOSTS`. Admin AWS creds (`MATRX_ADMIN_AWS_*`) are SET in `/srv/apps/server-manager/.env` and **verified working** (both boxes return `hostname/root` via SSM).
- **HTTP routes in [server-manager/src/index.js](server-manager/src/index.js)** (all `requireSuperadmin`):
  - `GET /api/hosts` — list both boxes + live SSM/EC2 status (online).
  - `POST /api/hosts/:id/exec` `{command, timeout?}` — run a shell command on a box via SSM (request/response, not a live shell). `:id` = the FLEET_HOSTS key.
  - `POST /api/hosts/:id/power` `{action: start|stop|reboot}`.
- **Admin UI** (Next.js): `server-manager/admin/src/app/(dashboard)/`, an existing web terminal at `terminal/page.tsx` + `components/web-terminal.tsx`, and the WS backend `server-manager/src/terminal_ws.js` (today only targets `container:<name>` and `sandbox:<id>`).
- **Agent access plumbing:** `server-manager/src/agent_gateway.js` + `AGENT_GATEWAY_API.md` (host access to /srv) and the ~35 MCP tools in index.js (`shell_exec`, etc.). `CONTROL_PLANE_PLAN.md` is the umbrella plan for exactly this work — read it first.

## What to BUILD (the gaps)

### 1. Admin "Hosts" page  (`admin/src/app/(dashboard)/hosts/page.tsx`)
- Lists both FLEET_HOSTS boxes from `GET /api/hosts`: name, role, instanceId, region, **online badge** (ssm.ping === "Online"), EC2 state.
- **Power buttons** (start/stop/reboot) → `POST /api/hosts/:id/power` with a ConfirmDialog.
- **Command runner** panel: textbox → `POST /api/hosts/:id/exec` → show stdout/stderr/exitCode (reuse `BuildLogViewer`/`CodeBlock` from `packages/admin-ui`). This alone makes the boxes usable from the UI.
- Add a nav entry in the dashboard layout.

### 2. Live interactive terminal for the EC2 hosts
Extend `terminal_ws.js` to accept a `host:<fleet-id>` target (today it does
`container:` / `sandbox:`), and let `web-terminal.tsx` open it for a host.
Recommended approach — **SSH bridge** (cleanest real PTY; the boxes already run
sshd):
  - One-time: generate a Manager keypair, install the pubkey on each box's
    `/home/ec2-user/.ssh/authorized_keys` (or `root`) **via `ssmRun`** (you
    already have SSM exec — no manual key handling).
  - `terminal_ws.js` for `host:<id>` spawns `ssh -tt ec2-user@<privateIp>` (use
    the box's private IP from `ec2Describe`; the Manager reaches it... note:
    the Manager runs on the `/srv` Hostinger host, which is NOT in the AWS VPC,
    so it must SSH to the **public** IP/Elastic IP, and the box's SG must allow
    22 from the Manager's egress IP — OR use SSM StartSession instead).
  - **Alternative (no SG/SSH exposure): SSM StartSession** — `aws ssm
    start-session` with the `AWS-StartInteractiveCommand`/shell document, bridged
    over the existing terminal WebSocket. Needs the `session-manager-plugin`
    binary in the Manager image (add to its Dockerfile) or a direct
    implementation of the SSM message protocol. **This is the more secure path
    (no inbound 22, no key management) — prefer it if the plugin is acceptable
    in the image.** Decide based on whether you want to open SG 22 to the
    Manager's IP (SSH bridge) or ship the SSM plugin (StartSession).

### 3. Agent (MCP) access to the hosts
- Add an MCP tool in index.js, e.g. `host_exec(host, command, timeout?)` that
  calls `ssmRun(FLEET_HOSTS[host].instanceId, command, …)` — mirrors `shell_exec`
  but for the fleet boxes, `requireSuperadmin`-equivalent gating. This lets an
  agent (or the operator's chat) run tasks ON the boxes (e.g., the S3 migration
  in `FILE_MOVE_TASK.md`) the same way it manages /srv today.
- Audit every host command via the existing `auditLog(...)` (the host routes
  already do).

## Important constraint to document in the UI

A box can only do what its **EC2 instance IAM role** allows. Today
`matrx-python-server-ssm-role` is SSM + (newly) a scoped S3 policy; the default
is SSM-only. If an agent's command on a box returns `AccessDenied`, the fix is
an IAM policy on that instance role — surface that clearly so it's not mistaken
for a Manager bug.

## Auth, deploy, verify
- Gate everything `requireSuperadmin` (matches the existing `/api/hosts/*`).
- Deploy: `cd /srv/apps/server-manager && docker compose build --no-cache server-manager && docker compose up -d --force-recreate server-manager`.
- Verify: Hosts page shows both boxes **Online**; command-runner runs `hostname` on each; the terminal opens a live root shell to each; `host_exec` MCP tool works; power buttons reflect EC2 state. Update `/srv/CLAUDE.md` + `matrx-ship/CLAUDE.md` capability matrix when done.

## Why this matters (context)
The operator is launching per-user **permanent sandboxes** (pilot: 20 users) and
consolidating everything (incl. user S3 files) into us-east-1 so sandboxes get
cheap/fast in-region file access. These two EC2 boxes are the control points for
that, and the operator wants to drive them — and point agents at them — from one
UI. See `CONTROL_PLANE_PLAN.md` and `MASTER_PLAN.md`.
