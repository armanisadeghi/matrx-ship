import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getFullSchema, getTableSchema } from "@/lib/db/introspect";
import { requireAdmin } from "@/lib/auth/oauth";

export async function GET(request: Request) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    const { searchParams } = new URL(request.url);
    const table = searchParams.get("table");

    if (table) {
      const schema = await getTableSchema(table);
      return NextResponse.json(schema);
    }

    const schemas = await getFullSchema();
    return NextResponse.json({ schemas });
  } catch (error) {
    logger.error({ err: error }, "[database/schema] Error");
    return NextResponse.json(
      { error: "Failed to fetch schema" },
      { status: 500 },
    );
  }
}
