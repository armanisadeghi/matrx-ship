---
name: db-safety-followup-day3
description: Day-3 re-check of the DB memory recorder, the deleted rehearsal branch, and the nightly clone; writes results to the workboard
---

Follow-up Arman asked for on 2026-09-25 ("schedule follow ups to confirm it's a good move and that we don't mess anything up"). Work in __CODE_ROOT__/common-docs; read CLAUDE.md and projects/database-workload-safety/WORKBOARD.md rows F1, F2, F2a and B7. Live project brsgrqvjdzwihsvnfqkf only; never txzxabzwovsujtloxrus (deleted). Read-only except the workboard edit.
1. Recorder: `select count(*), min(sampled_at), max(sampled_at), bool_and(scrape_ok), round(min(mem_available_bytes)/1e9,2), max(round((swap_total_bytes-swap_free_bytes)*100.0/nullif(swap_total_bytes,0),1)) from ops.db_host_sample where sampled_at > now()-interval '72 hours'` — expect ~4,300 rows, recent, ok. Count database_host alert events in ops.ops_issue_event (join ops.ops_issue_class on category='database_host') per day. Report the 3-day memory trend per day (min available, max swap) and whether it is getting worse.
2. Deleted branch ksfhewuxgxwavkpceein: grep the four repos for it and for connection errors in system_error/release logs.
3. Clone: `operations/clone/CURRENT.md` names the current clone; confirm it is ACTIVE_HEALTHY (supabase list_branches), accepts writes (`select current_setting('default_transaction_read_only')` on it) and its cron is inactive; read the latest projects/database-workload-safety/clone-runs/*.md verdicts.
Write a dated result into the Result column of F1, F2 and B7 and commit only that file with `git commit -- projects/database-workload-safety/WORKBOARD.md`. Report under 250 words, leading with anything wrong.