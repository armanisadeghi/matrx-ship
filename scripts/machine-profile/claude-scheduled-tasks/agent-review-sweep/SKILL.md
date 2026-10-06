---
name: agent-review-sweep
description: Daily independent-reviewer sweep of the agent.review_queue backlog (submitted rows), promoting verified passes to ready_for_human.
---

You are running the approved daily `agent-review-sweep` duty (Arman approved 2026-09-11: "Yes. Turn on the daily sweep."). This is a fresh session with no memory of any prior run — everything you need is below.

STEP 0 — CLAIM THE WINDOW (mandatory, before any other work):
Call `schedule_claim(task_key="agent-review-sweep")` on the AI Dream MCP server (server `user-aidream`).
- If `claimed: false` → STOP immediately, do no further work, and end your report with "already claimed by <already_claimed_by>".
- If `claimed: true` → you own today's window. Continue below.

STEP 1 — LIST THE BACKLOG:
In `__CODE_ROOT__/matrx-frontend`, run:
  pnpm review-queue:sweep --limit 25
This lists `submitted` rows older than the cutoff, grouped by lane and repository, each with its direct URL. This command only reports — it changes no row.

STEP 2 — ACT AS THE INDEPENDENT REVIEWER:
Read and follow `__CODE_ROOT__/matrx-frontend/.claude/skills/agent-review-queue/SKILL.md` and its linked `review-and-repair.md` in full before claiming or changing any row. Key rules to hold the whole run:
- You are the INDEPENDENT reviewer — never claim or promote a row you (this session) built or authored.
- Claim `submitted` rows oldest-first, atomically, per the skill's claim SQL.
- Work 10–15 rows this run (a floor, not a ceiling if time allows, but do not stretch beyond ~15 to keep runs bounded).
- Verify each row on the LIVE surface (deployed target, not localhost-only), signed in as `admin@admin.com`. Sign in the LEAK-FREE way: open the page with the AI Dream MCP `cloud_browser` (`{"action":"navigate", ...}`) and call `credential_login` `{"action":"auto", session_id}` — the password lives in the Vault item "AI Matrx (admin test account)" and is typed inside the trusted executor, so it never reaches this transcript. Prove the identity with `https://www.aimatrx.com/api/whoami` (and `https://manage.aimatrx.com/api/whoami` for admin-console rows) before claiming a row; both should report `admin@admin.com`. Never print or paste a credential value.
  - The Vault item lists only `www.aimatrx.com` under `uri_match_mode: "host"`, so `credential_login` will not match a `manage.aimatrx.com` login page. Sign in on `www` first; the session cookie is domain-wide and `manage` is then already authenticated.
  - **`/api/dev-login?token=…` NO LONGER EXISTS** and returns 401 — the durable-token door was deleted in 2026-09 after it leaked into agent transcripts twice. The replacement (`pnpm dev-login`, a single-use per-host nonce) is dev-only and localhost-only, so it can never authenticate a review against the deployed surface. Do not reach for it here.
  - The AI Dream MCP connection drops its organization mid-run: any `cloud_browser` call can fail with `organization_required`. Re-set it with the `organizations` tool (`action='set_connection_organization'`, AI Matrx = `5dc930e9-bd65-44a1-8369-af773f6e1a5b`) and retry the same call. It is not a sign-in failure and it happens several times in a normal run.
  - `cloud_browser` drives a headless browser with navigate / click / type / select / scroll / wait / screenshot / get_element ONLY. It has **no right-click and no touch long-press**, so a row whose declared checks are context menus or mobile long-press cannot be fully verified by this worker: record the gap plainly and return the row rather than promoting around it.
  - Reading a page: prefer `get_element` on a NARROW selector. `include_html: true` on a whole `main` can return hundreds of KB. `get_element` returns the FIRST match, so `a[href*="/agents/"]` may hand back a nav link rather than the row link — anchor on `main table a` or an exact href shape. And a list read immediately after `navigate` can race hydration: if an expected anchor is missing, `wait_for` its text and read again BEFORE calling it a defect (that false alarm happened on 2026-09-20).
- SQL: write it to a heredoc file and run `pnpm admin-query --file <path>` from `matrx-frontend`. A `$$`-quoted body (`$ev$ … $ev$`) survives shell quoting where doubled single quotes do not. The RPC answers a data-modifying CTE with only `{"message":"Query executed successfully"}`, so **re-read every mutation**. An atomic claim can also return nothing because `for update skip locked` skipped a concurrently-locked row — re-read the row and retry once before concluding anything.
- Pushing a fix from this shared checkout: commit your own paths, then push through a throwaway detached worktree at `origin/main` (`git worktree add --detach <tmp> origin/main`, cherry-pick, push, remove it). A plain `git pull` here aborts on other lanes' untracked files, and you must never delete those.
- NEVER complete a real payment or financial transaction while testing a row, even if the row's flow leads there — stop short and note it.
- ALWAYS restore the core preview profile / session state you were testing under before moving to the next row or ending the run, so you leave no dirty state for the next reviewer or for Arman.
- Promote a verified pass to `ready_for_human` with a ONE-LINK guided instruction Arman can act on directly (the row's own `https://manage.aimatrx.com/administration/users/agent-review/<id>` URL plus what to click/look for — never a bare "it's in the queue").
- Return a failing row to `agent_changes_requested` (or repair it yourself when the fix is small and clearly in scope) with concrete evidence: what you did, what you saw, why it fails.
- Never invent a defect just to show activity; never promote your own unverified guess.

STEP 3 — COMPLETE THE CLAIM:
When the pass is done (or you hit the row budget), call:
  schedule_claim(action="complete", task_key="agent-review-sweep", status="completed", result_note="<one line: rows reviewed, N promoted, N returned, N repaired>")
Use `status="failed"` if the run could not complete its review work, or `"abandoned"` if you had to stop early for a reason outside your control (e.g., live surface unreachable). Always call this — a claimed window that never completes blocks nothing else, but the ledger should be honest.

Report a short summary: rows claimed/reviewed, how many promoted to ready_for_human (with their links), how many returned with findings, and any repair you made in-line.