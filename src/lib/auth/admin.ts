import { NextResponse } from "next/server";

/**
 * Validate admin access for browser-based admin dashboard requests.
 * 
 * For now, admin routes accessed from the browser don't require
 * auth headers (they're protected by network/deployment access).
 * API routes that need programmatic auth use validateAdminAccess from api-key.ts.
 *
 * This middleware can be extended to check session cookies,
 * Supabase JWT, or other auth mechanisms in the future.
 */
export async function requireAdmin(
  _request: Request,
): Promise<NextResponse | null> {
  // For admin dashboard API routes accessed from the browser,
  // we rely on the admin secret or API key auth
  const adminSecret = process.env.MATRX_SHIP_ADMIN_SECRET;

  // If admin secret is set, check for it
  if (adminSecret) {
    const authHeader = _request.headers.get("authorization");
    if (authHeader === `Bearer ${adminSecret}`) {
      return null; // Valid
    }

    // For browser requests (no auth header), allow access if no secret is required
    // This allows the admin UI to work without auth during development
    if (!authHeader) {
      return null;
    }

    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  // No admin secret configured — allow access (dev mode)
  return null;
}
