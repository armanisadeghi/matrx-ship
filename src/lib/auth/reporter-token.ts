import { NextResponse } from "next/server";

/**
 * Validate a reporter token for user-facing ticket submissions.
 * Reporter tokens are simpler than API keys — they're a project-level
 * shared secret that allows: submit, view own tickets, message on own, upload.
 *
 * Expects: Authorization: Bearer rt_xxxxx
 * Or: X-Reporter-Token: rt_xxxxx
 *
 * Returns null if valid, or a NextResponse error if invalid.
 * Also extracts reporterId from header if present.
 */
export function validateReporterToken(
  request: Request,
): NextResponse | null {
  const token = getReporterToken(request);
  if (!token) {
    return NextResponse.json(
      { error: "Missing reporter token" },
      { status: 401 },
    );
  }

  const expectedToken = process.env.MATRX_SHIP_REPORTER_TOKEN;
  if (!expectedToken) {
    // No reporter token configured — allow access (dev mode)
    return null;
  }

  if (token !== expectedToken) {
    return NextResponse.json(
      { error: "Invalid reporter token" },
      { status: 401 },
    );
  }

  return null;
}

/**
 * Extract the reporter token from request headers.
 */
export function getReporterToken(request: Request): string | null {
  // Check X-Reporter-Token header first
  const tokenHeader = request.headers.get("x-reporter-token");
  if (tokenHeader) return tokenHeader;

  // Check Authorization header for rt_ prefix
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer rt_")) {
    return authHeader.slice(7);
  }

  return null;
}

/**
 * Validate either API key (full access) or reporter token (limited access).
 * Returns { auth: "api_key" | "reporter", error?: NextResponse }.
 */
export async function validateTicketAuth(
  request: Request,
): Promise<{ auth: "api_key" | "reporter" | "admin_ui"; error?: NextResponse }> {
  // Import dynamically to avoid circular dependency
  const { validateApiKey } = await import("./api-key");

  // Check if this is a browser request from the admin UI (no auth header)
  const authHeader = request.headers.get("authorization");
  const reporterHeader = request.headers.get("x-reporter-token");

  if (!authHeader && !reporterHeader) {
    // Browser-based admin UI request — allow in dev or when no admin secret
    const adminSecret = process.env.MATRX_SHIP_ADMIN_SECRET;
    if (!adminSecret) {
      return { auth: "admin_ui" };
    }
    return { auth: "admin_ui" }; // Admin UI requests from the same origin
  }

  // Try API key first
  if (authHeader && !authHeader.startsWith("Bearer rt_")) {
    const apiKeyError = await validateApiKey(request);
    if (!apiKeyError) {
      return { auth: "api_key" };
    }
  }

  // Try reporter token
  const reporterError = validateReporterToken(request);
  if (!reporterError) {
    return { auth: "reporter" };
  }

  return {
    auth: "reporter",
    error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  };
}
