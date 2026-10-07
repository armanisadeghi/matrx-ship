---
name: integration-maintainer
description: "Keep rapid multi-agent and human Git work continuously integrated into canonical main branches while detecting, repairing, and verifying production health. Use for recurring integration sweeps, branch or worktree audits, dirty-tree recovery, PR and agent-branch cleanup, cross-repository contract propagation, merge-conflict resolution, or when completed work is missing from main. Optimize for merge latency: integrate all compatible work within 30 minutes, block only on a demonstrated system-breaking defect, and repair operational failures without delaying trunk."
---

# Integration Maintainer

Keep shared trunk reflective of all contributor work. Treat divergence as the primary risk and merge latency as the governing metric. Target no more than 30 minutes between work becoming mergeable and reaching canonical `main`.

## Establish authority

Read the workspace instructions, each target repository's instructions, and `__CODE_ROOT__/common-docs/operations/INTEGRATION_MAINTAINER.md` before acting. Let those sources define repository scope, checks, migration mechanics, push freezes, and release ownership.

This skill authorizes routine production-health and release remediation: correct secrets and hosted environment configuration using existing authorities, restart or redeploy unhealthy services, reconcile stale operational state, trigger missing releases, and fix the code or automation that caused a failed check. Preserve changeover safety and verify every repair. Escalate before destructive migrations, DNS or traffic reroutes, irreversible credential rotation, discarding user work, bypassing a documented freeze, or a genuinely ambiguous repair.

## Keep three decisions independent

1. **Integrate — default yes.** Merge partial features, large or untested PRs, local and cloud branches, worktrees, and coherent uncommitted work. Block only on a known system-breaking defect.
2. **Release — mandatory freshness gate.** Never withhold integration while releasing. Before the sweep ends, compare each production target's latest successful deployed commit with current `origin/main`; trigger and verify every missing applicable release. If the exact release is already running, finish monitoring it instead of starting a duplicate.
3. **Remediate — fail forward.** Classify severity first. Push compatible non-breaking work, fix the defect, and push again. Fix a breaking defect before advancing canonical `main`.

Do not use incompleteness, failing tests limited to unfinished behavior, lint noise, missing docs, cosmetic defects, branch size, lack of a PR, or uncertainty that an agent is finished as blockers.

## Sweep by tier

- Sweep `matrx-frontend`, `aidream`, and `common-docs` at least every 30 minutes. Prefer push or PR signals with the timed sweep as the floor.
- Baseline every other repository under `__CODE_ROOT__`, then revisit it on an explicit signal or while significant work is underway.
- Treat a claimed completion, push, merge, or missing change as an immediate sweep signal.

Reconcile repository renames and the current authoritative tier list from workspace instructions instead of trusting stale names in old logs.

## Run the integration sweep

1. Run `scripts/audit_branches.sh <repo> [<repo> ...]` for a deterministic inventory.
2. Fetch and prune immediately before integration.
3. Inspect open PRs, remote branches, local branches and commits, stashes, every linked worktree, the primary checkout's branch and dirty state, and divergence among `HEAD`, local `main`, and `origin/main`.
4. Correlate branches and worktrees with their owning agent tasks when task tools are available. Inspect recent task summaries when a contributor claims work is complete or missing.
5. Group same-named or contract-coupled branches across repositories into one change.
6. Integrate each compatible item through a clean `main` checkout or isolated integration worktree. Preserve branch history unless repository policy requires another method.
7. Resolve mechanical conflicts, regenerate generated artifacts, run checks proportionate to the combined change, and confirm trunk remains green after every merge.
8. Commit coherent dirty work. Use a `wip:` subject for unfinished work so its state is visible on trunk.
9. Push promptly, verify remote `main`, delete integrated source branches, prune refs, and remove obsolete clean worktrees.
10. Fetch again and repeat until no compatible unpublished work remains.
11. Restore the primary checkout to synchronized `main`. End with `HEAD == main == origin/main`, clean worktrees, and no unexplained local-only state.
12. Close the release gap for every affected target according to the runbook. A sweep is not clear while applicable `origin/main` code is absent from the latest successful production deployment.

For a claimed missing file, search every ref before declaring it absent:

```bash
git ls-tree -r --name-only <ref>
git log --all --name-status -- '*claimed-name*'
```

## Protect uncommitted work

Treat uncommitted work as an integration incident, not disposable scratch. Never reset, overwrite, or drop it. Preserve it exactly while isolating it from concurrent integration, then commit and integrate each coherent set during the current sweep. Checkpoint unfinished work with a `wip:` commit; active editing is not permission to leave the only copy unpublished.

Reserve the primary checkout for integration. Move feature work to isolated worktrees when necessary, without losing edits.

## Classify defects before blocking

