---
name: add-managed-service
subject: architecture/deploy-control-plane
description: "Onboarding recipe for a PyPI-published aidream package as a managed microservice on the ship server. Use when asked to make a `packages/` service autodeploy or be managed like matrx-files or matrx-seo, or when adding a `MICROSERVICES` or `REMOTE_SECRET_STORES` entry in `server-manager/src/index.js`."
---

# Adding a managed microservice (the matrx-files pattern)

<!-- rules:stamp -->
> Rules from `common-docs/systems/architecture/deploy-control-plane/STATE.md` — edit there, never here (`python3 common-docs/meta/scripts/one_home.py --write`).

- **A release script never refuses.** It bumps, pushes fast, and reports only WARNING/ERROR rows, each category in its own opened-and-closed section, printed only when non-empty. Checks that complain run after the push. The lock covers only the bump and push (30 s takeover).
- aidream and matrx-frontend await migrations after the push and name every held migration with its reason. **One bad migration holds only itself and the files that build on it.** Outside 01:00–04:00 PT a table-building file runs under a 60 s cap (`_start_time_cap_watchdog`, `PROVISIONING_TIME_CAP_SECONDS`) instead of being refused; autocommit lock-taking files are still refused outside the window (cannot be rolled back).
- 14 smaller repos run one shared script, `matrx-ship/scripts/release-template.sh` plus a five-line settings block, guarded by `test-release-template.sh` (run with `/bin/bash`). matrx-extend ships first and builds store zips after.
- **Sync + ship-all:** every repo's `./ship.sh` runs `scripts/sync-main.py` (commit everything, merge origin/main, sort conflicts into `_conflicts/` — losslessly, the better version not merely the newest, escalating start → Manager → Boss Agent → Human — push) then its release. `/Users/armanisadeghi/code/scripts/ship-all.sh` runs 17 repos, 4 at a time, hourly (`ship-all-claude` at :13, `ship-all-codex` at :43). Skill: `matrx-sync`.
- Never reintroduce a push-per-commit helper (it left matrx-frontend hundreds of commits behind with fake conflicts).
- Logs: aidream/frontend `tmp/release-logs/`; template repos `~/.matrx/release-logs/<repo>/`; ship-all `~/.matrx/ship-all/<stamp>/` and `latest.json`. Schedules: [scheduled tasks](/operations/scheduled-tasks.md). Cadence redesign: [release workflow redesign](/systems/architecture/deploy-control-plane/projects/release-workflow-redesign/PLAN.md).
- **Never ask Arman to run a release or hand him a release command**. Push, wait for the deploy train (about 30 minutes), verify the live SHA yourself, and report only the end state; a release more than 60 minutes stale is reported as a bug, not handed to him. A release script blocked for you is fine: the train carries it. A plain push does not deploy matrx-frontend production; only prefixed `release*:` commits build.
- **Reach another session by its address, never through Arman.** Find it (`who`, or `list_sessions` by title) and send a self-contained message to its address (a `local_…` id) so it is supported without a paste; still never instruct a peer to do what your own session is blocked from. Agent-mail priority `urgent` texts Arman's phone, so use `note`; `urgent` only when he himself must act now.
- **Never hold off publishing before launch**. After a pathspec commit: `git fetch`, `git merge-tree --write-tree HEAD origin/main`, `git pull --no-rebase --no-edit origin main`, `git push origin HEAD:main`. A package publishes on push, and a monitor "timeout" can still mean published, so check `npm view`. Then update the consumer lockfile (`pnpm update @ai-matrx/<pkg>`), verify, push, and for Matrx 2 run `pnpm dist:mac:install`. A new package subpath must also be taught to the package's own publish gate (design-system `scripts/verify-tarball.mjs` attw excludes) or CI fails silently.
<!-- rules:stamp-end -->

