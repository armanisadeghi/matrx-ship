---
name: ship-all-claude
description: Hourly at :00 — run code/scripts/ship-all.sh, notify owners of open conflicts, fix everything so the next round starts clean (Codex runs the same at :30).
---

You run ship-all for AI Matrx, once an hour, at 13 past the hour. The agent on the other platform (Codex) runs it at 43 past, so between you it runs every 30 minutes. YOUR JOB IS TO LEAVE EVERYTHING READY FOR THE NEXT ROUND IN 30 MINUTES: every repo's local and GitHub work merged into main, released, every @ai-matrx package at npm latest, every open pull request merged, no remote branch except deploy pointers, and every release failure fixed. Reporting a failure is not finishing it. Your turn ends only when the next round would start clean, or when what remains truly needs a human (a CAPTCHA, a password only Arman has, a product decision). The tools are described in the matrx-sync skill. Never create local branches or worktrees; never stash, reset or force-push.

THIS TASK HAS TWO PARTS, AND PART 2 IS THE JOB.
- PART 1 (step 1): run the script and read what it left. That is the quick, mechanical part.
- PART 2 (steps 2-6): fix everything it left — failed releases, stale packages, unmerged PRs and branches, conflicts — then re-run until clean. This takes far longer than Part 1, and it is the part that keeps getting skipped: a run that reports problems and stops has done the easy 10% and failed the task. Problems skipped in one round pile up for every round after. Start Part 2 the moment Part 1's output is read, and budget the rest of the 30 minutes for it.

1. PART 1 — Run from __CODE_ROOT__: bash scripts/ship-all.sh
   Start it as a background command and end your turn; you are woken when it finishes.
   Then read the terminal summary and ~/.matrx/ship-all/latest.json. The script already merges every cleanly mergeable PR, deletes every fully merged remote branch (deploy/* is a CI pointer — never touch it) and re-checks packages after shipping. What it could not do is listed under NEEDS LANDING, PACKAGES STILL BEHIND NPM, PROBLEMS and OPEN CONFLICT ITEMS. All four are yours.

2. PART 2 starts here. If all four sections are empty: report in two lines and stop.

3. Fix everything else IN PARALLEL: one subagent per repo per problem, all dispatched in one message, each with a named lane, the exact repo, the exact failure text and the log path. Highest priority: aidream and matrx-frontend.
   - NEEDS LANDING (model opus): a PR GitHub cannot merge, or a branch with commits not on main. Merge it into main WITHOUT touching the shared working tree — build the merge with `git merge-tree --write-tree origin/main <branch>` + `git commit-tree`, resolve conflicts by keeping the upgrade from each side (a lockfile conflict that is only version bumps: keep main's, it is the newer install), push the commit to main, delete the branch. A draft PR is merged too unless its title or body says it must not be. Escalate only a real semantic conflict you cannot judge.
   - PACKAGES STILL BEHIND NPM (model sonnet): in that folder `pnpm update -r "@ai-matrx/*" --latest` (npm for package-lock folders), adopt each CHANGELOG "Consumer action", run the folder's type-check, commit package.json + lockfile with `git commit --only`, run ./ship.sh.
   - PROBLEMS (model opus): read the repo's log, find the root cause of the failed release (a broken gate, missing local credential wiring, a real type or drift error) and fix it for real — never skip, weaken or make a gate advisory — then run ./ship.sh in that repo until it pushes a version.
   - OPEN CONFLICT ITEMS: as in step 4.

4. Conflict items. Notify first: for each held file pick the owning conversation (the most recent "edited" session in its "sessions" list; for a Codex sub-agent, its parent). send it with agent mail (which file, which repo, where the held copy is, resolve before the next run): python3 __CODE_ROOT__/scripts/board.py post <id> "<message>" --urgent. Append " — owner: <id>, notified <time>" (or " — owner: none found, <time>") to the item's line in <repo>/_conflicts/README.md.
   An item notified in an EARLIER run and still open, or with no owner found, is resolved NOW by a subagent (model opus) with this brief: "Resolve the open items in <repo>/_conflicts/README.md. For each held file, compare the two versions and keep the code that is the upgrade. Upgrades can add or remove code, and the newer side is a clue, not the answer. If both sides did unrelated things, keep both. Never drop code from either side unless you can say why it is no longer needed. If you cannot tell, escalate the item to 'Needs the boss agent' as the README describes and leave its files alone. When done, run ./ship.sh in that repo and report what you decided for each item and why."
   Items under "Needs the boss agent" are yours: resolve them, or move them to "Needs Arman" with one plain-English question.

5. When every subagent is back, run bash scripts/ship-all.sh once more. Anything new it lists goes back through step 3. Repeat until it is clean or only human-only items remain.

6. Report in plain English: what shipped (repo + version), what you merged, fixed and how, and the only things left — each one naming the human step it needs. Branches, worktrees and PRs that remain are a failure to explain, not a count to quote.
