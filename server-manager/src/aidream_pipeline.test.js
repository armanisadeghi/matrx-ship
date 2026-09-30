import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchAidreamWorkflowRuns,
  latestExecutedWorkflowRun,
  unverifiedWorkflowHistory,
} from "./aidream_pipeline.js";

test("aidream workflow fetch evicts a URL-keyed cached completed-run response", async () => {
  const cachedByUrl = new Map();
  const freshResponses = [
    { workflow_runs: [{ id: 35712144024, conclusion: "failure" }] },
    { workflow_runs: [{ id: 972, conclusion: "success" }] },
  ];
  const fetchImpl = async (url) => {
    const key = String(url);
    if (!cachedByUrl.has(key)) cachedByUrl.set(key, freshResponses.shift());
    return new Response(JSON.stringify(cachedByUrl.get(key)), { status: 200 });
  };
  const clock = () => 1_790_000_000_000;
  let nextNonce = 0;
  const nonce = () => `test-${nextNonce++}`;

  const first = await fetchAidreamWorkflowRuns({ token: "manager-test-token", workflow: "deploy.yml", fetchImpl, clock, nonce });
  const second = await fetchAidreamWorkflowRuns({ token: "manager-test-token", workflow: "deploy.yml", fetchImpl, clock, nonce });

  assert.equal(first[0].id, 35712144024);
  assert.equal(second[0].id, 972);
  assert.equal(cachedByUrl.size, 2, "each operational lookup must have a distinct cache key");
  const urls = [...cachedByUrl.keys()];
  assert.match(urls[0], /branch=main/);
  assert.match(urls[0], /status=completed/);
  assert.match(urls[0], /per_page=100/);
  assert.match(urls[0], /_fresh=1790000000000-test-0/);
  assert.match(urls[1], /_fresh=1790000000000-test-1/);
  assert.notEqual(urls[0], urls[1]);
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

test("aidream pipeline ignores a stale failed test from another commit", () => {
  const workflowRuns = [
    { id: 108, status: "completed", conclusion: "failure", head_sha: "sep22-stale" },
    { id: 107, status: "completed", conclusion: "cancelled", head_sha: "current-sha" },
    { id: 106, status: "completed", conclusion: "success", head_sha: "current-sha" },
  ];

  assert.equal(latestExecutedWorkflowRun(workflowRuns), workflowRuns[0]);
  assert.equal(latestExecutedWorkflowRun(workflowRuns, "current-sha"), workflowRuns[2]);
});

test("aidream pipeline finds a tag-dispatched test for the deployed SHA without accepting another ref", async () => {
  const deployedSha = "4f362dcae19a8c5f9d5b7e13b0e2b1ac9ff10014";
  const fetchImpl = async (url) => {
    assert.doesNotMatch(String(url), /branch=/, "cross-ref test lookup must not exclude release tags");
    return new Response(JSON.stringify({
      workflow_runs: [
        { id: 999, status: "completed", conclusion: "success", head_sha: "main-only-success" },
        { id: 36764554359, status: "completed", conclusion: "success", head_sha: deployedSha, head_branch: "v0.2.1014" },
      ],
    }), { status: 200 });
  };

  const runs = await fetchAidreamWorkflowRuns({
    token: "manager-test-token",
    workflow: "test.yml",
    branch: null,
    fetchImpl,
  });

  assert.equal(latestExecutedWorkflowRun(runs, deployedSha), runs[1]);
  assert.equal(latestExecutedWorkflowRun(runs, "different-deployed-sha"), undefined);
});

test("aidream pipeline finds the executed result behind more than five cancelled runs", () => {
  const workflowRuns = [
    ...Array.from({ length: 6 }, (_, index) => ({
      id: 200 - index,
      status: "completed",
      conclusion: "cancelled",
      head_sha: "current-sha",
    })),
    { id: 193, status: "completed", conclusion: "success", head_sha: "current-sha" },
  ];

  assert.equal(latestExecutedWorkflowRun(workflowRuns, "current-sha"), workflowRuns[6]);
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
