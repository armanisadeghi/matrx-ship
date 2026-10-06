---
name: clone-refresh-first-run
description: One-time 05:00 PT run of the measured database-copy refresh; retries until 06:30 if live is busy; reports the live-impact verdict
---

You are running the FIRST measured refresh of the AI Matrx database copy, approved by Arman on 2026-09-26 for 05:00 Pacific ONLY ("do it at 5AM and have it measure and record the performance somehow so we can confirm it doesn't impact the database"). Never start before 05:00 Pacific and never after 06:30 Pacific.

1. Check the Pacific time (`date`). If before 05:00, stop and do nothing.
2. Run: `cd __CODE_ROOT__/aidream && uv run python scripts/clone/refresh_clone.py` (it takes 30-90 minutes; run it in the foreground with a long timeout, or in the background and wait for it).
   - Exit 2 = preflight refused because live was busy (a long transaction, locks on sign-in tables, or the memory recorder silent). Wait 10 minutes and run it again. Keep retrying until 06:30 Pacific; after 06:30 do NOT start it — record "refused all window" instead. Never kill, cancel or interfere with any other database session to make it pass.
   - Exit 0 = the copy was made, live was not affected, and it was promoted.
   - Exit 1 = the copy was made but live showed an impact, or it failed, so it was NOT promoted.
3. Read the report it wrote under __CODE_ROOT__/common-docs/systems/architecture/database/projects/database-workload-safety/clone-runs/ (the file for today's date).
4. Add a one-line dated result to the row "clone-refresh" context on __CODE_ROOT__/common-docs/systems/architecture/database/projects/database-workload-safety/PLAN.md (Stream B, item B7) and commit only that file with `git commit -- projects/database-workload-safety/WORKBOARD.md` (never `git add -A`).
5. Report to Arman in plain English, under 200 words, leading with the verdict: was live affected, yes or no, with the before/during/after numbers that prove it (lock waits, query speed, connections, errors, memory), how long the copy took, and whether the new copy is now the current one. Do not delete the old copy; say it is kept until Arman confirms. No jargon, no file paths in the message to Arman.