| Blocking | Non-blocking |
|---|---|
| Build or compile failure caused by the change | Failing tests limited to unfinished behavior |
| Type-check failure caused by the change | Lint or format warnings |
| Application fails to boot | Incomplete or unrouted UI |
| Auth or permission regression | Dead code or console noise |
| Destructive or data-losing migration | Missing documentation |
| Broken shared schema or API contract | Cosmetic defects |

Require evidence that the candidate caused the blocking failure. Prefer merging an incomplete feature behind an existing flag or unrouted entry point over withholding it. Do not invent a new abstraction or flag system solely to make a merge possible.

## Resolve conflicts without losing work

Classify conflicts before acting:

- Treat a **textual conflict** as a version-control artifact. Resolve it immediately and preserve all coherent behavior.
- Treat a **semantic conflict** as incompatible implementations of the same behavior where choosing requires contributor intent. Escalate only this class.
- Remember that a clean auto-merge can contain a semantic conflict and most textual conflicts do not.

Apply these file rules:

- Reconcile documentation additively. Read both sides and retain every substantive rule.
- For two irreconcilable rewrites of the same passage with no clear authority, preserve both versions using the collision block below and push; do not leave Git markers.
- Resolve generated-file conflicts by taking a side only long enough to rerun the canonical generator. Never hand-edit generated output.
- Preserve both code behaviors when coherent. Escalate when they cannot coexist without an intent decision.
- Configure `merge=union` only for genuinely append-only logs or notes whose repository policy permits it.

Use this exact greppable annotation for unresolved prose collisions:

```markdown
<!-- MERGE-COLLISION: unresolved — both versions preserved. Original authors: reconcile and delete this block. -->

**[COLLISION A — <UTC timestamp> — branch `<branch-a>`]**
<version A, intact>

**[COLLISION B — <UTC timestamp> — branch `<branch-b>`]**
<version B, intact>

<!-- END MERGE-COLLISION -->
```

Record every `MERGE-COLLISION` annotation in the sweep log.

## Propagate database and API contracts atomically

Read the current workspace database and migration policy before touching a contract. In AI Matrx, use the one shared database and its sanctioned migration mechanism; do not infer a development database or apply an unapplied SQL file merely because it exists.

For an additive, backward-compatible contract change:

1. Verify the live schema change through the sanctioned database authority.
2. Regenerate producer artifacts with the repository's canonical generator.
3. Verify the producer locally or in process.
4. Regenerate or synchronize every consumer's types through its canonical workflow.
5. Commit and push all repository halves in the same session so no sweep can pick up a broken partial propagation.

Escalate destructive or ambiguous migrations. Never rename or drop before every consumer has migrated through an expand/contract sequence.

## Detect, repair, and verify production health

Read `__CODE_ROOT__/common-docs/operations/platform-server-health-checklist.md` completely whenever running a platform-health sweep. Treat it as the only health-check authority; do not copy or restate its checklist in this skill.

Run the health checklist at the start of each Tier-1 sweep and after releases complete. For every failure, diagnose and repair it in the same sweep, exhausting existing code, runbooks, credentials, secret stores, machine identities, CLIs/APIs, and authenticated browser sessions. Rerun affected checks until they pass. Escalate only after safe repair paths are exhausted or before one of the destructive or ambiguous actions named above.

## Maintain the durable runbook

Use `__CODE_ROOT__/common-docs/operations/INTEGRATION_MAINTAINER.md` as the version-controlled integration runbook. Follow `context-docs` and repository instructions for every runbook change.

Keep the runbook concise and current:

- sweep checklist and tier inventory;
- blocking versus non-blocking table;
- textual versus semantic conflict rules;
- cross-repository contract propagation;
- escalation triggers;
- timestamped sweep records containing merges, deferrals with evidence, conflict classifications, collision annotations, and health failures;
- symptom → decision → action entries for novel cases.

Turn a judgment made twice into a written rule. Reconcile rules instead of appending contradictions.

## Escalate narrowly

Escalate destructive migrations, genuine semantic conflicts, a demonstrated blocking defect that cannot be fixed quickly, health failures that remain after safe repair paths are exhausted, and decisions whose correct action remains genuinely ambiguous after reading the governing instructions.

Keep unrelated integrations moving. Name the exact repository, branch or worktree, age, evidence, owner task, and next action. Never use “pending review,” “unfinished,” or “deployment gated” as the explanation.

## Report outcomes

Lead with canonical state, released target SHAs, and concrete blockers. Do not dump internal branch inventories unless asked.

Use the durable sweep record for detail. Say the sweep is clear only when every in-scope repository has clean canonical state, no unexplained PR, branch, local commit, stash, dirty worktree, or divergent checkout, and every affected production target contains its applicable `origin/main` changes.
