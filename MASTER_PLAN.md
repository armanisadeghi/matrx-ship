# Matrx Ship — Master Plan

**The highest-level strategic document for the platform.** Everything else is a sub-plan or an implementation detail of one of the stages below.

**Last updated:** 2026-05-24

> Read order: this doc for the *why* and *what-order*; [UI_REFACTOR_PLAN.md](UI_REFACTOR_PLAN.md) for the tactical detail of Stage 1; [TICKET_SYSTEM_DOCS.md](TICKET_SYSTEM_DOCS.md) for the work-management subsystem; [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md) for how today's pieces fit; [CLAUDE.md](CLAUDE.md) for orientation.

---

## 1. The North Star

> **Matrx Ship is the autonomous control plane for the entire Matrx fleet.** Every operation is driven from the UI with no SSH or out-of-band access; every project's full lifecycle (provision → deploy → version → configure → observe → recover) is managed centrally across many hosts; and the path from *"something is wrong / something is wanted"* to *"it's fixed and shipped"* is closed by supervised AI agents, with humans setting policy and approving at risk-gated checkpoints.

Two intertwined arcs get us there. They are not sequential — they converge, because the autonomous loop (Arc B) consumes the operational primitives that the UI refactor (Arc A) exposes.

- **Arc A — Operate everything from the UI.** Drive the host, then the whole fleet, entirely from the Ship UI/MCP. SSH becomes an emergency-only tool. *(This is the existing UI_REFACTOR_PLAN, extended to multi-host.)*
- **Arc B — Close the delivery loop.** Evolve the bug/work-tracking system from an advisory tracker into an engine that dispatches agents to fix and ship work, supervised. *(This is the ticket system bridged to the sandbox/agent + build/deploy machinery.)*

