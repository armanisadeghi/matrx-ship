# Matrx Ship — CLAUDE.md

## The six laws (SYNCED — canonical: common-docs/skills/campaign-pattern; edit there, never here)

🚨 **MANDATORY: before launching, coordinating, or working any large build or campaign, READ the full doctrine — it is IN THIS REPO at `.claude/skills/campaign-pattern/SKILL.md`.**

1. **Done means done — never on your own word.** Finished = verified by someone who did not build it, against the original vision, on the live surface, with real data. Tests feeding manufactured data to their author's own code prove nothing and are defects.
2. **Attack before you trust.** Hole-poke plans before commitment; adversarially re-verify "done" before believing it.
3. **Fix the class, never the instance.** Root cause → census the siblings → a guard proven failing-then-passing.
4. **Nothing fails silently.** Every stand-in announces itself with a remedy; a screen is absent or honest — never dead, disabled-looking, or lying.
5. **Think in platform primitives.** Never scope a capability to the feature that surfaced it; build it in the shared layer so every module and client app inherits it.
6. **Opinions become knobs.** Behavioral choices are org-configurable settings; organizations decide — never agents, never hardcoded taste.


**Purpose of this file** (per the [CLAUDE.md charter](../common-docs/policies/claude-md-charter.md)):
you are here because you're working on the **deployment / version-tracking / infra
control plane**. This file holds ship-specific rules and conventions, plus pointers to
the docs and shared systems that carry everything else. It does NOT hold feature
detail, capability inventories, status history, or rule bodies that have a canonical
doc — add those to their canonical home and link them, or don't add them at all.

## What this repo is

Universal deployment, version tracking, env management, and infrastructure
orchestration for all Matrx projects. One repo runs the whole platform: a CLI for
project authors, a per-project admin app, the host's control plane, and the bootstrap
scripts that built the server in the first place.

## Where to read for depth

| Question | Read |
|---|---|
| The big picture — where the platform is going | [MASTER_PLAN.md](MASTER_PLAN.md) |
| Total control plane + real-infra agent access (active build) | [CONTROL_PLANE_PLAN.md](CONTROL_PLANE_PLAN.md) |
| AWS production topology + live migration ledger | [common-docs production infrastructure](../common-docs/systems/infrastructure/production-infrastructure/FEATURE.md) |
| Generated customer-MCP hosting | [common-docs mcp-hosting](../common-docs/systems/infrastructure/mcp-hosting/FEATURE.md) |
| Agent shell/file access to hosts (HTTP API) | [AGENT_GATEWAY_API.md](AGENT_GATEWAY_API.md) |
| What a term means (instance / sandbox / orchestrator / deployment) | [NAMING.md](NAMING.md) — when a word is ambiguous, it wins |
| What's moving into the UI next (read before adding any ops command) | [UI_REFACTOR_PLAN.md](UI_REFACTOR_PLAN.md) — its top status block, not the phase bodies, is current |
| Architecture, how the pieces fit | [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md) |
| CLI reference | [README.md](README.md), [cli/README.md](cli/README.md) |
| Deploy a Ship instance / bootstrap a fresh server | [DEPLOY.md](DEPLOY.md), [SERVER_BOOTSTRAP.md](SERVER_BOOTSTRAP.md) |
| Operational runbooks (recovery, certs, env vars, PAT expiry) | [docs/ops/](docs/ops/) |
| Manager runtime-truth + guardrail rules (durable, load-bearing) | [server-manager/FEATURE.md](server-manager/FEATURE.md) |
| Ticket system | [TICKET_SYSTEM_DOCS.md](TICKET_SYSTEM_DOCS.md) |
| CI/CD pipeline | [CICD-SETUP.md](CICD-SETUP.md) |

## The five components

