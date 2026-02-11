import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { listTables } from "@/lib/db/introspect";

export async function GET() {
  try {
    const tables = await listTables();
    return NextResponse.json({ tables });
  } catch (error) {
    logger.error({ err: error }, "[database/tables] Error");
    return NextResponse.json(
      { error: "Failed to list tables" },
      { status: 500 },
    );
  }
}
