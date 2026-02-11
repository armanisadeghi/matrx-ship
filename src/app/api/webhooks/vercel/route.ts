import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appVersion } from "@/lib/db/schema";
import { eq, gte, desc } from "drizzle-orm";
import crypto from "crypto";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/vercel
 * Receives Vercel deployment webhooks and updates app_version table.
 *
 * Webhook events:
 * - deployment.created   -> status: 'building'
 * - deployment.succeeded -> status: 'ready'
 * - deployment.error     -> status: 'error'
 * - deployment.canceled  -> status: 'canceled'
 */
export async function POST(request: Request) {
  try {
    const body = await request.text();
    const payload = JSON.parse(body);

    // Verify webhook signature if secret is configured
    const signature = request.headers.get("x-vercel-signature");
    const webhookSecret = process.env.VERCEL_WEBHOOK_SECRET;

    if (webhookSecret && signature) {
      const expectedSignature = crypto
        .createHmac("sha1", webhookSecret)
        .update(body)
        .digest("hex");

      if (signature !== expectedSignature) {
        console.error("[webhook/vercel] Invalid signature");
        return NextResponse.json(
          { error: "Invalid signature" },
          { status: 401 },
        );
      }
    }

    const { type, payload: eventPayload } = payload;
    const { deployment } = eventPayload || {};

    if (!deployment) {
      return NextResponse.json(
        { error: "No deployment data in payload" },
        { status: 400 },
      );
    }

    const deploymentId = deployment.id;
    const deploymentUrl = deployment.url;
    const gitCommit =
      deployment.meta?.githubCommitSha?.substring(0, 7) || null;

    let deploymentStatus: string;
    let deploymentError: string | null = null;

    switch (type) {
      case "deployment.created":
        deploymentStatus = "building";
        break;
      case "deployment.succeeded":
        deploymentStatus = "ready";
        break;
      case "deployment.error":
        deploymentStatus = "error";
        deploymentError = deployment.errorMessage || "Deployment failed";
        break;
      case "deployment.canceled":
        deploymentStatus = "canceled";
        break;
      default:
        return NextResponse.json({ message: "Event type ignored" });
    }

    // Find matching app_version record
    let versionId: string | null = null;

    if (gitCommit) {
      const [versionByCommit] = await db
        .select({ id: appVersion.id })
        .from(appVersion)
        .where(eq(appVersion.gitCommit, gitCommit))
        .orderBy(desc(appVersion.createdAt))
        .limit(1);

      versionId = versionByCommit?.id ?? null;
    }

    // Fallback: find most recent pending version within 10 minutes
    if (!versionId) {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const [recentVersion] = await db
        .select({ id: appVersion.id })
        .from(appVersion)
        .where(gte(appVersion.createdAt, tenMinutesAgo))
        .orderBy(desc(appVersion.createdAt))
        .limit(1);

      versionId = recentVersion?.id ?? null;
    }

    if (!versionId) {
      console.warn("[webhook/vercel] No matching version found", {
        gitCommit,
        deploymentId,
        type,
      });
      return NextResponse.json(
        { message: "No matching version found, webhook ignored" },
        { status: 200 },
      );
    }

    // Update the version record
    const updateData: Record<string, unknown> = {
      deploymentStatus,
      vercelDeploymentId: deploymentId,
      vercelDeploymentUrl: `https://${deploymentUrl}`,
      updatedAt: new Date(),
    };

    if (deploymentError) {
      updateData.deploymentError = deploymentError;
    }

    await db
      .update(appVersion)
      .set(updateData)
      .where(eq(appVersion.id, versionId));

    console.log("[webhook/vercel] Updated deployment status:", {
      versionId,
      status: deploymentStatus,
      deploymentId,
      gitCommit,
    });

    return NextResponse.json({
      message: "Webhook processed successfully",
      versionId,
      status: deploymentStatus,
    });
  } catch (error) {
    console.error("[webhook/vercel] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
