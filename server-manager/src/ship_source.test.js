import assert from "node:assert/strict";
import test from "node:test";
import { SHIP_SOURCE_DEFAULT, shipSourceDir, shipRepo, shipCiWorkflow } from "./ship_source.js";

test("defaults are today's own-repo checkout, slug and workflow", () => {
  assert.equal(shipSourceDir({}, {}), "/srv/projects/matrx-ship");
  assert.equal(SHIP_SOURCE_DEFAULT, "/srv/projects/matrx-ship");
  assert.equal(shipRepo({}), "armanisadeghi/matrx-ship");
  assert.equal(shipCiWorkflow({}), "ci-cd.yml");
});

test("deployments.json defaults.source still applies when no env is set", () => {
  assert.equal(shipSourceDir({ defaults: { source: "/srv/projects/x" } }, {}), "/srv/projects/x");
});

test("after the move the env names the monorepo folder and wins over the old written path", () => {
  const env = { SHIP_SOURCE_DIR: "/srv/projects/aidream/infra/matrx-ship", SHIP_REPO: "AI-Matrix-Engine/aidream",
                SHIP_CI_WORKFLOW: "ship-ci-cd.yml" };
  assert.equal(shipSourceDir({ defaults: { source: "/srv/projects/matrx-ship" } }, env), "/srv/projects/aidream/infra/matrx-ship");
  assert.equal(shipRepo(env), "AI-Matrix-Engine/aidream");
  assert.equal(shipCiWorkflow(env), "ship-ci-cd.yml");
});

test("the sandbox's source is infra/matrx-sandbox of aidream, deployed by Sandbox Deploy (2026-10-23)", async () => {
  const m = await import("./ship_source.js");
  assert.equal(m.sandboxRepo({}), "AI-Matrix-Engine/aidream");
  assert.equal(m.sandboxSubdir({}), "infra/matrx-sandbox");
  assert.equal(m.sandboxDeployWorkflow({}), "sandbox-deploy.yml");
  assert.equal(m.sandboxHostedRef({}), "deploy/sandbox-hosted");
  assert.equal(m.sandboxApprovalTagPrefix({}), "sandbox/deploy-approved");
  assert.equal(m.sandboxSubdir({ SANDBOX_SUBDIR: "" }), "", "an explicit empty subdir means a standalone checkout");
  assert.equal(m.sandboxRepo({ SANDBOX_REPO: "x/y" }), "x/y");
});
