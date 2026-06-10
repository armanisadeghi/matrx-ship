import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  authenticateOAuthAdmin,
  oauthEnabled,
  safeEqual,
} from "@/lib/auth/oauth";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const ONE_DAY_S = 60 * 60 * 24;

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

/**
 * POST /api/admin/session
 * Establishes an admin session from a Supabase access token (or the operator
 * break-glass secret). Validates the caller is an admin, then sets an HttpOnly
 * session cookie so subsequent same-origin admin API calls are authorized
 * without exposing the token to client-side JavaScript.
 */
export async function POST(request: Request) {
  let body: { access_token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const token = (body.access_token || "").trim();
  if (!token) return NextResponse.json({ error: "access_token is required" }, { status: 400 });

  // Operator break-glass secret.
  const secret = process.env.MATRX_SHIP_ADMIN_SECRET || "";
  if (secret && safeEqual(token, secret)) {
    const res = NextResponse.json({ ok: true, email: "operator", level: "super_admin", is_superadmin: true, auth_kind: "secret" });
    res.cookies.set(ADMIN_SESSION_COOKIE, token, cookieOptions(ONE_DAY_S));
    return res;
  }

  if (!oauthEnabled()) {
    return NextResponse.json({ error: "OAuth is not configured on this instance" }, { status: 503 });
  }

  const r = await authenticateOAuthAdmin(token);
  if (!r.ok) {
    if (r.reason === "not_admin") {
      logger.warn({ email: r.email }, "[auth] Non-admin attempted admin sign-in");
      return NextResponse.json({ error: "Not an authorized admin" }, { status: 403 });
    }
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const res = NextResponse.json({
    ok: true,
    email: r.user.email,
    level: r.user.level,
    is_superadmin: r.user.isSuperadmin,
    auth_kind: "oauth",
  });
  // Cookie lifetime tracks the JWT; verification re-checks exp on every request.
  res.cookies.set(ADMIN_SESSION_COOKIE, token, cookieOptions(ONE_DAY_S));
  return res;
}

/**
 * DELETE /api/admin/session — sign out (clear the session cookie).
 */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_SESSION_COOKIE, "", cookieOptions(0));
  return res;
}
