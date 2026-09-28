const AIDREAM_GITHUB_API = "https://api.github.com/repos/AI-Matrix-Engine/aidream";

// A cancelled workflow never reached its release work. Fleet health must report
// the newest executed success/failure, rather than presenting an aborted SHA as
// though it represented production.
export function latestExecutedWorkflowRun(workflowRuns = []) {
  return workflowRuns.find((run) => (
    run?.status === "completed" &&
    (run.conclusion === "success" || run.conclusion === "failure")
  ));
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

export async function fetchAidreamWorkflowRuns({ token, workflow, fetchImpl = fetch, perPage = 5 }) {
  const response = await fetchImpl(
    `${AIDREAM_GITHUB_API}/actions/workflows/${workflow}/runs?branch=main&status=completed&per_page=${perPage}`,
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
