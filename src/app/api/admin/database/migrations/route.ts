import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getMigrationHistory } from "@/lib/db/introspect";
import { requireAdmin } from "@/lib/auth/oauth";

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const migrations = await getMigrationHistory();
    return NextResponse.json({ migrations });
  } catch (error) {
    logger.error({ err: error }, "[database/migrations] Error");
    return NextResponse.json(
      { error: "Failed to fetch migration history" },
      { status: 500 },
    );
  }
}
