# Matrx Ship UI Refactor Plan

**Goal:** every recurring server operation lives in the Ship UI. SSH is for emergencies, not for routine work. New operational tasks can be added by following an established pattern (MCP tool → HTTP endpoint → admin UI page) with no architectural decisions to make.

**Last updated:** 2026-05-25 · **Vocabulary:** see [NAMING.md](NAMING.md) — the canonical taxonomy this plan uses (Server → Project → Deployment → Sandbox → Template → Image).

---

## Status update — 2026-05-25 (read this first; the phase bodies below predate it)

Reconciling the plan against what's actually shipped on `manager.dev.codematrx.com/admin` today:

- **Phase 2 (sandbox image builds — the incident fix): DONE & LIVE.** Backend (`/api/sandbox-images/{health,build/stream}`, `/api/orchestrator/{build/stream,restart}`) + UI live on the **orchestrator-sandboxes page** (per-variant rebuild buttons, image-health badges, restart/rebuild orchestrator, missing-required warning, streamed logs). Two global guardrail banners (`SandboxImageBanner`, `FleetHealthBanner`) in the admin layout. **Note:** the rebuild controls live *on the orchestrator-sandboxes page*, not a dedicated page — see "IA debt" below.
- **Bonus shipped (not in original plan): Fleet Health** — `/api/fleet-health` + `/fleet-health` page: read-only monitor for orchestrator code/config drift (hosted vs ec2), stale/missing images, and recent deploy failures. This is the "catch silent failures before they bite" surface.
- **Phase 1 partial** (verified 2026-05-25 against the live manager):
  - orchestrator restart ✅ (on orchestrator-sandboxes page), per-sandbox agent-env viewer ✅.
  - **Supabase sync/restore**: endpoints exist but **the manager has no `SUPABASE_*` env configured** → a UI page is *premature* (it'd render "not configured"). Either wire Supabase creds first, or skip — registry DR via Supabase isn't active here.
  - **S3 archival**: endpoints exist AND the manager **is configured** (`AWS_*` + `S3_BACKUP_BUCKET` set) → a small S3 status/list/upload page is the cleanest viable Phase-1 page if one is wanted.
  - **Still pending**: Traefik reload button, docker-prune button, systemd-status tab, Deploy-self-rebuild proxy page (note: the System page's existing "self-rebuild" is the *Manager's*, not the *Deploy server's*).
- **Fleet Health is correctly flagging a known critical:** EC2 orchestrator has 0 aidream secrets loaded (hosted has 163) → EC2 aidream-template boxes fail. Known since 2026-05-24; EC2 tier is barely used (~1 sandbox) and the production path is slim + co-located AI Dream, so this is low-urgency. The fix is **EC2-host config (SSM), not a `/srv` change**. Don't soften the alert — that would mask it.
- **Phases 3 (repo sync), 4 (config mgmt), 5 (ops tooling beyond Fleet Health), 6 (multi-host): still pending.**

> **2026-07-07 status correction:** **Phase 3 is superseded** — push-to-main now self-deploys via host pollers (`matrx-hosted-deploy.timer` for matrx-sandbox, which auto-resets the checkout to origin/main every 2 min; `matrx-ship-deploy.timer` pulls the GHCR images CI builds). **Phase 4 is largely delivered** — `/admin/files` edits any file on the /srv host and both EC2 boxes (SSM, `.bak` on save), and the Secrets page now covers EC2 env files as remote stores with a one-click "Apply (restart)". The EC2 "no aidream secrets" fix mentioned above is now doable entirely from the Manager UI (Secrets → `ec2:sandbox-orchestrator`). Remaining Phase-4 work is versioning/cataloging only; "five operations still need SSH" (below) is stale — recount at next planning pass.

**Architecture moved since this plan was written (absorb into any future phase work):** the sandbox platform now has **slim** boxes (git-persistence, the default Template), a **warm pool** + `claim` (~0.5s launch), per-user **memory** (Postgres), **expiry/reaper/resume** lifecycle, and **co-located AI Dream** (full AI Dream on EC2 driving lean boxes over the private LAN). The Orchestrator is v0.3.0 on both Tiers. None of these have first-class admin-UI representation yet — when Phase work resumes, the sandbox pages should surface Template, warm-pool status, memory, and TTL/expiry. NAMING.md defines all these nouns.

**IA debt (deliberate, deferred — do NOT hastily patch):** image-rebuild controls are on the "Orchestrator Sandboxes" page, which conflates live-sandbox inspection with image management. The cleaner home is a dedicated **Sandbox Images** page in the Operations group (discoverable via sidebar; the missing-image banner would link there). Doing it right means *moving* the toolbar out of orchestrator-sandboxes (trim to a "Manage images →" link, keep the missing-required warning there) — not duplicating it. A reviewed change, not an autonomous quick-patch. (A duplicate page was built + reverted on 2026-05-25; the lesson: to check whether the FE wires an endpoint, grep the `API.*` constant names, not raw URL strings.)

---

## What this plan replaces

Three explore agents catalogued the entire Ship + Sandbox surface area. The findings doc that informed this plan is below in `## Reality snapshot`. The TL;DR:

- **Manager has 64 HTTP routes + 35 MCP tools.** Most of what we need is already there. The gaps are real but smaller than expected.
- **Five operations still need SSH today** (the items in [`Phase 2`](#phase-2--sandbox-image-builds-the-incident-fix-2-days) and [`Phase 3`](#phase-3--repo-sync--code-deployment-1-day)). The 2026-04-30 sandbox-image incident was one of them.
- **Several capabilities are 100% backend-ready but UI-missing** ([`Phase 1`](#phase-1--cheap-ui-wins-12-days)) — these are free wins.
- **The Ship App schema already includes `infra_servers` and `infra_instances`** (per [drizzle/](drizzle/)) but they're inactive. There's a long-game multi-host vision baked into the schema that nobody's building toward.

Everything else (instance lifecycle, builds, rollback, tokens, sandbox lifecycle, S3, Supabase) is already fully UI-driven via the Manager admin at `manager.dev.codematrx.com/admin`.

---

## Operating principles

These keep the system consistent as we add to it.

1. **Manager is the primary control plane.** New capabilities land in `server-manager/src/index.js` first (MCP tool + HTTP endpoint), then get wired into the manager admin UI. Don't add ops endpoints to the Ship App — it stays per-project.
2. **Deploy is the safety net.** Anything that would brick if the Manager dies (rebuilding the Manager itself, recovering from a config disaster) lives in *both* Manager AND Deploy. Deploy stays read-mostly otherwise.
3. **CLI mirrors the Manager.** Whatever an admin can do in the UI, a developer should be able to do via the Ship CLI from their laptop. This is the second-class but useful surface.
4. **Long-running ops use SSE.** The pattern at [deploy/src/app/api/rebuild/stream/route.ts](deploy/src/app/api/rebuild/stream/route.ts) is canonical. Reuse it; don't build a parallel one. The `BuildLogViewer` component in [packages/admin-ui/](packages/admin-ui/) already renders the stream.
5. **No new auth schemes.** The three roles (`admin` / `deployer` / `viewer`) on the Manager are sufficient. Every new endpoint declares its role; nothing new is invented.
6. **Versioned configs only.** If a config file lives on the host but isn't in any repo (e.g. `/srv/apps/sandbox-orchestrator/.env`), the refactor either commits a `.env.example` to the source repo OR moves the values into the Manager's env-var store. Nothing new lands in the "host-only / unversioned" bucket.
7. **Every capability ships with an MCP tool.** That way agents (Claude, the Ship CLI) can use it identically to the UI. No "UI-only" actions.

---

## Phase 1 — Cheap UI wins (1–2 days)

These are capabilities that the Manager backend already exposes but no admin UI page calls. Pure plumbing — no new backend code, no architectural decisions.

| Capability | Backend exists at | UI work |
|---|---|---|
| **Supabase deployments-registry sync** | `POST /api/supabase/sync`, `POST /api/supabase/restore`, `GET /api/supabase/status` ([index.js](server-manager/src/index.js)) | New page `admin/(dashboard)/supabase/page.tsx` — two buttons + status card. |
| **Restart sandbox orchestrator** | `docker_compose` MCP tool can do this; needs a 4-line endpoint wrapper | Add button to existing `admin/(dashboard)/infrastructure/` page. Reuses `BuildLogViewer` for output. |
| **Restart Deploy server** | Deploy already has `POST /api/self-rebuild/stream` | New page `admin/(dashboard)/deploy/page.tsx` in **Manager** admin (proxies to Deploy's endpoint). One click + log stream. |
| **Reload Traefik** | `docker_compose` MCP tool against `/srv/traefik/` | Button on infrastructure page. |
| **Run `docker system prune`** | `shell_exec` MCP tool | Button on infrastructure page with destructive-action confirm dialog. Allowlist the exact command. |
| **View per-sandbox env vars** | `GET /api/orchestrator-sandboxes/:id/agent-env` already exists | Already wired (per agent #2 finding) — verify it renders nicely on the orchestrator-sandbox detail page. |
| **Read systemd unit status** | `shell_exec` can run `systemctl status <unit>` | Add a "Services" tab to the System page that shows status of `docker`, `sysbox-runc`, etc. via an allowlisted shell call. |

**Deliverables:**
- 1 new page (`/admin/supabase`).
- 1 new page (`/admin/deploy`) in Manager.
- 1 expanded page (`/admin/infrastructure`) with three new buttons.
- 1 expanded page (`/admin/system`) with services tab.

**Effort:** 1–2 days.

---

## Phase 2 — Sandbox image builds (the incident fix) (2 days) — ✅ DONE (2026-05-24)

> **Shipped.** Backend + UI live (see the 2026-05-25 status block at the top). The build recipes (`SANDBOX_IMAGE_VARIANTS` for core/slim/local/aidream), `/api/sandbox-images/{health,build/stream}`, `/api/orchestrator/{build/stream,restart}`, the two guardrail banners, and the Fleet Health monitor all exist. The remaining bit is **IA** (a dedicated Sandbox Images page vs. the controls' current home on the orchestrator-sandboxes page) — captured as "IA debt" up top. The original spec is kept below for reference.

The 2026-04-30 incident: someone pruned the local `matrx-sandbox:*` tags; the orchestrator falls through to a registry pull and 404s; spawning was bricked until a human SSH'd in to rebuild. This phase closed that hole.

### 2.1 Backend

New MCP tools (in `server-manager/src/index.js`):

```
sandbox_image_build({ variant, no_cache, push_to_s3 }) → { tag, image_id, duration_ms, size_bytes }
  variant ∈ { "core", "local", "aidream", "all" }
  Wraps the existing build commands:
    core    → docker build -t matrx-sandbox:core /srv/projects/matrx-sandbox/sandbox-image/
    local   → docker build -t matrx-sandbox:local /srv/projects/matrx-sandbox/sandbox-local/
    aidream → bash /srv/projects/matrx-sandbox/sandbox-image/build-aidream.sh
    all     → core, then local + aidream in parallel
  Streams output via the canonical SSE pattern.

orchestrator_image_build({ no_cache, restart }) → { tag, image_id, duration_ms }
  Wraps:
    docker build -t matrx-orchestrator:latest /srv/projects/matrx-sandbox/orchestrator/
  If restart=true: cd /srv/apps/sandbox-orchestrator && docker compose up -d --force-recreate

sandbox_image_health() → { tags: [{ tag, present, image_id, age_seconds }] }
  Returns presence/age of every required local image. Used by:
    - The /admin/sandboxes/build page to show "missing" warnings
    - A Manager startup probe that surfaces a banner if any required tag is missing
```

New HTTP endpoints (all `requireRole("deployer", "admin")`):
- `POST /api/sandbox-images/build` — non-streaming wrapper around `sandbox_image_build`
- `POST /api/sandbox-images/build/stream` — SSE-streamed
- `GET /api/sandbox-images/health` — presence map of required tags
- `POST /api/orchestrator/build` — non-streaming
- `POST /api/orchestrator/build/stream` — SSE
- `POST /api/orchestrator/restart` — `docker compose up -d --force-recreate` against `/srv/apps/sandbox-orchestrator/`

### 2.2 Frontend

New admin pages:
- **`/admin/sandbox-images`** — Lists `:core`, `:local`, `:aidream` with image ID + age + size + a per-row **Rebuild** button. Top-level **Rebuild all** button. Streaming log viewer. Banner at top if any tag is missing.
- **`/admin/orchestrator`** — Image age + container status + **Rebuild** + **Restart** buttons.

Both reuse `BuildLogViewer` and the canonical SSE pattern.

### 2.3 Defensive guardrails

- **Manager startup banner:** if `sandbox_image_health()` finds any required tag missing, surface a red banner across the entire admin UI. Same pattern as the existing "outdated instances" alert.
- **Image-missing canary:** the `/health` endpoint on the orchestrator already returns `healthy` even when no images exist. Add an **`/health/deep`** endpoint on the orchestrator that also asserts `MATRX_SANDBOX_IMAGE` resolves on the host. Manager polls this and surfaces the result on `/admin/dashboard`.
- **Reverse-tag protection:** add a one-line systemd unit or wrapper that refuses `docker rmi` against any `matrx-sandbox:*` tag without a `MATRX_DESTRUCTIVE_OPS=1` env override. Stops the foot-gun at the source. Lower-priority follow-up.

### 2.4 Verification

- Spawn a fresh sandbox via the orchestrator; confirm it boots from the freshly-built image (image_id matches).
- Manually `docker rmi matrx-sandbox:aidream`; confirm the Manager admin renders a red banner; rebuild via UI; banner clears; spawning works again.

**Effort:** 2 days.

---

## Phase 3 — Repo sync + code deployment (1 day)

Source clones at `/srv/projects/{matrx-ship,matrx-sandbox,matrx-frontend,aidream}/` don't auto-pull. To pick up code changes you SSH in, `git pull`, then rebuild. Half of the rebuild work just landed in Phase 2; the missing half is the pull.

### 3.1 Backend

New MCP tools:

```
repo_status({ name }) → { name, branch, head_sha, head_message, head_age, dirty, ahead, behind, remote_url }
  name ∈ { "matrx-ship", "matrx-sandbox", "matrx-frontend", "aidream" }

repo_pull({ name, ref }) → { name, prev_sha, new_sha, files_changed, ff_only }
  ref defaults to "origin/main". --ff-only by default; refuses non-fast-forward.

repo_diff({ name, from, to }) → unified diff text
  Used to preview "what would a pull do".
```

Endpoints (`requireRole("deployer", "admin")`):
- `GET /api/repos` — array of `repo_status` for the four known repos
- `GET /api/repos/:name/diff?from=&to=` — preview
- `POST /api/repos/:name/pull` — pulls; returns the status diff

### 3.2 Frontend

- **`/admin/repos`** — Card per repo: name, branch, head SHA, age, dirty/clean badge, ahead/behind. Per-card buttons: **Diff incoming** (opens a side panel with the unified diff) + **Pull**. Top-bar **Pull all**.
- After a pull, surface a "downstream rebuilds you may want" hint:
  - matrx-ship → "Rebuild matrx-ship:latest" (already exists)
  - matrx-sandbox → "Rebuild :core / :local / :aidream" (Phase 2)
  - matrx-frontend / aidream → "(reference clones — no rebuild needed on this server)"

### 3.3 Verification

- Push a commit to `matrx-sandbox`; load `/admin/repos`; confirm the "behind by 1" badge appears with correct head_sha; click Pull; confirm it ff-merges; then trigger Phase 2 rebuild from the contextual hint.

**Effort:** 1 day.

---

## Phase 4 — Configuration management (2–3 days)

The drift audit found one critical unversioned config file: `/srv/apps/sandbox-orchestrator/.env`. There are likely others. This phase moves those into either repo (as `.env.example`) or the Manager's managed-env store, and adds a UI for editing them.

### 4.1 Catalog all `.env` and `.credentials` files

A startup task that walks `/srv/apps/*/`, `/srv/traefik/`, `/srv/postgres/`, `/srv/agent-envs/`, `/srv/.credentials` and reports every config file the Manager isn't currently aware of. Add as a Manager startup probe; surface in `/admin/configs`.

For each file found:
- Compare against any matching `.env.example` in the source repo.
- Surface drift (keys in env not in example, or vice versa).
- Surface keys that LOOK like secrets (high-entropy, contain `KEY` / `TOKEN` / `PASSWORD` / `SECRET`).

### 4.2 Backend

```
config_list() → [{ path, kind, has_example, drift_keys, last_modified }]
config_read({ path }) → { keys: [{ key, value_redacted, is_secret }] }
config_write({ path, keys: { key: value, … }, restart_after: ["container_name", …] }) → { changed_keys, restarted }
config_diff({ path, against }) → unified diff
```

Endpoints (admin-only — these write secrets):
- `GET /api/configs`
- `GET /api/configs/:path` (URL-encoded path; redacts secret values by default; `?reveal=1` for admin)
- `PUT /api/configs/:path` — atomic write + optional container restart
- `GET /api/configs/:path/diff?against=example`

### 4.3 Frontend

- **`/admin/configs`** — list-of-files page with drift badges.
- **`/admin/configs/[path]`** — key/value editor. Secrets show as `••••••` with reveal button (admin role required). Inline drift hints. Save button → confirmation dialog with the affected restart list → atomic write + restart with SSE log stream.

### 4.4 Versioning

For every file the catalog finds, the corresponding repo adds an `.env.example` with all keys (no values). This is a one-time PR per repo. Going forward, the Manager surfaces drift if an example diverges from live.

### 4.5 Encrypted backup of `/srv/.credentials`

Cron-driven (or triggered from `/admin/system`):
1. `gpg --symmetric --passphrase-file /etc/matrx-credentials-key /srv/.credentials`
2. `aws s3 cp` the encrypted blob to S3 with daily rotation (keep last 30).
3. UI on `/admin/system` shows last backup time and a "Backup now" button.

The encryption key is stored in `/etc/matrx-credentials-key` (chmod 400, root). That's the single secret an operator needs to keep out-of-band.

### 4.6 Verification

- Edit `MATRX_AIDREAM_URL` in the orchestrator .env via the UI; restart the orchestrator from the same flow; confirm the new value is reflected in spawned sandboxes.
- Run an unattended `/admin/configs` audit on a fresh sandbox spawn and observe nothing new gets added to "live-only / drifted".

**Effort:** 2–3 days.

---

## Phase 5 — Operational tooling (3 days)

Smaller items, mostly observability + recurring maintenance. Stack-rank by hazard.

### 5.1 Backup scheduling

Today: `app_backup` MCP tool exists but no schedule. Drift audit found `/srv/apps/backups/` is mostly empty.

- Add `backups_schedule({ targets, frequency, retention })` MCP tool.
- Backed by a systemd timer the Manager creates/maintains (the Manager already mounts `/host-srv` and can write systemd units via `shell_exec` — gate behind admin role).
- UI on `/admin/backups`: per-instance schedule + last-run + next-run + manual "Run now" + S3 archive status.

### 5.2 Certificate observability

Today: Traefik handles ACME automatically; no surfacing.

- New MCP tool `traefik_certs()` — parses `/srv/traefik/acme/acme.json` (read-only).
- UI card on `/admin/system`: per-domain expiry date + days-remaining badge. Red <14 days.
- Optional: Manager calls a webhook (Slack, email) when any cert is <7 days from expiry.

### 5.3 Disk pressure + cleanup

- Existing system page already shows disk %. Add: per-target reclaim suggestions (dangling images count, old backups count, log volumes).
- Buttons: "Prune dangling images" (we already added in Phase 1), "Compact old backups", "Rotate sandbox dangling layers". Each runs an allowlisted shell command with confirm + SSE.

### 5.4 Cron / systemd timer inventory

- New MCP tool `host_jobs()` — parses `/etc/cron.*`, `/etc/crontab`, and runs `systemctl list-timers`.
- UI tab on `/admin/system`: read-only inventory. Future enhancement: schedule arbitrary host jobs from UI (deferred — risky).

### 5.5 Aggregated logs across containers

Today: per-instance log streaming exists. There's no "show me everything across the host" view.

- New endpoint `/api/logs/stream?containers=traefik,postgres,manager,deploy` — multi-source SSE.
- UI: `/admin/logs/firehose` — single scroll pane with per-source color coding.

**Effort:** 3 days.

---

## Phase 6 — Bootstrap-from-UI + multi-host (1 week, deferred)

The end goal: a fresh VPS becomes a Matrx host by running ONE command (the existing `bootstrap.sh`), and every subsequent operation goes through the UI. This is achievable but bigger than the other phases. Deferred until 1–5 are done.

### 6.1 Activate `infra_servers` + `infra_instances` schema

The Ship App already has these tables ([drizzle/](drizzle/)) but no queries hit them. Wire them up:

- `infra_servers` becomes the registry of hosts the Ship platform manages. Currently this would be one row (`srv504398.hstgr.cloud`); future second host appears as a second row.
- `infra_instances` becomes the cross-server registry of Ship instances (replacing the per-host `/srv/apps/deployments.json`).

### 6.2 Multi-host control plane

The Manager today is single-host. Extending it:
- Add a `host_id` parameter to every host-mutating tool.
- Have each Manager publish a heartbeat to the central Ship App (uses `infra_servers`).
- Cross-host views in the Ship App: "all instances", "all builds", "all sandboxes" filtered/grouped by host.

### 6.3 Host bootstrap from UI

Workflow:
1. Operator provisions a fresh VPS (Hostinger / Vultr / etc.) — DNS + SSH key configured.
2. From the central Ship App, "Add host" → asks for SSH connection string.
3. Backend SSH'es in, runs `infrastructure/bootstrap.sh` from the matrx-ship repo, streams logs.
4. New host registers itself with the central Ship App; appears in the list.
5. Operator can now manage the new host through the same UI.

This stays out of scope for the immediate refactor — it's a target architecture, not a near-term deliverable. Capture as a separate plan when we want to onboard a second host.

**Effort (when picked up):** ~1 week.

---

## Out of scope

Things that came up in the analysis but I deliberately don't think the UI should grow for them:

- **Emergency shell access from UI.** The MCP tool `shell_exec` exists for agent use, but the admin UI shouldn't expose a generic "run this command on the host" textbox. That's exactly the foot-gun this whole plan exists to remove. SSH for emergencies is fine.
- **Replacing the static starter pool (`sandbox-1`…`sandbox-5`).** They're documented as deprecated and will retire when the dynamic flow is fully adopted. No UI work for them — just a docs callout.
- **Schema migrations against arbitrary Postgres DBs.** The Manager already has `app_backup` / `app_restore` / read-only `postgres_query` for instance DBs. Migrations against the shared cld_files / Supabase DB stay manual via `psql` — that's a database-engineering task, not infra ops.
- **Bootstrapping second-tier services** (NocoDB, Directus templates that exist in [infrastructure/](infrastructure/) but aren't deployed). They were exploratory. Drop the templates from the repo OR document them as on-demand opt-in deployments. Not a refactor task.

---

## Sequencing

| Order | Phase | Effort | Why this slot |
|---|---|---|---|
| 1 | Phase 2 (sandbox builds) | 2 d | Closes the actual incident gap. Highest user-visible value. |
| 2 | Phase 1 (cheap wins) | 1–2 d | Free wins; backend already works. Builds momentum. |
| 3 | Phase 3 (repo sync) | 1 d | Pairs naturally with Phase 2 (pull → rebuild). |
| 4 | Phase 4 (config mgmt) | 2–3 d | Closes the "unversioned secrets" hole. |
| 5 | Phase 5 (ops tooling) | 3 d | Quality-of-life; no urgency. |
| 6 | Phase 6 (multi-host) | 1 w | Long game; defer until after a real second-host need. |

**Total effort for Phases 1–5:** ~10 working days. Could parallelise Phase 1 + Phase 3 (different files, no conflicts) for ~8 calendar days.

---

## Reality snapshot (informs the plan above)

These are the agent findings condensed. If anything in the plan looks wrong, this is the ground truth it was built from.

### Manager today

- **64 HTTP routes + 35 MCP tools.** [server-manager/src/index.js](server-manager/src/index.js) (~2,468 lines).
- **Fully UI-driven:** instance lifecycle (create/delete/start/stop/restart/backup/restore/env-edit), build pipeline (rebuild matrx-ship + rollback + cleanup), token management, static sandbox lifecycle, orchestrator-sandbox proxy (list/detail/diagnostics/logs/agent-env/fs/reset), system info, docs browser.
- **Backend-ready but UI-missing:** Supabase sync/restore, deploy server self-rebuild, Traefik reload (via docker_compose).
- **Not implemented at all:** sandbox image builds (`:core`, `:local`, `:aidream`), orchestrator image build, orchestrator restart endpoint, repo sync, config-file editor (beyond per-instance .env), backup scheduling, cert observability, host-job inventory.

### Deploy today

- **22 endpoints, 8 pages.** Read-mostly emergency surface. Has `/api/self-rebuild/stream`. Cannot create instances or modify secrets.

### Ship App today

- **Per-project only.** 14 admin routes, ticket system, version tracking, AI triage hooks. Won't grow cross-project ops — that's the Manager's job.
- **Inactive schema:** `infra_servers`, `infra_instances` tables exist but aren't queried. Reserved for Phase 6.

### CLI today

- **Versioning, env-sync, instance provisioning.** No sandbox or orchestrator commands. Phase 2 + Phase 3 should add corresponding CLI subcommands so devs can manage from their machines (not just the UI).

### Drift audit findings

| Item | Status | Plan phase |
|---|---|---|
| Traefik / Postgres / agent-envs templates | ✅ in repo, match live | — |
| `deployments.json` / `tokens.json` / `build-history.json` | ✅ Manager-managed | — |
| `/srv/apps/sandbox-orchestrator/.env` | ❌ host-only, unversioned | Phase 4 |
| `/srv/.credentials` | ❌ host-only, unversioned, not backed up | Phase 4 (encrypted S3 backup) |
| Manager/Deploy image rebuild workflows | ❌ SSH-only | Phase 1 (deploy) + Phase 2 conceptually |
| Sandbox image builds | ❌ SSH-only | Phase 2 |
| Orchestrator image build + restart | ❌ SSH-only | Phase 2 |
| Repo `git pull` | ❌ SSH-only | Phase 3 |
| Backup scheduling | ❌ no schedule today | Phase 5 |
| Cert observability | ❌ Traefik handles, no surfacing | Phase 5 |
| Cron/timer inventory | ❌ no UI | Phase 5 |

### Reusable patterns (don't reinvent)

- **SSE log streaming:** [deploy/src/app/api/rebuild/stream/route.ts](deploy/src/app/api/rebuild/stream/route.ts) backend; `BuildLogViewer` from [packages/admin-ui/](packages/admin-ui/) frontend.
- **Per-page data hooks:** `useAdminData` + `useAdminActions` at [server-manager/admin/src/hooks/](server-manager/admin/src/hooks/).
- **Confirmation dialogs:** ad-hoc Dialog+Button compositions today. If we add a third destructive UI action we should consolidate to a `ConfirmDialog` component (see matrx-frontend's pattern). Cheap when it bites.
- **Auth roles:** `admin` / `deployer` / `viewer` via `requireRole(...)` middleware. Every new endpoint declares its role.

---

## Documentation updates that ship with this plan

- `/srv/CLAUDE.md` gets a "what's UI-driven vs SSH-only" callout and a pointer to this plan.
- `/srv/projects/matrx-ship/CLAUDE.md` gets an updated capability matrix per the agent findings + a pointer to this plan.
- Each phase ships with: docstrings on the new MCP tools, a one-line entry in the relevant CLAUDE.md, and a callout in the Manager admin UI's docs browser (`/admin/docs`).
