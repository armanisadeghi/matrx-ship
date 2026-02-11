import { db } from "@/lib/db";
import { appVersion } from "@/lib/db/schema";
import { inArray, eq, desc } from "drizzle-orm";

/**
 * Vercel Deployment Sync Service
 *
 * Fetches actual deployment statuses from the Vercel API and persists them
 * to the `app_version` table. Only non-terminal records ("pending" or
 * "building") are synced — once a deployment reaches "ready", "error", or
 * "canceled" it is never re-checked.
 *
 * Safe to call on every page load: short-circuits immediately when
 * there are no rows to sync or Vercel credentials are missing.
 */

// ── Types ────────────────────────────────────────────────────────────

interface VercelDeployment {
  uid: string;
  url: string;
  state:
    | "BUILDING"
    | "ERROR"
    | "INITIALIZING"
    | "QUEUED"
    | "READY"
    | "CANCELED";
  meta?: {
    githubCommitSha?: string;
  };
}

interface VercelListResponse {
  deployments: VercelDeployment[];
}

type DeploymentStatus =
  | "pending"
  | "building"
  | "ready"
  | "error"
  | "canceled";

// ── Helpers ──────────────────────────────────────────────────────────

function mapVercelState(state: VercelDeployment["state"]): DeploymentStatus {
  switch (state) {
    case "READY":
      return "ready";
    case "ERROR":
      return "error";
    case "CANCELED":
      return "canceled";
    case "BUILDING":
    case "INITIALIZING":
    case "QUEUED":
      return "building";
    default:
      return "pending";
  }
}

function hasVercelCredentials(): boolean {
  return Boolean(
    process.env.VERCEL_ACCESS_TOKEN && process.env.VERCEL_PROJECT_ID,
  );
}

async function fetchVercelDeploymentMap(
  limit = 100,
): Promise<Map<string, VercelDeployment>> {
  const teamId = process.env.VERCEL_TEAM_ID;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const accessToken = process.env.VERCEL_ACCESS_TOKEN;

  let url = `https://api.vercel.com/v6/deployments?projectId=${projectId}&limit=${limit}`;
  if (teamId) {
    url += `&teamId=${teamId}`;
  }

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Vercel API ${response.status}: ${text}`);
  }

  const data: VercelListResponse = await response.json();

  const map = new Map<string, VercelDeployment>();
  for (const deployment of data.deployments) {
    const sha = deployment.meta?.githubCommitSha;
    if (sha) {
      const short = sha.substring(0, 7);
      if (!map.has(short)) {
        map.set(short, deployment);
      }
    }
  }

  return map;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Sync all `app_version` rows that are still in a non-terminal state
 * ("pending" or "building") with the actual Vercel deployment status.
 *
 * @returns The number of records that were updated.
 */
export async function syncPendingDeployments(): Promise<number> {
  if (!hasVercelCredentials()) {
    return 0;
  }

  // Find all records that haven't reached a terminal state
  const pendingVersions = await db
    .select({
      id: appVersion.id,
      gitCommit: appVersion.gitCommit,
      deploymentStatus: appVersion.deploymentStatus,
    })
    .from(appVersion)
    .where(inArray(appVersion.deploymentStatus, ["pending", "building"]))
    .orderBy(desc(appVersion.buildNumber))
    .limit(100);

  if (pendingVersions.length === 0) {
    return 0;
  }

  let deploymentMap: Map<string, VercelDeployment>;
  try {
    deploymentMap = await fetchVercelDeploymentMap();
  } catch (err) {
    console.error("[vercel-sync] Error fetching from Vercel:", err);
    return 0;
  }

  let updated = 0;

  for (const version of pendingVersions) {
    if (!version.gitCommit) continue;

    const deployment = deploymentMap.get(version.gitCommit);
    if (!deployment) continue;

    const newStatus = mapVercelState(deployment.state);
    if (newStatus === version.deploymentStatus) continue;

    try {
      await db
        .update(appVersion)
        .set({
          deploymentStatus: newStatus,
          vercelDeploymentId: deployment.uid,
          vercelDeploymentUrl: `https://${deployment.url}`,
          updatedAt: new Date(),
        })
        .where(eq(appVersion.id, version.id));

      updated++;
    } catch (updateError) {
      console.error(
        `[vercel-sync] Failed to update ${version.id}:`,
        updateError,
      );
    }
  }

  if (updated > 0) {
    console.log(`[vercel-sync] Updated ${updated} deployment statuses`);
  }

  return updated;
}
