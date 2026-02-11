export async function register() {
  // Only run on the server (not edge)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { runMigrations } = await import("@/lib/db/migrate");
      await runMigrations();

      const { seedDatabase } = await import("@/lib/db/seed");
      await seedDatabase();
    } catch (error) {
      console.error("[matrx-ship] Startup initialization failed:", error);
      // Don't crash — the app can still serve static pages
    }
  }
}
