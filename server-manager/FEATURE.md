# Server Manager Runtime Truth

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

## Orchestrator freshness

Each orchestrator's authenticated root response reports `source_sha`. Compare
both running tiers with the tested `deploy/hosted` approval ref. The latest
successful Deploy workflow is useful context, but it is neither the desired
release nor proof of what is running.

The separate **Recent deploys** check reports GitHub Actions history only; it
must not claim that a workflow record proves a process is running that commit.

## Operator feedback

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
