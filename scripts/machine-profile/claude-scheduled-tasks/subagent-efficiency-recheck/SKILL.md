---
name: subagent-efficiency-recheck
description: One-time re-measure of helper-agent spend one week after the 2026-10-03/04 Sonnet-default + budget changes
---

One-time measurement. Read-only; change nothing. Use one Sonnet `quick` helper (model sonnet) for the scan and keep your own work small.

Context: on 2026-10-03/04 the helper-agent rules changed (Sonnet is the default helper model, Opus needs a stated reason with at most 2 at once, helpers cannot spawn helpers, step budgets, unused tools removed). Baseline for 2026-09-26 → 2026-10-04 from transcripts under __HOME__/.claude/projects (main sessions = <dir>/<id>.jsonl, helpers = <dir>/<id>/subagents/*.jsonl), priced at API list rates (per 1M tokens: Opus 5.5 in 4 / cache-write 5 / cache-read 0.20 / out 20; Sonnet 5.5 2 / 2.5 / 0.20 / 10; Fable 5.1 10 / 12.5 / 0.25 / 50; Haiku 1 / 1.25 / 0.10 / 5), deduping assistant turns by message id:
- Helpers on Opus $51.4k, helpers on Sonnet $4.7k, helpers on Fable $0.9k; main sessions $31.8k; total $88.9k.
- Opus share of helper spend ~90%. 88% of helper tokens came from helper runs over 100 turns. Median helper first-turn context ~93k (frontend) / ~70k (workspace).
- 75% of Opus helper cache-write tokens were large re-writes (>40k) after a 5–60 minute pause.

Measure the same numbers for files modified 2026-10-04 → now (prorate to the same number of days), plus: share of helper runs dispatched as quick/standard/deep/coordinator (from each run's .meta.json), share on Opus, median and p90 turns per helper, count of helpers that spawned helpers, and how many helpers stopped with HANDOFF or BLOCKED_ENV.

Also measure the 2026-10-04 additions:
- Use of the new helper types browser-tester, reviewer, researcher and coach (.meta.json agentType): counts, tokens, and API-priced cost.
- One-hour cache trial: only browser-tester runs with a one-hour cache (usage.cache_creation.ephemeral_1h_input_tokens); every other helper uses five minutes. Compare browser-tester against the other helpers on the share of cache-write tokens that are large re-writes (>40k) after a 5–60 minute pause, and on cache-write cost per run. Say plainly whether the one-hour cache paid off and whether to extend it to other helpers.
- Coach rounds: how many playbook Lessons were added (git log in common-docs for "playbook:" commits), and whether later runs of the same helper used fewer turns.

Report to Arman in the chat in plain English (no file paths, no codenames): a short before/after table, what got better, what did not, and at most three suggested next adjustments with your recommendation. End with a short pending list.