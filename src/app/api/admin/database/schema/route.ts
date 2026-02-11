import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getFullSchema, getTableSchema } from "@/lib/db/introspect";

export async function GET(request: Request) {
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
