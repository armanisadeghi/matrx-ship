import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { managedDatabases } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "@/lib/logger";

/**
 * GET /api/admin/databases
 * List all managed databases for this instance.
 * Returns both the local registry and live Postgres data.
 */
export async function GET() {
  try {
    const databases = await db
      .select()
      .from(managedDatabases)
      .orderBy(managedDatabases.createdAt);

    // Always include the default "ship" database
    const allDatabases = [
      {
        id: "default",
        databaseName: "ship",
        displayName: "Default Database",
        description: "Primary instance database — created automatically with your Ship instance",
        template: null,
        status: "active" as const,
        sizeBytes: null,
        tableCount: null,
        createdBy: "system",
        createdAt: null,
        updatedAt: null,
        isDefault: true,
      },
      ...databases.map((d) => ({ ...d, isDefault: false })),
    ];

    return NextResponse.json({ databases: allDatabases });
  } catch (error) {
    logger.error({ err: error }, "[databases] Error listing databases");
    return NextResponse.json(
      { error: "Failed to list databases" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/admin/databases
 * Create a new database inside this instance's Postgres.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { database_name, display_name, description, template } = body;

    if (!database_name || !display_name) {
      return NextResponse.json(
        { error: "database_name and display_name are required" },
        { status: 400 },
      );
    }

    // Validate database name
    if (!/^[a-z][a-z0-9_]*$/.test(database_name)) {
      return NextResponse.json(
        { error: "Invalid name. Use lowercase letters, numbers, and underscores. Must start with a letter." },
        { status: 400 },
      );
    }

    const reserved = ["postgres", "template0", "template1", "ship"];
    if (reserved.includes(database_name)) {
      return NextResponse.json(
        { error: `Name '${database_name}' is reserved` },
        { status: 400 },
      );
    }

    // Check if already registered
    const existing = await db
      .select()
      .from(managedDatabases)
      .where(eq(managedDatabases.databaseName, database_name))
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json(
        { error: `Database '${database_name}' already exists` },
        { status: 409 },
      );
    }

    // Create the actual database using raw SQL on the default connection
    // This works because the ship user has CREATEDB privilege
    const { sql: rawSql } = await import("drizzle-orm");
    await db.execute(
      rawSql`SELECT 1 FROM pg_database WHERE datname = ${database_name}`,
    );

    // Use postgres.js directly for CREATE DATABASE (can't run inside transaction)
    const postgres = (await import("postgres")).default;
    const adminClient = postgres(
      process.env.DATABASE_URL ?? "postgresql://ship:ship@localhost:5432/ship",
      { max: 1 },
    );

    try {
      // CREATE DATABASE can't use parameterized queries
      await adminClient.unsafe(`CREATE DATABASE "${database_name}" OWNER ship`);
    } finally {
      await adminClient.end();
    }

    // Apply template if specified
    if (template && template !== "blank") {
      try {
        const fs = await import("fs");
        const path = await import("path");
        const templatePath = path.join(
          process.cwd(),
          "drizzle",
          "templates",
          `${template}.sql`,
        );
        if (fs.existsSync(templatePath)) {
          const templateSql = fs.readFileSync(templatePath, "utf-8");
          const templateClient = postgres(
            (process.env.DATABASE_URL ?? "postgresql://ship:ship@localhost:5432/ship").replace(
              /\/[^/]+$/,
              `/${database_name}`,
            ),
            { max: 1 },
          );
          try {
            await templateClient.unsafe(templateSql);
          } finally {
            await templateClient.end();
          }
        }
      } catch (templateError) {
        logger.warn(
          { err: templateError },
          `[databases] Template '${template}' failed to apply`,
        );
      }
    }

    // Register in managed_databases
    const [created] = await db
      .insert(managedDatabases)
      .values({
        databaseName: database_name,
        displayName: display_name,
        description: description || null,
        template: template || "blank",
        status: "active",
        createdBy: "admin",
      })
      .returning();

    logger.info(
      { database: database_name, template },
      "[databases] Created new database",
    );

    return NextResponse.json(
      {
        success: true,
        database: created,
        data_tools: {
          nocodb: "/nocodb",
          mathesar: "/mathesar",
          directus: "/directus",
        },
      },
      { status: 201 },
    );
  } catch (error) {
    logger.error({ err: error }, "[databases] Error creating database");
    const message =
      error instanceof Error ? error.message : "Failed to create database";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
