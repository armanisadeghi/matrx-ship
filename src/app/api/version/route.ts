import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getCurrentVersion } from "@/lib/services/version";
import { syncPendingDeployments } from "@/lib/services/vercel-sync";

export const dynamic = "force-dynamic";

/**
 * GET /api/version
 * Returns the current deployed version of the app.
 * Used by clients to check if they need to refresh.
 *
 * Before returning, syncs any pending/building records with Vercel
 * so the reported status is always accurate.
 */
export async function GET() {
  try {
    await syncPendingDeployments();

    const data = await getCurrentVersion();

    if (!data) {
      return NextResponse.json(
        { error: "No version found" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      version: data.version,
      buildNumber: data.buildNumber,
      gitCommit: data.gitCommit,
      commitMessage: data.commitMessage,
      linesAdded: data.linesAdded,
      linesDeleted: data.linesDeleted,
      filesChanged: data.filesChanged,
      deployedAt: data.deployedAt,
      deploymentStatus: data.deploymentStatus,
      vercelDeploymentUrl: data.vercelDeploymentUrl,
      deploymentError: data.deploymentError,
    });
  } catch (error) {
    logger.error({ err: error }, "[api/version] Error");
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