The end state: the operator releases with aidream's `release.sh` and NOTHING
else — publish-all-packages tags the package → CI publishes to PyPI → the
Manager auto-deploys the new version to the box within ~5 min (verify-in-image,
rm+run swap, health poll, auto-rollback). The service shows on the Manager's
**Services** page, has a **fleet-health check** (mirrored to aidream
ops-triage), and a **Secrets** store for its env with a correct Apply.

## Prerequisites in the aidream package (verify, don't assume)

1. `packages/<pkg>/pyproject.toml` — versioned; publish-all-packages picks up
   every `packages/*/pyproject.toml` automatically. NEVER add duplicate
   tagging to release.sh.
2. `packages/<pkg>/Dockerfile` — installs from PyPI via a build-arg version
   pin (e.g. `ARG MATRX_FILES_VERSION` → `pip install "matrx-files[standalone]$VERSION"`).
   Buildable with NO monorepo context.
3. Health endpoints: a liveness path returning 200 and (ideally) a readiness
   path. No env = smoke mode (liveness 200, readiness 503); partial env =
   loud refusal to start.

## One-time box provisioning (break-glass, manual — everything after is automatic)

On the target EC2 (usually `matrx-sandbox-host-dev`, via Manager Hosts/Terminal):
- `/opt/<pkg>/` with the Dockerfile (the deployer re-syncs it from GitHub main
  on every deploy, so drift dies) and `CURRENT`/`PREVIOUS` version files.
- `/etc/<pkg>.env` (root, 0600) with the service's env registry satisfied.
- First container run: `docker run -d --name <pkg> --restart unless-stopped
  -p 127.0.0.1:<port>:<port> --env-file /etc/<pkg>.env <pkg>:<version>`
- Caddy route on the shared TLS sidecar (`/opt/matrx-files/Caddyfile`) +
  Cloudflare A record (proxied) for `<sub>.matrxserver.com`. Security group:
  443 from Cloudflare ranges only; raw port NOT exposed.

## Register it in the Manager (data, not code — this is the whole point)

In `server-manager/src/index.js`:

1. Add an entry to `MICROSERVICES` (copy matrx-seo's, change the fields):
   id/label/impact, host, container, port, publicBase, healthPath, readyPath,
   optDir, envFile, pypiPackage, dockerfileRepoPath
   (`AI-Matrix-Engine/aidream/contents/packages/<pkg>/Dockerfile`),
   buildArgName, dockerRunExtraArgs (volumes etc.), autoDeployEnvVar,
   autoDeploy default, attemptsFile.
2. Add a Secrets remote store in `REMOTE_SECRET_STORES`
   (id `ec2:<pkg>`, path `/etc/<pkg>.env`) with a restart spec that RE-RUNS
   the container at `$(cat /opt/<pkg>/CURRENT)` — **never `docker restart`**
   (env is read at run time only) — plus a health poll. Copy matrx-files'.
3. That's it. The registry drives: the auto-deploy sweep, the fleet-health
   check (auto-mirrored to aidream ops-triage), `GET /api/microservices`,
   per-service status/logs/deploy endpoints, and the Services page row.

## Verify (always, live)

- `GET /api/microservices` shows the service with `pypi_latest` non-null.
- Fleet Health shows the check green (or "not published yet" before v1).
- Release a version via aidream `release.sh`; within ~10 min the Services
  page shows the new version deployed; edge health 200.
- Secrets → the store → change a harmless key → Apply → health stays 200.

## Sharp edges (each cost real downtime once)

- publish-all-packages already tags EVERY changed package — duplicate tagging
  in release.sh double-releases.
- Unpublished package (PyPI 404) must degrade to "not deployed yet"
  everywhere, never alarm.
- One auto-deploy attempt per version (attempts ledger) — broken releases
  stay loudly stuck, never loop-build.
- The deployer verifies the version INSIDE the built image before touching
  the live container; keep that (an on-box Dockerfile drift once shipped a
  silently-pinned old version).
