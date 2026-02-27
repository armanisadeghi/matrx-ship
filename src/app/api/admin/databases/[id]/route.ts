import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { managedDatabases } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "@/lib/logger";

/**
 * GET /api/admin/databases/:id
 * Get details for a specific managed database.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const [database] = await db
      .select()
      .from(managedDatabases)
      .where(eq(managedDatabases.id, id))
      .limit(1);

    if (!database) {
      return NextResponse.json(
        { error: "Database not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ database });
  } catch (error) {
    logger.error({ err: error }, "[databases/:id] Error fetching database");
    return NextResponse.json(
      { error: "Failed to fetch database" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/admin/databases/:id
 * Delete a managed database. Drops the actual Postgres database.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    // Look up the database record
    const [database] = await db
      .select()
      .from(managedDatabases)
      .where(eq(managedDatabases.id, id))
      .limit(1);

    if (!database) {
      return NextResponse.json(
        { error: "Database not found" },
        { status: 404 },
      );
    }

    const protectedDbs = ["ship", "postgres", "template0", "template1"];
    if (protectedDbs.includes(database.databaseName)) {
      return NextResponse.json(
        { error: `Cannot delete protected database '${database.databaseName}'` },
        { status: 400 },
      );
    }

    // Drop the actual database
    const postgres = (await import("postgres")).default;
    const adminClient = postgres(
      process.env.DATABASE_URL ?? "postgresql://ship:ship@localhost:5432/ship",
      { max: 1 },
    );

    try {
      // Terminate active connections first
      await adminClient.unsafe(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${database.databaseName}' AND pid <> pg_backend_pid()`,
      );
      await adminClient.unsafe(
        `DROP DATABASE IF EXISTS "${database.databaseName}"`,
      );
    } finally {
      await adminClient.end();
    }

    // Remove from registry
    await db
      .delete(managedDatabases)
      .where(eq(managedDatabases.id, id));

    logger.info(
      { database: database.databaseName },
      "[databases] Deleted database",
    );

    return NextResponse.json({ success: true, deleted: database.databaseName });
  } catch (error) {
    logger.error({ err: error }, "[databases/:id] Error deleting database");
    const message =
      error instanceof Error ? error.message : "Failed to delete database";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
