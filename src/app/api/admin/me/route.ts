import { NextResponse } from "next/server";
import { getAdminFromRequest } from "@/lib/auth/oauth";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/me
 * Returns the current admin session, or 401 if not signed in. Used by the admin
 * UI to decide whether to render the dashboard or the login screen.
 */
export async function GET(request: Request) {
  const r = await getAdminFromRequest(request);
  if (!r.ok) {
    return NextResponse.json({ authenticated: false, error: r.reason }, { status: r.status });
  }
  return NextResponse.json({
    authenticated: true,
    email: r.user.email,
    role: "admin",
    is_superadmin: r.user.isSuperadmin,
    level: r.user.level,
    auth_kind: r.user.authKind,
  });
}
