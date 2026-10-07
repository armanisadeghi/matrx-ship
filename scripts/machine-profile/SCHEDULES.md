# Which scheduled task runs where

Every agent duty claims its run first (`schedule_claim`), so two machines never double-run one. Cadence and enablement are host runtime state that cannot be copied as files; enroll them locally from the committed prompts (`claude-scheduled-tasks/`) and templates (`codex-automations/`, rendered to `~/.codex/automation-templates/` by the setup script). Approvals live in `common-docs/operations/scheduled-tasks.md`.

## Claude Code tasks

| Task | Cadence | Where |
|---|---|---|
| ship-all-claude | every 30 min at :13 and :43 | EVERY machine that is open (a machine that is not shipping falls behind) |
| docs-steward | daily about 07:23 | main machine only |
| dedupe-and-verify | daily morning | main machine only |
| agent-review-sweep | daily about 07:45 | main machine only |
| settings-rejection-routine | daily 07:42 UTC | main machine only |
| nightly-fixture-sweep | nightly 01:30 PT | main machine only |
| nightly-guest-retention | nightly 02:00 PT | main machine only |
| hourly-ship-all-sweep | superseded by ship-all-claude | do not enroll |
| adversarial-crawler-review, clone-refresh-first-run, db-safety-followup-check, db-safety-followup-check-2, db-safety-followup-day3, education-school-readiness-checkpoint, night-window-0929-data-doctrine, night-window-0930-data-doctrine, subagent-efficiency-recheck, verify-mcp-signin-24h | one-time | already fired; kept as record, do not enroll |

Not in the profile: `data-doctrine-chair-safety-net`, `skill-benchmark-campaign-resume`, `skill-campaign-safety-net` (a secret scanner or a private temp path blocked them; they are finished one-offs).

## Codex automations

Each template carries its own `rrule` and `status`. Rules: `ship-all-codex` (:43) runs on the main workstation only (Codex thread identities are host-bound); every other Codex automation is main-machine only, and a template marked PAUSED stays paused. Pattern Patrol, release watches and work-loop coordinators are main-machine duties.

## launchd (copied, never loaded by the script)

| Job | Where |
|---|---|
| com.aimatrx.night.clone-refresh (01:00 PT) | main machine only |
| com.aimatrx.night.clone-catchup-nightly (02:15 PT) | main machine only |
