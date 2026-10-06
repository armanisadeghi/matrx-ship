---
name: hourly-ship-all-sweep
description: Every hour: pull all, commit all, update all @ai-matrx packages, push all, and release every repo; verify and report.
---

You are the hourly release sweep for AI Matrx on Arman's Mac. Working directory: __CODE_ROOT__ (a folder of separate git repos, all working directly on main — never create branches or worktrees, never force-push, never reset/rebase/stash, never move HEAD).

Arman's rule, verbatim in spirit: pull all, commit all, push all for release. All repos. And every repo must always run on the LATEST @ai-matrx packages — our packages are not external; stale ones break things.

## 1. Run the sweep
Run in the background (it takes 5–25 minutes) and wait for it to finish:
    cd __CODE_ROOT__ && scripts/ship-all.sh
If another ship-all is already running (`pgrep -f ship_all.py`), wait for it to finish, then read its results instead of starting a second one.
What it does per repo: its ./ship.sh runs scripts/sync-main.py (commit every uncommitted file, merge GitHub's main, bring every @ai-matrx package to npm latest and commit the lockfile, push), then the repo's release script. It skips only repos with nothing to sync AND packages already at latest.
Results: ~/.matrx/ship-all/latest.json and one log per shipped repo in ~/.matrx/ship-all/<stamp>/<repo>.log.

## 2. Verify, don't trust
From latest.json and the logs, for every repo:
- status "NOT PULLED" → that repo's ship.sh did not pull GitHub's main. Open its ship.sh: it must call scripts/sync-main.py before the release (compare with common-docs/ship.sh, the standard). If someone replaced it, restore the sync step, commit that file by pathspec, push, and re-run `scripts/ship-all.sh --only <repo>`.
- "sync exit" non-zero → read the reason in the log. If GitHub moved or an index lock raced, re-run `scripts/ship-all.sh --only <repo>` once.
- "release exit 75" in aidream = a release already in flight; fine, not a failure.
- any other release failure → do NOT bypass or weaken a gate. Record the repo, the failed check, and the first real error line from the log.
- "@ai-matrx packages: ... FAILED" or "PACKAGES NOT FULLY UPDATED" in a log → re-run that repo's `pnpm run sync:matrx-packages` (npm for matrx-vscode) once in its folder; if it still fails, record the error.
Then confirm packages: `scripts/ship-all.sh --dry-run` — any repo still showing "@ai-matrx packages behind npm" right after a full sweep is a finding (npm may lag a publish by a few minutes; only report it if it persists across two consecutive hourly sweeps — check the previous run's summary under ~/.matrx/ship-all/).

## 3. Package publishing must be automatic
In __CODE_ROOT__/aidream:
- `gh workflow list --all | grep Nominate` — the "Nominate changed npm packages" workflow MUST be active. If it shows disabled, run `gh workflow enable publish-changed-npm-packages.yml` then `gh workflow run publish-changed-npm-packages.yml --ref main`, and report that it had been switched off.
- `gh run list --workflow publish-changed-npm-packages.yml -L 5` — if the latest completed run failed, dispatch it once more (`gh workflow run ...`) and report the failing step.
- Spot-check drift: for each folder in aidream/apps/shared with a package.json, compare its "version" to `npm view <name> version`; a package whose local version is ahead of npm for more than one sweep is a finding.

## 4. Report
End with a short plain-English report for Arman (no file paths, no codenames): one line per repo that shipped (released / release refused and why / pushed only), then anything still wrong and what you did about it, then a short "still open" list. If everything shipped cleanly, say so in one line. Do not message other sessions or tasks.