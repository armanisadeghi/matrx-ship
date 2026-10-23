// Where ship's own source lives, on the host and on GitHub (monorepo move, 2026-10-22).
//
// Today ship is its own repository: GitHub armanisadeghi/matrx-ship, host checkout /srv/projects/matrx-ship.
// After it moves into the private aidream monorepo it is AI-Matrix-Engine/aidream, folder infra/matrx-ship,
// and the host reads it from an authenticated aidream checkout. Every value is an env knob whose default is
// today's truth, so nothing changes until the host env says so (set in the Manager's and Deploy's env,
// applied with Deploy's /manager "Update + Restart"):
//   SHIP_SOURCE_DIR   host folder holding ship's source       (default /srv/projects/matrx-ship;
//                     after the move /srv/projects/aidream/infra/matrx-ship). When set it wins over
//                     deployments.json defaults.source, which the Manager wrote with today's path.
//   SHIP_REPO         GitHub slug holding ship's source       (default armanisadeghi/matrx-ship)
//   SHIP_CI_WORKFLOW  ship's CI/CD workflow file in SHIP_REPO (default ci-cd.yml; ship-ci-cd.yml after the move)
// Git reads are path-limited to SHIP_SOURCE_DIR (`-- .`), so inside the monorepo they show ship's commits only.
export const SHIP_SOURCE_DEFAULT = "/srv/projects/matrx-ship";

export function shipSourceDir(config, env = process.env) {
  return env.SHIP_SOURCE_DIR || config?.defaults?.source || SHIP_SOURCE_DEFAULT;
}

export function shipRepo(env = process.env) {
  return env.SHIP_REPO || "armanisadeghi/matrx-ship";
}

export function shipCiWorkflow(env = process.env) {
  return env.SHIP_CI_WORKFLOW || "ci-cd.yml";
}

// The sandbox's source (matrx-sandbox moved into aidream at infra/matrx-sandbox, 2026-10-23). The /srv clone stays
// at /srv/projects/matrx-sandbox, now a sparse checkout of aidream with the sandbox in SANDBOX_SUBDIR; the
// hosted poller deploys refs/heads/deploy/sandbox-hosted; approvals are sandbox/deploy-approved/<sha> tags.
// Same knob pattern as ship's: every value an env override, the default today's truth.
export function sandboxRepo(env = process.env) {
  return env.SANDBOX_REPO || "AI-Matrix-Engine/aidream";
}

export function sandboxSubdir(env = process.env) {
  return env.SANDBOX_SUBDIR ?? "infra/matrx-sandbox";
}

export function sandboxDeployWorkflow(env = process.env) {
  return env.SANDBOX_DEPLOY_WORKFLOW || "sandbox-deploy.yml";
}

export function sandboxHostedRef(env = process.env) {
  return env.SANDBOX_HOSTED_REF || "deploy/sandbox-hosted";
}

export function sandboxApprovalTagPrefix(env = process.env) {
  return env.SANDBOX_APPROVAL_TAG_PREFIX || "sandbox/deploy-approved";
}
