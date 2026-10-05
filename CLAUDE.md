# Matrx Ship — CLAUDE.md

<!-- nine-laws:start -->
## The laws (synced from `common-docs/policies/the-nine-laws.md` — edit there, never here)

1. **Done means verified, then handoff.** Build it, check types and regressions, use it in localhost as a user would, get an independent check, commit and push. Deploy agents own releases. `common-docs/policies/reality-is-the-referee.md`
2. **Attack before you trust.** Plans are attacked before commitment; "done" is re-verified by someone outside the builder's frame.
3. **Fix the class, never the instance.** Root cause, find the siblings, add a guard proven to fail then pass. A bug you hit yourself is fixed now.
4. **Nothing fails silently.** A stand-in announces itself; a screen is honest or absent; never hide a feature to dodge a defect — fix it. In-app text is layout, not prose. `common-docs/policies/interface-text-is-layout.md`
5. **Think in platform primitives.** Build every capability in the shared layer so all modules and apps inherit it.
6. **Opinions become knobs.** Organizations decide, never agents. Validation offers, never blocks. Defaults lean open.
7. **Delegate down, never sideways.** The starting session owns the task end to end; name every subagent's lane; never message another task. `common-docs/policies/subagent-model-ladder.md`
8. **A delta is not a status.** Lead with current truth and every open item.
9. **Raise the bar.** Name the world champion, match it, beat it. `common-docs/policies/champions.md`
10. **Talk to Arman like a person.** Plain English, in the chat, no paths or codenames. Tell him your decision and reason; ask only what is truly his. `common-docs/policies/talk-to-arman-like-a-person.md`
11. **Credentials change everywhere or not at all.** Never rotate a password, key or token unless the same change updates every vault, `.env` and server that uses it. A leaked credential beats a lockout.
12. **Finish your own work first.** Raise anything outside your task only when it blocks you. Never add a security obstacle, refusal or admin-only gate without Arman's explicit approval, quoted with its date; no agent is a "chair" that rules; removing obstacles is welcome. `common-docs/policies/access-ladder.md`

Also binding: the Data Doctrine (`common-docs/systems/architecture/database/DECISIONS.md`), the access ladder (`common-docs/policies/access-ladder.md`), canonical-first triage (`common-docs/policies/canonical-first-triage.md`), agents never author agents (`common-docs/policies/agents-never-author-agents.md`), and the domain tree (`common-docs/policies/domain-tree.md`).
<!-- nine-laws:end -->

**Cloud task autonomy:** A task request authorizes routine in-scope edits, verification, exact-path commits, and pushes. Continue without a conversational confirmation pause; honor explicit hold points and human-only gates. [Completion policy](../common-docs/policies/reality-is-the-referee.md).


**Purpose of this file** (per the [CLAUDE.md charter](../common-docs/policies/document-types.md)):
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
| AWS production topology + live migration ledger | [common-docs production infrastructure](../common-docs/systems/architecture/production-infra/FEATURE.md) |
| Generated customer-MCP hosting | [common-docs mcp-hosting](../common-docs/systems/architecture/mcp-hosting/FEATURE.md) |
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

- **The Platform List is Arman's alone.** Never read it at session start: a hook on Arman's Mac tells the first attended session of the day when a row is due, and only that session tells him (he snoozes by naming a new date). Only Arman adds, kills, or removes a row. Agents suggest in plain English and never write copies, histories, or "deleted" notes anywhere. Skill: `platform-list`.
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
  [Mandates](../common-docs/systems/mandates/STATE.md)
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
- **The access ladder decides who can open a record.** Every table starts at Organization; only Arman approves Confidential or Private; sharing sits outside the ladder; children inherit their parent; organizations are unlimited and equal, with no personal type. → `/Users/armanisadeghi/code/common-docs/policies/access-ladder.md`
- **Every org-scoped write carries an explicit `organization_id`.** Never borrow a recent,
  signup, active, or system org when context is missing. Emergency work order:
  `/Users/armanisadeghi/code/common-docs/systems/architecture/database/projects/no-db-assigned-org/PLAN.md`.

- **Logging into any Matrx UI**: sign in as `admin@admin.com` — the password is `AI_ADMIN_PASSWORD` in the `.env` of `aidream` or `matrx-frontend` (`AI_ADMIN_USERNAME` holds the email).