| Component | Lives in | Runs as | URL |
|---|---|---|---|
| **CLI** (Ship + Env-Sync) | [cli/](cli/) | Installed into other projects under `scripts/matrx/` | n/a — developer machines |
| **Ship App** (per-project admin + version API) | [src/](src/) | Next.js in Docker, **one container per project**, image `matrx-ship:latest` | `<project>.dev.codematrx.com/admin` |
| **Server Manager** (control plane + MCP) | [server-manager/](server-manager/) | Express + MCP + Next.js admin, container `matrx-manager` | `manager.dev.codematrx.com` |
| **Deploy Server** (Manager's lifeline) | [deploy/](deploy/) | Next.js, container `matrx-deploy` | `deploy.dev.codematrx.com` |
| **Infrastructure templates** | [infrastructure/](infrastructure/) | Provisions a fresh host; bootstrap-only | n/a |

Plus two shared packages: [packages/admin-ui/](packages/admin-ui/) (component library
used by both admin UIs) and [packages/ticket-widget/](packages/ticket-widget/)
(published as `@matrx/ticket-widget`, embedded in external apps).

## Ship-specific rules (the mistakes this file exists to prevent)

- **The CLI is published by URL.** `install.sh` / `migrate.sh` are fetched from GitHub
  raw, so CLI changes go live the moment they hit `main`. Test before merging. When
  adding commands, update BOTH [cli/ship.ts](cli/ship.ts) and
  [cli/ship.sh](cli/ship.sh) (not every Matrx project is a Node project), plus the
  target lists in `install.sh`/`migrate.sh`.
- **The Ship app is one-container-per-project, one-DB-per-instance.** Multi-tenant in
  deployment only — never add cross-instance data assumptions. Changing the app means
  rebuilding `matrx-ship:latest` and recreating every instance for it to land
  everywhere.
- **The Server Manager directly mutates the host filesystem and Docker daemon.**
  Bugs there can wipe instances or corrupt `/srv/apps/deployments.json` (which only
  the Manager writes). Test on `apps/<test-name>/` before real instances. The main
  Express surface is [server-manager/src/index.js](server-manager/src/index.js)
  (~5,600 lines) plus sibling modules (`agent_gateway*.js`, `aws.js`, `ops_triage.js`,
  `supabase.js`, `terminal_ws.js`, `oauth_auth.js`) — no separate routes/services
  tree. Durable runtime-truth and guardrail rules:
  [server-manager/FEATURE.md](server-manager/FEATURE.md).
- **The Deploy server is the safety net, kept independent on purpose.** Its job is
  recovering the Manager when the Manager is broken — don't add features to it that
  depend on the Manager being healthy. Its `/manager` "Update + Restart" button is
  also how Manager env changes take effect:
  [docs/ops/04-environment-variables.md](docs/ops/04-environment-variables.md#how-manager-env-changes-take-effect).
- **`infrastructure/` is bootstrap-only.** Changing it does nothing to the live host
  until someone re-bootstraps; the live configs are under `/srv` on the host.
- **`packages/admin-ui/` changes cascade** into both the Ship admin and the Manager
  admin. The ticket widget's public API (`TicketProvider`, `TicketButton`,
  `TicketForm`, `TicketTracker`, `useTicketConfig`) is a stable external contract.
- **This repo ships itself:** push-to-main → CI builds GHCR images → the host's
  2-minute poller (`matrx-ship-deploy.timer` → [scripts/pull-deploy.sh](scripts/pull-deploy.sh))
  deploys them, Manager-health-gated with rollback. The GHA SSH deploy job is
  best-effort only. Deploy runbooks: [docs/ops/](docs/ops/).
- **Never inject a `DATABASE_URL` into a Matrx package's container.** Ship provisions
  env for every project, so this repo is where a config chain would get born: a Matrx
  service gets exactly ONE connection variable set
  (`SUPABASE_MATRIX_HOST/_PORT/_DATABASE_NAME/_USER/_PASSWORD` + `_SSL`) and raises
  without it. Ship's OWN per-instance `DATABASE_URL` and the host's `POSTGRES_*` are
  a different product's connection and are unaffected. Canonical:
  [package-vs-implementation](../common-docs/policies/package-vs-implementation.md).

## Platform laws (one-liners — the rule bodies live in the linked canonical docs)

- **Shared checkout, many concurrent writers is NORMAL** — commit+push to
  `origin/main` continuously, never tree-wide destructive git, never request your own
  branch/worktree/PR. [shared-checkout](../common-docs/policies/shared-checkout.md)
- **No hardcoded agents** — a job point in code is a Mandate (stable name + I/O
  contract); what fulfils it is chosen live from a UI, never welded into code.
  [Mandates](../common-docs/systems/mandates/FEATURE.md)
- **No unapproved schedules** — every scheduled task exists only with Arman's
  approval by name and interval, registered and claim-deduped via `schedule_claim`.
  [Master schedule registry](../common-docs/operations/scheduled-tasks.md)
- **Limits are knobs, and agents set them** — every ceiling/quota/gate is a
  per-feature admin-adjustable knob with an agent-chosen starting value, never a
  hardcoded constant or an absent control.
  [limits-are-knobs](../common-docs/policies/limits-are-knobs-agents-set-them.md)
- **We don't do legacy** — a replaced system is migrated, repointed, and deleted;
  never frozen, never run beside its replacement, never a keep-or-kill question.
  [no-legacy](../common-docs/policies/no-legacy.md)
- **Every org-scoped write carries an explicit `organization_id`.** Never borrow a recent,
  personal, active, or system org when context is missing. Emergency work order:
  `/Users/armanisadeghi/code/common-docs/projects/no-db-assigned-org/PLAN.md`.

- **Logging into any Matrx UI**: sign in as `admin@admin.com` — the password is `AI_ADMIN_PASSWORD` in the `.env` of `aidream` or `matrx-frontend` (`AI_ADMIN_USERNAME` holds the email).
