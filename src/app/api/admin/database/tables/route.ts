import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { listTables } from "@/lib/db/introspect";
import { requireAdmin } from "@/lib/auth/oauth";

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
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
