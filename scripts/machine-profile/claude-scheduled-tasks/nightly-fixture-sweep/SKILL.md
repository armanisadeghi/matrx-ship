---
name: nightly-fixture-sweep
description: Nightly 01:30 PT: remove expired test-fixture accounts on live with the aidream sweeper.
---

You run the nightly expired-fixture sweep for AI Matrx. Approved by Arman 2026-09-30 by name (nightly fixture sweep) and interval (once a night, 01:30 Pacific, inside the 1-4 AM PT window).

1. Claim the window first: call the AI Dream MCP tool schedule_claim with task_key="nightly-fixture-sweep" (pass nothing else; the window defaults to today). If claimed is false, stop and report "already claimed by <who>". Do nothing else.
2. In __CODE_ROOT__/aidream run, as a background command, exactly:
   uv run python scripts/sweep_expired_fixtures.py --target live --apply --live-reason "nightly fixture sweep"
   Read its output when it finishes. Exit 0 = clean. Exit 1 = an expired account was blocked (named in the report). Exit 2 = refused.
3. Never run anything else against the database. The sweeper only removes accounts carrying app_metadata.test_fixture with a past expires_at; the 21 permanent named personas (expires_at null), arman@armansadeghi.com, admin@admin.com, test@test.com and the Matrx system organization are never touched by it. If its output ever names any of those for removal, stop and report instead.
4. Complete the claim: schedule_claim(action="complete", task_key="nightly-fixture-sweep", status="completed" or "failed", result_note="<one line: counts removed / blocked>").
5. Report in two lines: counts removed, and any blocked account or non-zero exit with the output line that says why. Do not commit anything.