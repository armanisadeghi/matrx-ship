import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchAidreamWorkflowRuns,
  fetchAidreamReleaseCandidateSha,
  fetchAidreamWorkflowRunJobs,
  assessAidreamPipeline,
  latestExecutedWorkflowRun,
  latestRuntimeDeployRun,
  latestExecutedTestsForRuntime,
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

test("aidream pipeline matches tests to the observed production SHA, not dispatch metadata", () => {
  const dispatchedSha = "fa58932362b4a4ca0904dec6e438695cf23a2ac9";
  const runtimeSha = "498349dc0bbda840c077b105b356852f47a5853a";
  const deployRun = { id: 1027, status: "completed", conclusion: "success", head_sha: dispatchedSha };
  const testRun = { id: 1026, status: "completed", conclusion: "success", head_sha: runtimeSha };

  const selected = latestExecutedTestsForRuntime([testRun], runtimeSha);

  assert.equal(latestExecutedWorkflowRun([testRun], deployRun.head_sha), undefined);
  assert.equal(selected, testRun);
});

test("aidream pipeline warns when a successful deploy candidate is not running, even if old runtime tests passed", () => {
  const candidateSha = "498349dc0bbda840c077b105b356852f47a5853a";
  const oldRuntimeSha = "9e51492bfdacff178b91d2d7336a07ef07a81938";
  const oldPassingTest = { id: 1026, status: "completed", conclusion: "success", head_sha: oldRuntimeSha };

  const assessment = assessAidreamPipeline({
    deployConclusion: "success",
    candidateSha,
    runtimeSha: oldRuntimeSha,
    testRuns: [oldPassingTest],
  });

  assert.equal(assessment.kind, "runtime-mismatch");
  assert.equal(assessment.candidateSha, candidateSha);
  assert.equal(assessment.runtimeSha, oldRuntimeSha);
});

test("aidream pipeline never accepts a failed deploy as proof of current release freshness", () => {
  const assessment = assessAidreamPipeline({
    deployConclusion: "failure",
    candidateSha: "498349dc0bbda840c077b105b356852f47a5853a",
    runtimeSha: "498349dc0bbda840c077b105b356852f47a5853a",
    testRuns: [{ status: "completed", conclusion: "success", head_sha: "498349dc0bbda840c077b105b356852f47a5853a" }],
  });

  assert.equal(assessment.kind, "deploy-failed");
});

test("aidream pipeline warns when the release candidate cannot be established", () => {
  const runtimeSha = "498349dc0bbda840c077b105b356852f47a5853a";
  const assessment = assessAidreamPipeline({
    deployConclusion: "success",
    candidateSha: null,
    runtimeSha,
    testRuns: [{ status: "completed", conclusion: "success", head_sha: runtimeSha }],
  });

  assert.equal(assessment.kind, "candidate-unverified");
});

test("aidream release candidate resolves from the immutable version tag, not workflow head_sha", async () => {
  const candidateSha = "498349dc0bbda840c077b105b356852f47a5853a";
  const tagObjectSha = "2361b252d14db18f889f79f524e473d0c1b067c9";
  const seen = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    seen.push(parsed.pathname);
    if (parsed.pathname.endsWith("/git/ref/tags/v0.2.1027")) {
      return new Response(JSON.stringify({ object: { type: "tag", sha: tagObjectSha } }), { status: 200 });
    }
    if (parsed.pathname.endsWith(`/git/tags/${tagObjectSha}`)) {
      return new Response(JSON.stringify({ object: { type: "commit", sha: candidateSha } }), { status: 200 });
    }
    throw new Error(`unexpected GitHub API path: ${parsed.pathname}`);
  };

  const resolved = await fetchAidreamReleaseCandidateSha({
    display_title: "AI Dream release v0.2.1027",
    head_sha: "fa58932362b4a4ca0904dec6e438695cf23a2ac9",
  }, { token: "manager-test-token", fetchImpl });

  assert.equal(resolved, candidateSha);
  assert.deepEqual(seen, [
    "/repos/AI-Matrix-Engine/aidream/git/ref/tags/v0.2.1027",
    `/repos/AI-Matrix-Engine/aidream/git/tags/${tagObjectSha}`,
  ]);
});

test("aidream pipeline skips a newer successful workflow that did not run the ECS deploy step", async () => {
  const validationRun = { id: 1028, status: "completed", conclusion: "success", head_sha: "dispatch-head", display_title: "AI Dream release v0.2.1028" };
  const productionRun = { id: 1027, status: "completed", conclusion: "success", head_sha: "dispatch-head", display_title: "AI Dream release v0.2.1027" };
  const jobsByRun = new Map([
    [validationRun.id, [{ steps: [{ name: "Deploy production ECS services", conclusion: "skipped" }] }]],
    [productionRun.id, [{ steps: [{ name: "Deploy production ECS services", conclusion: "success" }] }]],
  ]);

  const selected = await latestRuntimeDeployRun([validationRun, productionRun], async (run) => jobsByRun.get(run.id));

  assert.equal(selected.run, productionRun);
  assert.equal(selected.deployConclusion, "success");
});

test("aidream workflow jobs are fetched from the matching run id", async () => {
  let requestedUrl;
  const fetchImpl = async (url) => {
    requestedUrl = new URL(url);
    return new Response(JSON.stringify({ jobs: [{ id: 123, steps: [] }] }), { status: 200 });
  };

  const jobs = await fetchAidreamWorkflowRunJobs({ runId: 36827851780, token: "manager-test-token", fetchImpl });

  assert.equal(jobs[0].id, 123);
  assert.equal(requestedUrl.pathname, "/repos/AI-Matrix-Engine/aidream/actions/runs/36827851780/jobs");
  assert.equal(requestedUrl.searchParams.get("per_page"), "100");
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
