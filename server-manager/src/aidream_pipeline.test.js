import assert from "node:assert/strict";
import test from "node:test";
import { fetchAidreamWorkflowRuns, latestExecutedWorkflowRun, unverifiedWorkflowHistory } from "./aidream_pipeline.js";

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

test("aidream pipeline reports all-cancelled deploy history as unverified", () => {
  const cancelledRuns = [
    { id: 973, status: "completed", conclusion: "cancelled" },
    { id: 972, status: "completed", conclusion: "cancelled" },
  ];

  assert.equal(latestExecutedWorkflowRun(cancelledRuns), undefined);
  assert.deepEqual(unverifiedWorkflowHistory(cancelledRuns, "deploy"), {
    status: "unknown",
    detail: "Recent completed aidream deploy runs do not include a verified executed success or failure.",
  });
});

test("aidream pipeline reports empty test history as unverified", () => {
  assert.equal(latestExecutedWorkflowRun([]), undefined);
  assert.deepEqual(unverifiedWorkflowHistory([], "test", "warning"), {
    status: "warning",
    detail: "No completed aidream test runs found; no executed success or failure is available to verify.",
  });
});
