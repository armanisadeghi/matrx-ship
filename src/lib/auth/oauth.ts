// ── OAuth admin auth: AI Matrx (Supabase) JWT verification + admin gate ──────
//
// Mirrors the Server Manager's oauth_auth.js. The browser logs in through
// aidream's OAuth broker (GET {MATRX_AIDREAM_URL}/auth/aimatrx?app_redirect=…),
// which runs PKCE against aimatrx.com, checks public.admins, and only then
// redirects back with ?access_token=<Supabase JWT>. We STILL re-verify here:
// a Supabase JWT is accepted only if
//   (a) its HS256 signature checks out against SUPABASE_MATRIX_JWT_SECRET,
//   (b) it isn't expired and has aud "authenticated", and
//   (c) the subject is present in public.admins.
// The SUPERADMIN gate is the admins.level column == "super_admin".
//
// Verification uses node:crypto (HMAC-SHA256) — no JWT dependency. Disabled
// (every check returns "disabled") unless the three SUPABASE_MATRIX_* env vars
// are set, so an operator break-glass secret still works when OAuth isn't wired.

import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import { logger } from "@/lib/logger";

const JWT_AUDIENCE = "authenticated";
const ADMIN_CACHE_TTL_MS = 60_000;
export const ADMIN_SESSION_COOKIE = "matrx_admin_session";

interface AdminInfo {
  isAdmin: boolean;
  level: string | null;
  isSuperadmin: boolean;
}

export interface AdminUser {
  userId: string;
  email: string;
  level: string | null;
  isSuperadmin: boolean;
  authKind: "oauth" | "secret";
}

// userId -> { level, isAdmin, ts }
const _adminCache = new Map<string, { isAdmin: boolean; level: string | null; ts: number }>();

function jwtSecret() {
  return process.env.SUPABASE_MATRIX_JWT_SECRET || "";
}
function supabaseUrl() {
  return (process.env.SUPABASE_MATRIX_URL || "").replace(/\/$/, "");
}
function supabaseKey() {
  return process.env.SUPABASE_MATRIX_KEY || "";
}
function adminSecret() {
  return process.env.MATRX_SHIP_ADMIN_SECRET || "";
}

export function oauthEnabled() {
  return !!(jwtSecret() && supabaseUrl() && supabaseKey());
}

export function aidreamUrl() {
  return process.env.MATRX_AIDREAM_URL || "https://server.app.matrxserver.com";
}

// Constant-time string comparison (hashes both sides to a fixed-length digest).
export function safeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

interface JwtPayload {
  sub?: string;
  email?: string;
  exp?: number;
  aud?: string | string[];
}

// Verify a Supabase HS256 JWT. Returns the payload, or throws Error with .code.
export function verifySupabaseJwt(token: string): JwtPayload {
  const secret = jwtSecret();
  if (!secret) throw Object.assign(new Error("oauth disabled"), { code: "disabled" });
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw Object.assign(new Error("malformed jwt"), { code: "malformed" });
  const [h, p, sig] = parts;

  let header: { alg?: string };
  try { header = JSON.parse(b64urlDecode(h).toString("utf-8")); }
  catch { throw Object.assign(new Error("malformed header"), { code: "malformed" }); }
  if (header.alg !== "HS256") throw Object.assign(new Error(`unsupported alg ${header.alg}`), { code: "bad_alg" });

  const expected = createHmac("sha256", secret).update(`${h}.${p}`).digest();
  const got = b64urlDecode(sig);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    throw Object.assign(new Error("bad signature"), { code: "bad_signature" });
  }

  let payload: JwtPayload;
  try { payload = JSON.parse(b64urlDecode(p).toString("utf-8")); }
  catch { throw Object.assign(new Error("malformed payload"), { code: "malformed" }); }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now >= payload.exp) throw Object.assign(new Error("token expired"), { code: "expired" });
  const aud = payload.aud;
  const audOk = aud === JWT_AUDIENCE || (Array.isArray(aud) && aud.includes(JWT_AUDIENCE));
  if (aud && !audOk) throw Object.assign(new Error(`bad audience ${aud}`), { code: "bad_audience" });

  return payload;
}

