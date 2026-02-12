import { logger } from "@/lib/logger";

export async function register() {
  // Only run on the server (not edge)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { runMigrations } = await import("@/lib/db/migrate");
      await runMigrations();

      const { seedDatabase } = await import("@/lib/db/seed");
      await seedDatabase();
    } catch (error) {
      logger.error({ err: error }, "[matrx-ship] Startup initialization failed");
      
      // In production, fail fast if migrations fail
      // This prevents the app from starting in a broken state
      if (process.env.NODE_ENV === "production") {
        logger.error("[matrx-ship] Critical startup failure in production - exiting");
        process.exit(1);
      }
      
      // In development, log but continue (for hot reload scenarios)
      logger.warn("[matrx-ship] Continuing despite initialization failure (development mode)");
    }
  }
}
