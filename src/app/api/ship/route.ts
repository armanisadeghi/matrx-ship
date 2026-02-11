import { NextResponse } from "next/server";
import { validateApiKey } from "@/lib/auth/api-key";
import { createVersion } from "@/lib/services/version";

export const dynamic = "force-dynamic";

/**
 * POST /api/ship
 * Receives a ship event from the CLI tool.
 * Creates a new version record in the database.
 *
 * Body:
 * {
 *   bumpType?: "major" | "minor" | "patch"  (default: "patch")
 *   customVersion?: string                   (e.g., "2.0.0")
 *   gitCommit?: string                       (short hash, 7 chars)
 *   commitMessage?: string
 *   linesAdded?: number
 *   linesDeleted?: number
 *   filesChanged?: number
 * }
 */
export async function POST(request: Request) {
  // Authenticate
  const authError = await validateApiKey(request);
  if (authError) return authError;

  try {
    const body = await request.json();

    const {
      bumpType,
      customVersion,
      gitCommit,
      commitMessage,
      linesAdded,
      linesDeleted,
      filesChanged,
    } = body;

    // Validate bumpType if provided
    if (bumpType && !["major", "minor", "patch"].includes(bumpType)) {
      return NextResponse.json(
        { error: "bumpType must be 'major', 'minor', or 'patch'" },
        { status: 400 },
      );
    }

    const result = await createVersion({
      bumpType: bumpType ?? "patch",
      customVersion,
      gitCommit,
      commitMessage,
      linesAdded,
      linesDeleted,
      filesChanged,
    });

    if (result.duplicate) {
      return NextResponse.json(
        {
          message: "Version already exists for this commit",
          version: result.version,
          buildNumber: result.buildNumber,
          duplicate: true,
        },
        { status: 200 },
      );
    }

    return NextResponse.json(
      {
        message: "Version created successfully",
        id: result.id,
        version: result.version,
        buildNumber: result.buildNumber,
        duplicate: false,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[api/ship] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    );
  }
}
