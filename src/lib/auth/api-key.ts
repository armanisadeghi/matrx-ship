import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { apiKeys } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * Validate an API key from the request headers.
 * Expects: Authorization: Bearer sk_ship_xxxxx
 *
 * Returns null if valid, or a NextResponse error if invalid.
 */
export async function validateApiKey(
  request: Request,
): Promise<NextResponse | null> {
  const authHeader = request.headers.get("authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Missing or invalid Authorization header" },
      { status: 401 },
    );
  }

  const key = authHeader.slice(7); // Remove "Bearer "

  // Check env var first (fast path)
  const envKey = process.env.MATRX_SHIP_API_KEY;
  if (envKey && key === envKey) {
    return null; // Valid
  }

  // Check database
  try {
    const [found] = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.key, key))
      .limit(1);

    if (!found || found.isActive !== 1) {
      return NextResponse.json(
        { error: "Invalid API key" },
        { status: 401 },
      );
    }

    // Update last used timestamp (fire-and-forget)
    db.update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, found.id))
      .then(() => {})
      .catch(() => {});

    return null; // Valid
  } catch (error) {
    console.error("[auth] Error validating API key:", error);
    return NextResponse.json(
      { error: "Authentication error" },
      { status: 500 },
    );
  }
}

/**
 * Validate admin access.
 * Checks for MATRX_SHIP_ADMIN_SECRET or falls back to API key validation.
 */
export async function validateAdminAccess(
  request: Request,
): Promise<NextResponse | null> {
  const adminSecret = process.env.MATRX_SHIP_ADMIN_SECRET;

  if (adminSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader === `Bearer ${adminSecret}`) {
      return null; // Valid admin
    }
  }

  // Fall back to API key validation
  return validateApiKey(request);
}
