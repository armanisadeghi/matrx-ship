---
name: fleet-incident
description: Diagnose and durably fix anything broken on the Matrx fleet (deploys stuck, services behind/unreachable, red fleet-health, sandboxes misbehaving). Use whenever the operator reports "X isn't working / isn't updating / shows behind" on the /srv host, the EC2 boxes, or any managed service. Encodes the house method - verify claims live, find the FIRST error, fix in the repo, let the pipeline deploy, prove it live, make the failure loud.
---

# Fleet incident response — the method

Every real outage on this fleet (2026-07) was some flavor of ONE disease:
**a thing that lived outside the repos** (hand-built container, DB cron job,
missing env, silent fallback) **failing invisibly**. The method below found
and killed every one of them. Follow it in order.

## 0. Non-negotiables (violating these caused multi-day outages)

- Fixes ship as `commit → push → pipeline`. A hand-patch on a box is a lie
  with a timer on it. If the pipeline itself is broken, FIX THE PIPELINE.
- `/srv/projects/matrx-sandbox` is git-reset every 2 min by its poller —
  `systemctl stop matrx-hosted-deploy.timer` while editing, `start` after,
  and commit fast. (It has eaten three agents' uncommitted work.)
- Verify LIVE after deploying: a real request against the real endpoint.
  "Confirmed in code" has been wrong every single time it was claimed.
- When a fallback/guard fails, it must LOG LOUDLY. A silent `|| true` or
  empty-on-error is how every multi-day incident here stayed hidden.

## 1. Read the dashboards before touching anything

- `GET manager…/api/fleet-health` (or /admin/fleet-health) — the checks name
  the disease directly (stuck poller, missing image, service down/behind).
- `journalctl -u matrx-hosted-deploy.service` / `-u matrx-ship-deploy.service`
  — find the FIRST error in a run, not the last (cascades lie).
- Deploy state: `/srv/apps/deploy-state/*` (last-deployed SHAs, retry ledgers).
- The operator's reports are true observations but may be STALE — the
  self-healing systems often fix things between his look and yours. Verify
  current state before "fixing" something already healed.

## 2. Known failure signatures (each cost real downtime once)

| Signature | Diagnosis |
|---|---|
| 3+ GitHub-backed checks 401 at once | GITHUB_PAT expired — replace via Secrets (classic, no-expiry, reads personal + AI-Matrix-Engine) |
| Sandboxes die on round clock times (:00/:15/:30) | A DB-side cron job — `SELECT * FROM cron.job` FIRST. Lifecycle belongs to the orchestrator ALONE |
| CI jobs die at identical durations across repos | Platform blip — the Manager auto-retries once per run; verify the ledger, don't hand-loop |
| Versions page "behind" but containers current | Comparison model drift (local alias untagged / judging vs source instead of GHCR) — pollers self-heal aliases |
| Hosted "behind main" | NOT stuck if the test gate is holding a bad commit — check deploy/hosted ref + the deploys check before blaming the poller |
| Image builds fail out of nowhere | Unpinned dependency (`@latest`, `setup_X.x`) hit an upstream major — pin it |
| Works from your shell, fails in the service | systemd env differs (no $HOME → git auth dies) — reproduce under `systemd-run` before theorizing |
| Env change "didn't apply" | `docker restart` does NOT re-read env — recreate/re-run (Secrets Apply buttons do it right) |
| A guard "can't be failing" | It's failing silently — add logging first, theorize second |

## 3. Fix at the right layer

- Code/config in a repo → edit, test, push; watch the poller/CI deliver.
- Env/secrets → Secrets page stores (incl. EC2 remote stores) + Apply. Never
  raw SSM env edits when a store exists; never paste secrets into commands.
- Manager env/update → deploy.dev.codematrx.com/manager "Update + Restart".
- DB-side anything for sandboxes → almost certainly WRONG; see the 0148/0150
  story in aidream KNOWN_DEFECTS before adding.

## 4. Close the loop (what separates fixed from finished)

1. Live proof: the exact failing call now succeeds (or the guard now trips
   loudly in a forced test).
2. The failure class gets an alarm: a fleet check, a loud log, or both —
   mirrored to the aidream ops-triage dashboard the operator actually reads.
3. Docs updated where the next agent will look (/srv/CLAUDE.md hard rules,
   SERVER-RUNBOOK, the repo's own docs) — stale docs recreate incidents.
4. If the fix was "one attempt then hold" territory (deploys, image builds),
   make sure the retry/ledger machinery covers it, never an infinite loop.
