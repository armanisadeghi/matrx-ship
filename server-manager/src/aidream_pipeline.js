const AIDREAM_GITHUB_API = "https://api.github.com/repos/AI-Matrix-Engine/aidream";

// A cancelled workflow has no success/failure outcome that can verify a release.
// Fleet health must report the newest verified outcome, rather than presenting
// an aborted SHA as though it represented production.
export function latestExecutedWorkflowRun(workflowRuns = [], headSha) {
  return workflowRuns.find((run) => (
    (!headSha || run?.head_sha === headSha) &&
    run?.status === "completed" &&
    (run.conclusion === "success" || run.conclusion === "failure")
  ));
}

// A workflow_dispatch run's head_sha identifies the workflow checkout, which
// can differ from the immutable candidate the release actually deploys. Tests
// must therefore follow the SHA observed from the production runtime.
export function latestExecutedTestsForRuntime(testRuns = [], runtimeSha) {
  return runtimeSha ? latestExecutedWorkflowRun(testRuns, runtimeSha) : undefined;
}

export function unverifiedWorkflowHistory(workflowRuns = [], workflowLabel, status = "unknown") {
  if (workflowRuns.length === 0) {
    return {
      status,
      detail: `No completed aidream ${workflowLabel} runs found; no executed success or failure is available to verify.`,
    };
  }
  return {
    status,
    detail: `Recent completed aidream ${workflowLabel} runs do not include a verified executed success or failure.`,
  };
}

export async function fetchAidreamWorkflowRuns({
  token,
  workflow,
  // Deploys are released from main, while Tests may be manually dispatched
  // against an immutable release tag. Callers that must find a test result for
  // an exact deployed SHA can omit this filter and still match by head_sha.
  branch = "main",
  fetchImpl = fetch,
  // Cancellation storms routinely push the most recent executed result beyond
  // GitHub's default five rows. Fetch the full first page (GitHub's maximum)
  // so a health verdict is based on the current commit's last real outcome.
  perPage = 100,
  clock = () => Date.now(),
  nonce = () => crypto.randomUUID(),
}) {
  // Some intermediaries serve a stale GitHub response even when asked not to
  // cache it. Make every operational-truth request a distinct URL so a cache
  // that keys by URL cannot reuse an earlier completed-run response.
  const url = new URL(`${AIDREAM_GITHUB_API}/actions/workflows/${workflow}/runs`);
  if (branch) url.searchParams.set("branch", branch);
  url.searchParams.set("status", "completed");
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("_fresh", `${clock()}-${nonce()}`);
  const response = await fetchImpl(
    url,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "matrx-manager",
        // The Manager may sit behind a caching proxy. Workflow history is
        // operational truth, so never reuse an old completed-run response.
        "Cache-Control": "no-cache",
      },
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!response.ok) throw new Error(`GitHub API ${response.status}`);
  const body = await response.json();
  return body.workflow_runs || [];
}
