# Subagent model and cost policy

Keep the user's selected primary model, including Astra, as the task owner. Delegation must reduce cost: never spawn another Astra merely because the parent is Astra.

- Codex routing (Arman 2026-09-12): use `gpt-5.3-codex-spark` for deterministic routine work when the active tool supports it; otherwise explicit `gpt-5.6-terra` for bounded execution. Sol (`gpt-5.6-sol`) independently checks their work before acceptance. All real planning and unresolved decisions return to Astra (`gpt-6-astra`), preferably the existing owner.
- Explicitly choose model and effort: Spark low; Terra low for mechanical work or medium for implementation; Sol low for straightforward checks, medium for substantive verification, high only with a specific reason. Astra medium for novel reasoning and planning; low is valid for important bounded execution. Preserve the user's selected primary model.
- Canonical policy: `__CODE_ROOT__/common-docs/policies/subagent-model-ladder.md`. Read before dispatch. Use exact supported IDs, never literal tier labels or silent expensive fallback. Batch review evidence; do not spawn a verifier per command. No-change inventory can end without new review, but cannot claim new work verified.
- Use `fork_turns="none"` with a self-contained assignment: objective, relevant paths, exact evidence, constraints, and acceptance checks. Do not copy the entire parent history. With a different tool, use its documented equivalent for an explicit model and bounded context.
- An Astra delegate is an exception only when its bounded problem independently requires reasoning comparable to the difficult work owned by the primary Astra: ambiguous cross-system causality, consequential integrity/architecture decisions, or a cheaper agent's concrete failed attempt showing the need. Before spawning, state the specific reason a cheaper model is insufficient. Urgency, importance, parallelism, generic review, unfamiliarity, and one ordinary tool/test failure are not sufficient reasons. Prefer solving the hard part in the primary agent and returning execution to cheaper workers.
- Check the model before reusing an existing delegate. A follow-up retains that delegate's model; do not reuse an old Astra worker for routine work. Hand a compact continuation to a cheaper delegate instead. Never silently fall back to Astra when a cheaper model is unavailable.
- Include this policy in delegated assignments; it applies recursively. Delegates should return an evidence-based escalation to the parent rather than spawning a more expensive agent themselves. Do not create extra agents without an independently useful subtask.

# Browser isolation and cleanup

**Use your own isolated browser for ordinary browsing and every application test.** Prefer Codex's separate in-app Browser. Use the available tool's documented API to select it; Computer Use and other browser tools may control that isolated browser. A matching URL, an existing signed-in session, an unavailable isolated browser, or convenience is never permission to open or control the user's browser. If isolated access is unavailable, use another agent-owned harness or report the blocker.

**The user's browser is reserved for work that must be done ON THE USER'S BEHALF in the user's personal identity**, such as reading the user's email or managing an account specifically as the user. Before using it even for that work, check whether approved access can be completed in an isolated browser through AI Matrx Vault values, a brokered integration, or other agent-owned credentials; prefer that route. Use the user's browser only when the current request explicitly or inherently places that personal identity/session in scope. If it does not, ask before opening it. Permission for one task, account, browser, or tab never carries into another task.

When behalf-only browser use is authorized and unavoidable, open a new tab. Never navigate, control, or close a tab the user is using.

Close the tabs and tab groups you create when they are no longer needed, including before ending a task. Leave pre-existing user tabs and groups untouched.

# AI Matrx admin login is pre-authorized

For any Matrx UI verification, sign in inside the in-app Browser as `admin@admin.com`. Read `AI_ADMIN_PASSWORD` from the `aidream` or `matrx-frontend` `.env` files; `AI_ADMIN_USERNAME` also contains the email. The local `DEV_LOGIN_TOKEN` flow may be used when available. Routine login is pre-authorized. Never switch to the user's browser to reuse a Matrx session. Never print, quote, or expose credential values.

# Complete the engineering task; release agents own deployment

A request to fix, change, or build authorizes implementation and verification, not a diagnosis-only response. Finish the requested behavior, verify the types and affected callers, run meaningful checks, test UI changes in an isolated localhost browser against the changed checkout, fix introduced regressions, obtain required independent review, and commit and push the scoped work. A screenshot of another checkout, a component mock, or passing unit tests alone does not replace the localhost interaction check.

Recover broken test launchers, preview startup, and authorized test login; try safe in-scope alternatives before stopping. If whole-repo checks contain unrelated concurrent failures, identify them precisely and establish clean changed-code evidence without suppressing errors, weakening checks, excluding shipped code, or modifying another agent's work. Report only genuine remaining engineering gaps.

**Once that engineering work is verified and pushed, the task is complete.** Deployment, production/live-site verification, full release checks, release monitoring, and waiting for a release belong to dedicated agents. Do not perform them, wait for them, list them as unfinished work, or add pending-deployment caveats unless Arman explicitly assigned that role in this task. Canonical boundary: `__CODE_ROOT__/common-docs/policies/deployment-is-the-deploy-agents-job.md`.

If required implementation or local verification genuinely remains undone after available recovery, say exactly what is missing and why; do not disguise it as complete. Only when such **in-scope engineering work** forces an unfinished final response, begin with:

# **🚨 TASK NOT COMPLETED 🚨**

Never use this banner because deployment, production testing, or release work remains with another owner. A requested investigation, report, or plan is complete when that deliverable is complete. Continue available work instead of using the banner as an exit.

# Files handed to Arman live in common-docs, never in a temp directory

A temp or scratch directory is emptied on reboot, so a path given to Arman there dies overnight (two files lost on 2026-09-12). Any file Arman is meant to open, paste, or keep goes in `__CODE_ROOT__/common-docs/operations/for-arman/<YYYY-MM-DD>/<name>`, committed and pushed (stage only that file), and that full path is what he gets. Rules and retention: `common-docs/operations/for-arman/README.md`.
