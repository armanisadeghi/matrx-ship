import assert from "node:assert/strict";
import test from "node:test";
import { fetchAidreamWorkflowRuns, latestExecutedWorkflowRun } from "./aidream_pipeline.js";

test("aidream workflow fetch bypasses stale cache responses for every workflow", async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, headers: init.headers });
    return new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 });
  };

  await fetchAidreamWorkflowRuns({ token: "manager-test-token", workflow: "deploy.yml", fetchImpl });
  await fetchAidreamWorkflowRuns({ token: "manager-test-token", workflow: "test.yml", fetchImpl });

  assert.deepEqual(requests, [
    {
      url: "https://api.github.com/repos/AI-Matrix-Engine/aidream/actions/workflows/deploy.yml/runs?branch=main&status=completed&per_page=5",
      headers: {
        Authorization: "Bearer manager-test-token",
        Accept: "application/vnd.github+json",
        "User-Agent": "matrx-manager",
        "Cache-Control": "no-cache",
      },
    },
    {
      url: "https://api.github.com/repos/AI-Matrix-Engine/aidream/actions/workflows/test.yml/runs?branch=main&status=completed&per_page=5",
      headers: {
        Authorization: "Bearer manager-test-token",
        Accept: "application/vnd.github+json",
        "User-Agent": "matrx-manager",
        "Cache-Control": "no-cache",
      },
    },
  ]);
});

test("aidream pipeline selects the latest executed result after a cancelled run", () => {
  const cancelled = { id: 973, status: "completed", conclusion: "cancelled", head_sha: "unsafe973" };
  const succeeded = { id: 972, status: "completed", conclusion: "success", head_sha: "deployed972" };
  const failed = { id: 971, status: "completed", conclusion: "failure", head_sha: "failed971" };

  // The old first-entry selection reported cancelled run 973. The health
  // decision must instead use the actual preceding release outcome.
  assert.equal(latestExecutedWorkflowRun([cancelled, succeeded, failed]), succeeded);
  assert.notEqual(latestExecutedWorkflowRun([cancelled, succeeded, failed]), cancelled);
});