// Look the user up in public.admins (automation-matrix). Cached per user.
// Throws on transport error (fail-closed — caller treats as denied).
export async function resolveAdmin(userId: string): Promise<AdminInfo> {
  if (!userId) return { isAdmin: false, level: null, isSuperadmin: false };
  const cached = _adminCache.get(userId);
  if (cached && Date.now() - cached.ts < ADMIN_CACHE_TTL_MS) {
    return { isAdmin: cached.isAdmin, level: cached.level, isSuperadmin: cached.level === "super_admin" };
  }
  const url = `${supabaseUrl()}/rest/v1/admins?user_id=eq.${encodeURIComponent(userId)}&select=user_id,level`;
  const resp = await fetch(url, {
    headers: {
      apikey: supabaseKey(),
      Authorization: `Bearer ${supabaseKey()}`,
      Accept: "application/json",
      // This Supabase project's PostgREST defaults to the `api` schema; admins
      // lives in `public`. Accept-Profile selects the schema for this read.
      "Accept-Profile": "public",
    },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`admins lookup failed: HTTP ${resp.status} ${body.slice(0, 120)}`);
  }
  const rows = await resp.json();
  const row = Array.isArray(rows) && rows.length ? rows[0] : null;
  const level: string | null = row ? row.level : null;
  const isAdmin = !!row;
  _adminCache.set(userId, { isAdmin, level, ts: Date.now() });
  return { isAdmin, level, isSuperadmin: level === "super_admin" };
}

// Verify a bearer/cookie token as an OAuth admin. Never throws.
export async function authenticateOAuthAdmin(
  token: string,
): Promise<{ ok: true; user: AdminUser } | { ok: false; reason: string; email?: string }> {
  if (!oauthEnabled()) return { ok: false, reason: "disabled" };
  let payload: JwtPayload;
  try {
    payload = verifySupabaseJwt(token);
  } catch (e) {
    return { ok: false, reason: (e as { code?: string }).code || "invalid" };
  }
  const userId = String(payload.sub || "");
  try {
    const a = await resolveAdmin(userId);
    if (!a.isAdmin) return { ok: false, reason: "not_admin", email: payload.email };
    return {
      ok: true,
      user: { userId, email: payload.email || "", level: a.level, isSuperadmin: a.isSuperadmin, authKind: "oauth" },
    };
  } catch (e) {
    return { ok: false, reason: `lookup_error: ${(e as Error).message}` };
  }
}

// Pull the admin token from the session cookie first, then a Bearer header
// (programmatic callers / break-glass).
function extractToken(request: Request): string | null {
  const cookie = request.headers.get("cookie") || "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${ADMIN_SESSION_COOKIE}=([^;]+)`));
  if (m) return decodeURIComponent(m[1]);
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

// Resolve the admin for a request (cookie or bearer). Returns the user, or a
// reason. Accepts the operator break-glass secret as well as OAuth admins.
export async function getAdminFromRequest(
  request: Request,
): Promise<{ ok: true; user: AdminUser } | { ok: false; status: number; reason: string }> {
  const token = extractToken(request);

  // Operator break-glass: MATRX_SHIP_ADMIN_SECRET via cookie or Bearer.
  const secret = adminSecret();
  if (token && secret && safeEqual(token, secret)) {
    return { ok: true, user: { userId: "operator", email: "operator", level: "super_admin", isSuperadmin: true, authKind: "secret" } };
  }

  if (oauthEnabled()) {
    if (!token) return { ok: false, status: 401, reason: "Authentication required" };
    const r = await authenticateOAuthAdmin(token);
    if (r.ok) return r;
    if (r.reason === "not_admin") return { ok: false, status: 403, reason: "Not an authorized admin" };
    if (r.reason === "expired") return { ok: false, status: 401, reason: "Session expired" };
    return { ok: false, status: 401, reason: "Invalid session" };
  }

  // Neither OAuth nor a break-glass secret is configured.
  if (token && secret) return { ok: false, status: 401, reason: "Invalid token" };
  if (process.env.NODE_ENV === "production") {
    logger.error("[auth] Admin auth not configured (no SUPABASE_MATRIX_* and no MATRX_SHIP_ADMIN_SECRET) — denying in production");
    return { ok: false, status: 503, reason: "Admin authentication is not configured on this instance" };
  }
  // Dev convenience: open when nothing is configured.
  return { ok: true, user: { userId: "dev", email: "dev", level: "super_admin", isSuperadmin: true, authKind: "secret" } };
}

// Route guard: returns null when authorized as an admin, else a NextResponse.
export async function requireAdmin(request: Request): Promise<NextResponse | null> {
  const r = await getAdminFromRequest(request);
  if (r.ok) return null;
  return NextResponse.json({ error: r.reason }, { status: r.status });
}

// Route guard: like requireAdmin but also requires super_admin level. Reserved
// for the higher-privilege internal actions to be gated later.
export async function requireSuperadmin(request: Request): Promise<NextResponse | null> {
  const r = await getAdminFromRequest(request);
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.status });
  if (!r.user.isSuperadmin) return NextResponse.json({ error: "Requires super admin" }, { status: 403 });
  return null;
}
