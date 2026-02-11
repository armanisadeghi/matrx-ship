import { migrate } from "drizzle-orm/postgres-js/migrator";
import { logger } from "@/lib/logger";
import { createMigrationClient } from "./index";

/**
 * Run database migrations.
 * Called on app startup (via instrumentation) to ensure the schema is current.
 */
export async function runMigrations(): Promise<void> {
  logger.info("[matrx-ship] Running database migrations...");
  const db = createMigrationClient();

  try {
    await migrate(db, {
      migrationsFolder: "./drizzle/migrations",
    });
    logger.info("[matrx-ship] Migrations complete.");
  } catch (error) {
    logger.error({ err: error }, "[matrx-ship] Migration failed");
    throw error;
  }
}
