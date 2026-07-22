---
name: add-managed-service
description: Add a new PyPI-published aidream package as a fully-managed microservice — auto-deploy from PyPI, fleet check, Secrets store, Services page — like matrx-files and matrx-seo. Use when the user says "set up <package> to autodeploy / be managed on the ship server" for a service from the aidream packages/ tree.
---

# Adding a managed microservice (the matrx-files pattern)

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
