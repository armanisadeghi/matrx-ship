import { NextResponse } from "next/server";
import { validateApiKey } from "@/lib/auth/api-key";
import { db } from "@/lib/db";
import { appVersion } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * POST /api/ship/import
 * Bulk import historical versions from git history.
 * Used by the ship:history CLI command to backfill version data.
 *
 * Body:
 * {
 *   versions: Array<{
 *     version: string;           // e.g., "0.0.42"
 *     buildNumber: number;       // sequential, starting from 1
 *     gitCommit: string;         // short hash (7 chars)
 *     commitMessage: string;
 *     linesAdded?: number;
 *     linesDeleted?: number;
 *     filesChanged?: number;
 *     deployedAt: string;        // ISO 8601 date (commit author date)
 *   }>;
 *   clearExisting?: boolean;     // Delete all existing versions first
 * }
 */
export async function POST(request: Request) {
  const authError = await validateApiKey(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { versions, clearExisting } = body;

    if (!Array.isArray(versions) || versions.length === 0) {
      return NextResponse.json(
        { error: "versions array is required and must not be empty" },
        { status: 400 },
      );
    }

    // Validate each version entry
    for (let i = 0; i < versions.length; i++) {
      const v = versions[i];
      if (!v.version || !v.buildNumber || !v.gitCommit || !v.deployedAt) {
        return NextResponse.json(
          {
            error: `Version at index ${i} missing required fields (version, buildNumber, gitCommit, deployedAt)`,
          },
          { status: 400 },
        );
      }
    }

    // If clearing, delete all existing versions
    let cleared = 0;
    if (clearExisting) {
      const deleted = await db.delete(appVersion).returning({ id: appVersion.id });
      cleared = deleted.length;
    }

    // Get existing git commits to skip duplicates
    const incomingCommits = versions.map(
      (v: { gitCommit: string }) => v.gitCommit,
    );
    const existing = await db
      .select({ gitCommit: appVersion.gitCommit })
      .from(appVersion)
      .where(inArray(appVersion.gitCommit, incomingCommits));
    const existingSet = new Set(existing.map((e) => e.gitCommit));

    // Filter to only new versions
    const newVersions = versions.filter(
      (v: { gitCommit: string }) => !existingSet.has(v.gitCommit),
    );

    if (newVersions.length === 0) {
      return NextResponse.json({
        message: "All versions already exist — nothing to import",
        imported: 0,
        skipped: versions.length,
        cleared,
      });
    }

    // Batch insert (chunks of 100 for safety)
    let imported = 0;
    const chunkSize = 100;

    for (let i = 0; i < newVersions.length; i += chunkSize) {
      const chunk = newVersions.slice(i, i + chunkSize);
      await db.insert(appVersion).values(
        chunk.map(
          (v: {
            version: string;
            buildNumber: number;
            gitCommit: string;
            commitMessage?: string;
            linesAdded?: number;
            linesDeleted?: number;
            filesChanged?: number;
            deployedAt: string;
          }) => ({
            version: v.version,
            buildNumber: v.buildNumber,
            gitCommit: v.gitCommit,
            commitMessage: v.commitMessage ?? null,
            linesAdded: v.linesAdded ?? null,
            linesDeleted: v.linesDeleted ?? null,
            filesChanged: v.filesChanged ?? null,
            deployedAt: new Date(v.deployedAt),
            createdAt: new Date(v.deployedAt),
            updatedAt: new Date(),
            deploymentStatus: "imported",
          }),
        ),
      );
      imported += chunk.length;
    }

    // Summary
    const skipped = versions.length - newVersions.length;
    const lastVersion = newVersions[newVersions.length - 1];

    return NextResponse.json(
      {
        message: `Imported ${imported} version(s) from git history`,
        imported,
        skipped,
        cleared,
        lastVersion: lastVersion?.version,
        lastBuildNumber: lastVersion?.buildNumber,
        lastCommit: lastVersion?.gitCommit,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[api/ship/import] Error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
