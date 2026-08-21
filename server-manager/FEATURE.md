# Server Manager Runtime Truth

Cross-repo work order: `/Users/armanisadeghi/code/common-docs/projects/production-reliability-closeout/SANDBOX_FLEET_WORK_ORDER.md` — read it before changing sandbox inventory, tier routing, drift verdicts, lifecycle repair, or cleanup controls.

The Manager is a production control plane. UI claims about deployment and
freshness must come from the thing that is actually running, not from a deploy
ledger, workflow history, intended tag, or local source checkout.

## EC2 microservices

`matrx-files` and `matrx-seo` are observed over SSM. One observation reads the
container's existence, running state, exact image reference and ID, start time,
installed Python package version, host-local health, and `/opt/<service>/CURRENT`.

- A service is **deployed** only when the container exists, is running, and its
  host-local health endpoint returns 200.
- The running package version is authoritative; the running image tag is the
  fallback. `CURRENT` is displayed only as a record that matches, is missing,
  or disagrees with runtime.
- PyPI is the target version for freshness, not evidence that anything is
  deployed.
- Secrets Apply re-inspects the live container and re-runs its exact image. It
  is unavailable when no image can be observed, and it succeeds only after the
  recreated container returns host-local health 200.
- The Secrets banner must say what was observed and what Apply will do. Never
  predict failure from a missing record.

## AI Dream API ownership

AWS ECS/Fargate is the sole AI Dream API runtime and release owner. The retired
`matrx-python-server` replica has no Manager secret store or Apply action, so
the control plane cannot restart or revive the superseded API deployment.

## Microservice deploys must leave the host deployable

The deploy pipeline builds images on the fleet host. Left alone it accumulated
one image per release forever (matrx-files 1.7GB, matrx-seo 262MB) until
2026-08-11, when the host reached 100% disk (86 images, 45GB) and every deploy
hard-failed. Nothing said "disk" — `uv pip install` exited 1 and the reported
error was truncated to the Dockerfile frame.

- **Every successful upgrade prunes.** After `UPGRADE_OK`, images for that
  service's repo are removed except the new `CURRENT` and the recorded
  `PREVIOUS`, so rollback stays possible; dangling images and the build cache go
  too. The prune runs in a `set +e` subshell with per-command `timeout`s **after**
  success is recorded — housekeeping may never fail or roll back a good deploy.
- **A full disk is named before it bites.** The upgrade script checks
  `df --output=avail /` before building; below `MATRX_MS_MIN_FREE_KB` (6GB) it
  reclaims first, and if still short it exits with `DISK_FULL …` naming the disk
  and the opaque pip failure it prevents.
- **Disk is runtime truth.** `msObservedState` reports `host_disk`
  (`ok` / `low` / `blocked`); status endpoints carry it plus a `warnings` array,
  and fleet-health reports `blocked` as a warning even while the service is
  perfectly healthy — a full disk breaks future deploys, not the running service.
- **Never truncate a build failure to a summary.** Deploy errors merge stdout
  and stderr and keep 8000 chars. The 300-char slice is what hid this cause.

## Orchestrator freshness

Each orchestrator's authenticated root response reports `source_sha`. Compare
both running tiers with the tested `deploy/hosted` approval ref. The latest
successful Deploy workflow is useful context, but it is neither the desired
release nor proof of what is running.

Legacy EC2 orchestrators may not expose `source_sha` yet. In that case the
Manager reads `/home/ec2-user/orchestrator/.source-sha` over SSM while also
requiring the systemd service to be active. If the moving GitHub approval ref
is missing, recover the newest approved commit on `main` from the immutable
`deploy-approved/<sha>` tags. Still warn that the hosted poller cannot discover
future releases without its moving ref. If neither source can be read, say so
and compare the observed running tiers; never translate an authorization/API
failure into “no approved release exists.”

The separate **Recent deploys** check reports GitHub Actions history only; it
must not claim that a workflow record proves a process is running that commit.
Only the latest completed deployment affects health: a later successful run
supersedes older failed attempts, which remain visible as history but cannot
keep the fleet degraded after runtime freshness has been verified.

The **aidream deploys vs tests** check follows the same runtime-truth rule. The
canonical ECS API health and exact running SHA decide production freshness; a
workflow record alone never proves that production is healthy or stale.

## A normal release is not an outage

The hosted orchestrator answers 404/502 for ~a minute after every release
recreates it. That window is reported as `restarting` (rank 0 — overall stays
green, ops-triage leaves it alone), decided by the container's own
`State.StartedAt` read over the Docker socket, not by assuming a deploy is
underway. Absent or unreadable container is NOT "just restarted" — it stays
critical, as does anything still down past 150s. Alarm fatigue is a real
failure mode: with the poller healthy, releases run back to back, so a
false critical on each one trains the operator to ignore the banner.

## A stuck poller must say WHY

`deploy-hosted.sh` (matrx-sandbox) records every `fail()` to
`/srv/apps/deploy-state/matrx-sandbox.last-failure.json` (`sha`, `at`,
`reason`) and clears it on a successful release. The hosted-deploy check quotes
that reason, but **only when its `sha` is the release currently being
attempted** — a leftover record from an older SHA describes a failure that is
no longer happening. When the file is absent while the poller is stuck, say so
and point at the timer: nothing recorded means nothing ran.

"Stuck — go read journalctl" is not an alarm. That was the entire diagnosis
available on 2026-08-11, when the aidream image build failed every 2 minutes
for 20 h (the build deleted tracked files from the source tree it then
certified) and the dashboard could not name it.

## Destructive-op and repair guardrails

- `shell_exec` refuses `docker rmi` / `docker ... prune -a` targeting
  `matrx-sandbox:*` or `matrx-orchestrator` images unless
  `MATRX_DESTRUCTIVE_OPS=1` is set in the Manager env (reverse-tag protection;
  see the guard near the top of `src/index.js`).
- Repairing the orchestrator image must use
  `POST /api/orchestrator/build/stream` — never the sandbox-template rebuild
  chain, which builds `matrx-sandbox:*` variants, not the orchestrator.

## Operator feedback

The fleet ops bridge uses only `MATRX_OPS_SUPABASE_URL` plus
`MATRX_OPS_SUPABASE_KEY`. **Generic `SUPABASE_*` credentials are never a
fallback:** another project is not an equivalent ops database. Configure both
dedicated values, or set `MATRX_FLEET_OPS_SYNC_SECONDS=0` to disable the bridge
honestly.

Long-running buttons keep their action visible: applying uses a spinner, blue
working treatment, and `Applying — waiting for health…`. A genuinely
unavailable action is outlined, disabled, and labeled `Apply unavailable`.

## Verification

For changes to this surface:

1. Run `node --check server-manager/src/index.js`.
2. Run `pnpm --filter matrx-admin build`.
3. Verify the live Secrets banner against an independent SSM observation.
4. Apply a clearly named throwaway env key, confirm the container start time
   changes and edge health stays 200, remove the key, Apply again, and confirm
   health and runtime version.

## Change log

- 2026-08-21 — Fleet ops sync refuses generic Supabase project substitution.