**The convergence point:** every capability ships as an **MCP tool → HTTP endpoint → UI page** (the platform's canonical pattern). Because operations are MCP tools, an AI agent drives them exactly as a human does in the UI. That single discipline is what makes Arc B possible on top of Arc A.

---

## 2. Honest current state (2026-05-24)

What actually exists, so the plan builds on reality:

| Area | State |
|---|---|
| Per-host instance lifecycle, build/rollback, tokens, system/db-health, log streaming | **Shipped** (Server Manager UI) |
| Sandbox/orchestrator control: visibility, lifecycle (destroy/extend/resume), image-health banner, **streaming image + orchestrator rebuilds**, restart | **Shipped 2026-05-24** (Stage 1, Phases 1–2) |
| Two sandbox tiers (EC2 + hosted), shared `sandbox_instances` table, tier-scoped liveness reconcile | **Shipped** |
| Ticket system: schema, service layer, REST API, **10 MCP tools**, admin pipeline UI, public portal, published `@matrx/ticket-widget`, AI-**triage** (assessment/proposal/complexity/autonomy-score) | **Shipped — but advisory only** |
| Multi-host fleet management | **Schema reserved, unbuilt** (`infra_*` tables defined, never queried) |
| Autonomous fix-and-ship loop (ticket → agent edits code → builds → ships → updates ticket) | **Aspirational — no bridge exists** between tickets and the execution/deploy machinery |
| Repo git-pull, config editing, backup scheduling, cert observability, cron inventory | **SSH-only** (Stage 1, Phases 3–5 — planned) |
| Notifications/alerting, cost/usage analytics, teams/multi-user RBAC | **Absent — no design yet** |

**Two truths to keep front-of-mind:**
1. The ticket system's headline feature — autonomy-driven auto-approval and agentic resolution — is **not implemented**. `autonomyScore` is stored and displayed but read by nothing; `resolve_ticket` writes a status note, it does not change code. The store has **zero linkage** to the Server Manager / sandbox orchestrator / build pipeline. Closing that gap is the single biggest greenfield opportunity (Stage 5) and the literal definition of "much more."
2. Real **security and auth debt** exists today (open-by-default Manager auth; Ship-app SQL console that isn't read-only + open admin auth; ticket dev-mode auth bypass + portal enumeration; Deploy unauth `manager/env`). This is a **cross-cutting track**, not a stage — it must be paid down alongside everything, because every new capability widens the blast radius.

---

## 3. The Stages

Each stage delivers standalone value and unlocks the next. Status tags: ✅ shipped · 🟡 in progress · ⬜ planned · 🔭 aspirational.

### Stage 1 — Single-host UI parity (no SSH for one host) — 🟡
**Goal:** every recurring operation on *this* host is a UI/MCP action. **Detail:** [UI_REFACTOR_PLAN.md](UI_REFACTOR_PLAN.md) (its Phases 1–6 map onto Stages 1–2 here).
- ✅ Phase 1 cheap wins (partial) · ✅ Phase 2 sandbox image + orchestrator build/restart (the incident fix).
- ✅ **A2** — create-sandbox from the UI (hosted tier). · ✅ **A4 guardrails** — global missing-required-tag banner + reverse-tag protection (`docker rmi`/`prune -a` of protected images refused without `MATRX_DESTRUCTIVE_OPS=1`).
- ⬜ **A3** — surface the **EC2 tier** in the Manager. *Blocked:* needs `MATRX_EC2_ORCHESTRATOR_URL` + `_API_KEY` (the hosted key is 403 on EC2); the dual-tier proxy is straightforward once those exist.
- ⬜ Phase 3 — repo `git pull` (status/diff/pull as MCP tools + UI).
- ⬜ Phase 4 — config-file catalog + editor; encrypted backup of `/srv/.credentials`.
- ⬜ Phase 5 — backup scheduling, **certificate observability**, disk-pressure cleanup, cron/systemd inventory, aggregated log firehose.

### Stage 2 — Fleet: the multi-host control plane — ⬜
**Goal:** manage N hosts, each running many instances, from one Ship App. **Detail:** UI_REFACTOR_PLAN Phase 6.
- Activate the dormant `infra_*` tables; migrate the file registries (`deployments.json`, `tokens.json`, `build-history.json`) into the DB as the source of truth.
- Add `host_id` to every host-mutating MCP tool/endpoint; per-Manager heartbeats; cross-host views ("all instances / builds / sandboxes / health, everywhere").
- **"Add host"** flow: register → SSH in once → run `bootstrap.sh` → host self-registers and is thereafter UI-managed.
- Turn on `infra_audit_log` so every fleet action is recorded immutably.

### Stage 3 — Observability, alerting & guardrails — ⬜
**Goal:** the platform tells *you* when something's wrong before a human notices. Today there is essentially **no notification system**.
- A real notification/alerting layer (Slack/email/webhook) with rules: instance down, cert expiring, disk pressure, build failed, deploy drift, sandbox stuck.
- Health canaries (deep health beyond `/health`), cert-expiry surfacing (Phase 5.2), drift detection (running image vs `:latest`, host config vs repo).
- **Cost/usage tracking** (greenfield): per-host/per-instance/per-sandbox resource + spend, agent token spend. Needed once the fleet and the autonomous loop both scale.
- Audit-trail surfacing (read `infra_audit_log` + ticket activity into one timeline).

### Stage 4 — Work management as a first-class product — ⬜
**Goal:** make the bug/feature tracker robust and trustworthy enough to be the front door for *all* work (it is "the bug tracking system and much more"). **Detail:** [TICKET_SYSTEM_DOCS.md](TICKET_SYSTEM_DOCS.md).
- **Harden:** enforce the status state machine (today transitions only warn); fix the auth bypasses + portal enumeration; scope portal access to a real reporter identity.
- **Unify intake:** widget + portal + MCP + API + **GitHub issues/PRs** + monitoring alerts (Stage 3) all become tickets with a common model.
- **Link tickets to delivery:** a ticket references the project/instance, the version it was found in, and the commit/build/deploy that resolved it (cross-link to the version + `infra_builds` data).
- SLAs, assignment/queues, dashboards, and notification hooks (Stage 3). Make `autonomyScore` *mean* something by defining the policy it will drive (consumed in Stage 5).

### Stage 5 — The autonomous delivery loop (the crown jewel) — 🔭
**Goal:** close the loop the docs already sell. This is where Arcs A and B fuse.
1. A triaged, approved ticket with sufficient `autonomyScore` is **dispatched**: the Manager spawns a sandbox (Stage 1 primitive) seeded with the repo + the ticket's agent-narrative timeline.
2. The agent edits code, runs tests **in the sandbox**, and opens a branch/PR.
3. The existing **build + deploy pipeline** runs (to a preview/instance), with results written back as ticket `test_result` activity.
4. **Risk-gated checkpoints:** low-autonomy tickets stop for human approval; high-autonomy, well-tested changes can auto-advance — governed by the policy defined in Stage 4, with `infra_audit_log` recording every autonomous action.
5. The ticket auto-updates through `in_progress → in_review → user_review → resolved`, and the reporter sees progress in the portal.

**Why it's last:** it depends on Stage 1 (sandbox/build/deploy as MCP tools — mostly done), Stage 4 (a trustworthy ticket model + autonomy policy), and Stage 3 (so a bad autonomous change is caught fast). The bridge between the ticket store and the execution machinery is the central new component to build.

### Stage 6 — Self-driving platform & scale — 🔭
**Goal:** the platform runs the fleet and improves itself.
- Teams / multi-user RBAC beyond the three Manager roles; managing external/customer projects (multi-tenant in the data sense, which today it is explicitly *not*).
- The platform proposing its own remediations (auto-open tickets from drift/alerts, auto-rollback on failed deploy), analytics-driven capacity planning.
- A genuine "one bootstrap, then everything-from-the-UI, including onboarding new hosts and new products" experience.

---

## 4. Cross-cutting tracks (run continuously, not stages)

1. **Security & auth hardening.** Close the open-by-default and dev-mode-bypass holes (Manager auth, Ship-app SQL console + admin auth, ticket reporter-token bypass + portal enumeration, Deploy unauth `manager/env`). Every new capability declares its role; nothing widens the blast radius without auth. *(Some items are high-priority enough to pull forward ahead of feature work.)*
2. **MCP-first.** No "UI-only" actions. Every capability is an MCP tool so agents and the CLI use it identically — the precondition for Stage 5.
3. **SSE for long-running ops.** The streaming-log pattern is canonical; reuse it (now proven across rebuilds + image builds).
4. **Documentation accuracy.** Keep the three `CLAUDE.md` files + the capability matrix in sync as capabilities ship. Known doc bugs to correct: `SYSTEM_OVERVIEW.md` claims autonomy 4–5 auto-approves (it doesn't yet); `TICKET_SYSTEM_DOCS.md` shows a stale `@matrx/ticket-widget` embed API (real contract is `config={{ baseUrl }}`).
5. **Schema/migration hygiene.** Code and migrations must not drift (e.g. the orchestrator `deleted_at` column exists in the live DB but not in migrations). Add backfill migrations as gaps surface.

---

## 5. Sequencing & priority

- **Now → next:** finish **Stage 1** (A2/A3 create + EC2 tier, then A4 guardrails, then Phases 3–5). This is concrete, high-leverage, and de-risks Stage 5 by completing the operational primitives.
- **In parallel, continuously:** pay down the **security** cross-cutting track — at minimum the open-auth defaults before the surface grows further.
- **Then:** **Stage 4** (trustworthy ticket model + autonomy policy) and enough of **Stage 3** (alerting) to make autonomy safe.
- **Then the payoff:** **Stage 5** autonomous loop, on top of the now-complete primitives.
- **Stage 2 (fleet)** can slot in whenever a second host is real; the `infra_*` schema is already the migration target, so it's mostly migration + `host_id` plumbing, not redesign.
- **Stage 6** is the horizon — revisit once 1–5 are solid.

---

## 6. How to extend this plan

When a capability ships: update the status tag here, update the relevant sub-plan (UI_REFACTOR_PLAN / TICKET_SYSTEM_DOCS), and refresh the capability matrix in [CLAUDE.md](CLAUDE.md). When you reach for SSH or an out-of-band action for something not covered, that's a gap — add it to the right stage. The plan is a living document; the North Star in §1 is the only fixed point.
