import { db } from "./index";
import { logger } from "@/lib/logger";
import { appVersion, apiKeys } from "./schema";
import { eq, count } from "drizzle-orm";
import { generateApiKey } from "../utils";

/**
 * Seeds the database with initial data if empty.
 * - Creates an initial v1.0.0 version record
 * - Generates an API key if MATRX_SHIP_API_KEY is not set
 */
export async function seedDatabase(): Promise<void> {
  // Check if there are any versions
  const [versionCount] = await db
    .select({ count: count() })
    .from(appVersion);

  if (versionCount.count === 0) {
    logger.info("[matrx-ship] Seeding initial version...");
    await db.insert(appVersion).values({
      version: "1.0.0",
      buildNumber: 1,
      commitMessage: "Initial version",
      deploymentStatus: "ready",
    });
    logger.info("[matrx-ship] Created initial version v1.0.0");
  }

  // Check if there are any API keys
  const [keyCount] = await db.select({ count: count() }).from(apiKeys);

  if (keyCount.count === 0) {
    const envKey = process.env.MATRX_SHIP_API_KEY;
    const key = envKey || generateApiKey();

    await db.insert(apiKeys).values({
      key,
      label: "default",
    });

    if (!envKey) {
      logger.info({ key }, "[matrx-ship] Generated API key");
      logger.info("[matrx-ship] Set MATRX_SHIP_API_KEY env var to persist this key.");
    } else {
      logger.info("[matrx-ship] Registered API key from environment.");
    }
  }
}
