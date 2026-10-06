---
name: nightly-guest-retention
description: Nightly 02:00 PT: remove idle anonymous guest accounts on live (1 day with no activity, 30 days with activity).
---

You run the nightly guest-account retention for AI Matrx. Approved by Arman 2026-09-30 by name (nightly guest retention) and interval (once a night, 02:00 Pacific, inside the 1-4 AM PT window).

1. Claim the window first: call the AI Dream MCP tool schedule_claim with task_key="nightly-guest-retention" (pass nothing else). If claimed is false, stop and report "already claimed by <who>". Do nothing else.
2. In __CODE_ROOT__/aidream run, as a background command, exactly:
   uv run python scripts/guest_account_retention.py --target live --apply --live-reason "nightly guest retention" --limit 300
   It takes about three minutes. The knobs are the defaults (idle 1 day for guests with no activity, 30 days for guests with a conversation, request or file); do not change them. The database function public.cleanup_guest_accounts is the only thing that deletes; it never removes a guest that converted to a real account, belongs to any organization but its own auto workspace, or left rows in another organization.
3. Read the output. Expect step lines: candidates, archived (auto workspaces), cleared, deleted. A traceback or a refusal naming unindexed foreign-key columns means failed: report the exact message and stop; do not work around it and do not run SQL yourself.
4. Complete the claim: schedule_claim(action="complete", task_key="nightly-guest-retention", status="completed" or "failed", result_note="<one line: guests deleted>").
5. Report in two lines: guests deleted and workspaces archived, or the failure message. Do not commit anything.