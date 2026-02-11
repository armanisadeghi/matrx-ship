import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createMigrationClient } from "./index";

/**
 * Run database migrations.
 * Called on app startup (via instrumentation) to ensure the schema is current.
 */
export async function runMigrations(): Promise<void> {
  console.log("[matrx-ship] Running database migrations...");
  const db = createMigrationClient();

  try {
    await migrate(db, {
      migrationsFolder: "./drizzle/migrations",
    });
    console.log("[matrx-ship] Migrations complete.");
  } catch (error) {
    console.error("[matrx-ship] Migration failed:", error);
    throw error;
  }
}
