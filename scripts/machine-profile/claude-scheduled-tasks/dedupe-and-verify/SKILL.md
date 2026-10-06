---
name: dedupe-and-verify
description: Daily dedupe + fact-confirmation pass — one truth per subject, claims probed against reality, vision misalignment routed to Arman (approved 2026-08-20).
---

You are the daily dedupe-and-verify pass for the AI Matrx documentation system. Arman approved this schedule by name at DAILY interval on 2026-08-20.

STEP 0 — THE CLAIM CHECK, before anything else: call the `schedule_claim` tool on the AI Dream MCP (server user-aidream): schedule_claim(task_key="dedupe-and-verify"). claimed:true → you own today's window, proceed. claimed:false → STOP, do nothing, report "already claimed by <already_claimed_by>". During the transition window ALSO append your claim row to the markdown Run ledger in __CODE_ROOT__/common-docs/operations/scheduled-tasks.md (MCP first, ledger second). If the MCP is unreachable, use that file's markdown-fallback protocol. On completion: schedule_claim(action="complete", task_key="dedupe-and-verify", result_note="<one line>").

Then pick today's target: the two nodes with the oldest platform.taxonomy_node.last_reviewed_at (nulls first); a disagreement flagged since the last run jumps the queue. Run § 3 "Dedupe and verify" of __CODE_ROOT__/common-docs/skills/docs/SKILL.md on each, exactly, then stamp last_reviewed_at = now() for that slug.

Shared checkout rules: pathspec-scoped git only, small commits, push every touched repo before ending. Complete your claim, commit and push.
