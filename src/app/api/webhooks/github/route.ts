import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { createVersion } from "@/lib/services/version";
import crypto from "crypto";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/github
 * Receives GitHub push webhooks and auto-creates a version record.
 * This replaces the GitHub Actions workflow for version tracking.
 *
 * Configure in GitHub: Settings -> Webhooks -> Add webhook
 * - Payload URL: https://your-ship-instance.com/api/webhooks/github
 * - Content type: application/json
 * - Secret: your GITHUB_WEBHOOK_SECRET
 * - Events: Just the push event
 */
export async function POST(request: Request) {
  try {
    const body = await request.text();

    // Verify webhook signature
    const signature = request.headers.get("x-hub-signature-256");
    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

    if (webhookSecret && signature) {
      const expectedSignature =
        "sha256=" +
        crypto
          .createHmac("sha256", webhookSecret)
          .update(body)
          .digest("hex");

      if (signature !== expectedSignature) {
        logger.error("[webhook/github] Invalid signature");
        return NextResponse.json(
          { error: "Invalid signature" },
          { status: 401 },
        );
      }
    }

    const payload = JSON.parse(body);
    const event = request.headers.get("x-github-event");

    // Only handle push events to the default branch
    if (event !== "push") {
      return NextResponse.json({ message: "Event type ignored" });
    }

    // Check if this is the default branch
    const ref = payload.ref;
    const defaultBranch = payload.repository?.default_branch ?? "main";
    if (ref !== `refs/heads/${defaultBranch}`) {
      return NextResponse.json({
        message: "Push to non-default branch ignored",
      });
    }

    const headCommit = payload.head_commit;
    if (!headCommit) {
      return NextResponse.json({
        message: "No head commit in payload",
      });
    }

    // Calculate code stats from commits
    let linesAdded = 0;
    let linesDeleted = 0;
    let filesChanged = 0;

    for (const commit of payload.commits || []) {
      filesChanged +=
        (commit.added?.length ?? 0) +
        (commit.removed?.length ?? 0) +
        (commit.modified?.length ?? 0);
    }

    const result = await createVersion({
      bumpType: "patch",
      gitCommit: headCommit.id?.substring(0, 7),
      commitMessage: headCommit.message,
      linesAdded,
      linesDeleted,
      filesChanged,
    });

    if (result.duplicate) {
      return NextResponse.json({
        message: "Version already exists for this commit",
        version: result.version,
        buildNumber: result.buildNumber,
      });
    }

    logger.info(
      {
        version: result.version,
        buildNumber: result.buildNumber,
        commit: headCommit.id?.substring(0, 7),
      },
      "[webhook/github] Created version"
    );

    return NextResponse.json({
      message: "Version created from push",
      version: result.version,
      buildNumber: result.buildNumber,
    });
  } catch (error) {
    logger.error({ err: error }, "[webhook/github] Error");
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
