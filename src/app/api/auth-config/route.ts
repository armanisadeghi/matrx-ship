import { NextResponse } from "next/server";
import { oauthEnabled, aidreamUrl } from "@/lib/auth/oauth";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth-config (public)
 * Tells the login screen whether OAuth is available and where the broker lives.
 * Reveals no secrets — only feature flags the client needs to render sign-in.
 */
export async function GET() {
  return NextResponse.json({
    oauth_enabled: oauthEnabled(),
    aidream_url: aidreamUrl(),
    operator_login: !!process.env.MATRX_SHIP_ADMIN_SECRET,
  });
}
