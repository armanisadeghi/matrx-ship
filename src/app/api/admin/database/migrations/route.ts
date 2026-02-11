import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getMigrationHistory } from "@/lib/db/introspect";

export async function GET() {
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
