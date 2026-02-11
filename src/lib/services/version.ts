import { db } from "@/lib/db";
import { appVersion } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";

/**
 * Parse a semantic version string into [major, minor, patch].
 */
export function parseVersion(version: string): [number, number, number] {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Invalid version format: ${version}`);
  }
  return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
}

/**
 * Increment a semantic version.
 */
export function incrementVersion(
  version: string,
  type: "major" | "minor" | "patch",
): string {
  const [major, minor, patch] = parseVersion(version);
  switch (type) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
  }
}

/**
 * Get the current (latest) version from the database.
 */
export async function getCurrentVersion() {
  const [latest] = await db
    .select()
    .from(appVersion)
    .orderBy(desc(appVersion.buildNumber))
    .limit(1);

  return latest ?? null;
}

/**
 * Create a new version record.
 * Automatically increments the build number and version.
 */
export async function createVersion(params: {
  bumpType?: "major" | "minor" | "patch";
  customVersion?: string;
  gitCommit?: string;
  commitMessage?: string;
  linesAdded?: number;
  linesDeleted?: number;
  filesChanged?: number;
}) {
  const current = await getCurrentVersion();
  const currentVersion = current?.version ?? "1.0.0";
  const currentBuildNumber = current?.buildNumber ?? 0;

  // Determine new version
  let newVersion: string;
  if (params.customVersion) {
    parseVersion(params.customVersion); // Validate format
    newVersion = params.customVersion;
  } else {
    newVersion = incrementVersion(currentVersion, params.bumpType ?? "patch");
  }

  const newBuildNumber = currentBuildNumber + 1;

  // Check for duplicate by git commit
  if (params.gitCommit) {
    const [existing] = await db
      .select({ id: appVersion.id })
      .from(appVersion)
      .where(eq(appVersion.gitCommit, params.gitCommit))
      .limit(1);

    if (existing) {
      return {
        duplicate: true,
        version: currentVersion,
        buildNumber: currentBuildNumber,
      };
    }
  }

  const [inserted] = await db
    .insert(appVersion)
    .values({
      version: newVersion,
      buildNumber: newBuildNumber,
      gitCommit: params.gitCommit ?? null,
      commitMessage: params.commitMessage ?? null,
      linesAdded: params.linesAdded ?? null,
      linesDeleted: params.linesDeleted ?? null,
      filesChanged: params.filesChanged ?? null,
      deploymentStatus: "pending",
    })
    .returning();

  return {
    duplicate: false,
    id: inserted.id,
    version: newVersion,
    buildNumber: newBuildNumber,
  };
}
