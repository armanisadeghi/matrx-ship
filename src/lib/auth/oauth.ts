// ── OAuth admin auth: AI Matrx (Supabase) JWT verification + admin gate ──────
//
// Mirrors the Server Manager's oauth_auth.js. The browser logs in through
// aidream's OAuth broker (GET {MATRX_AIDREAM_URL}/auth/aimatrx?app_redirect=…),
// which runs PKCE against aimatrx.com, checks public.admins, and only then
// redirects back with ?access_token=<Supabase JWT>. We STILL re-verify here:
// a Supabase JWT is accepted only if
//   (a) its signature checks out against Supabase JWKS (ES256 / RS256), or the
//       legacy HS256 secret while old tokens are still in use,
//   (b) it isn't expired and has aud "authenticated", and
//   (c) the subject is present in public.admins.
// The SUPERADMIN gate is the admins.level column == "super_admin".
//
// Verification uses node:crypto — no JWT dependency. Asymmetric signing keys
// are cached from the Supabase JWKS endpoint, with an immediate refresh on an
// unknown kid for safe key rotation. SUPABASE_MATRIX_JWT_SECRET is optional and
// used only for legacy HS256 tokens.

import { NextResponse } from "next/server";
import {
  createHmac,
  createPublicKey,
  timingSafeEqual,
  createHash,
  verify as verifySignature,
  type JsonWebKey as NodeJsonWebKey,
} from "node:crypto";
import { logger } from "@/lib/logger";

const JWT_AUDIENCE = "authenticated";
const ADMIN_CACHE_TTL_MS = 60_000;
const JWKS_CACHE_TTL_MS = 10 * 60_000;
const JWKS_FORCED_REFRESH_MIN_INTERVAL_MS = 30_000;
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
type SupabaseJwk = NodeJsonWebKey & { alg?: string; kid?: string; kty?: string };
let _jwksCache: { url: string; keys: SupabaseJwk[]; ts: number } = { url: "", keys: [], ts: 0 };
let _lastForcedJwksRefresh = 0;

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
  return !!(supabaseUrl() && supabaseKey());
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
  nbf?: number;
  aud?: string | string[];
  iss?: string;
}

function codedError(message: string, code: string) {
  return Object.assign(new Error(message), { code });
}

async function fetchJwks(url: string): Promise<SupabaseJwk[]> {
  const resp = await fetch(url, { headers: { Accept: "application/json" } });
  if (!resp.ok) throw codedError(`JWKS request failed: HTTP ${resp.status}`, "jwks_unavailable");
  const body = (await resp.json()) as { keys?: SupabaseJwk[] };
  if (!Array.isArray(body.keys)) throw codedError("JWKS response has no keys", "jwks_invalid");
  _jwksCache = { url, keys: body.keys, ts: Date.now() };
  return body.keys;
}

async function findJwk(kid: string, alg: string): Promise<SupabaseJwk> {
  if (!kid) throw codedError("asymmetric JWT is missing kid", "missing_kid");
  const url = `${supabaseUrl()}/auth/v1/.well-known/jwks.json`;
  const cacheValid = _jwksCache.url === url && Date.now() - _jwksCache.ts < JWKS_CACHE_TTL_MS;
  let keys = cacheValid ? _jwksCache.keys : await fetchJwks(url);
  let key = keys.find((candidate) => candidate.kid === kid && candidate.alg === alg);
  if (!key && cacheValid && Date.now() - _lastForcedJwksRefresh >= JWKS_FORCED_REFRESH_MIN_INTERVAL_MS) {
    _lastForcedJwksRefresh = Date.now();
    keys = await fetchJwks(url);
    key = keys.find((candidate) => candidate.kid === kid && candidate.alg === alg);
  }
  if (!key) throw codedError(`no ${alg} signing key found for kid ${kid}`, "unknown_kid");
  return key;
}

// Verify a Supabase JWT. Modern projects use asymmetric JWKS keys; HS256 is
// accepted only when the legacy secret is explicitly configured.
export async function verifySupabaseJwt(token: string): Promise<JwtPayload> {
  if (!supabaseUrl()) throw codedError("oauth disabled", "disabled");
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw codedError("malformed jwt", "malformed");
  const [h, p, sig] = parts;

  let header: { alg?: string; kid?: string };
  try { header = JSON.parse(b64urlDecode(h).toString("utf-8")); }
  catch { throw codedError("malformed header", "malformed"); }

  const signingInput = Buffer.from(`${h}.${p}`);
  const signature = b64urlDecode(sig);
  let signatureOk = false;
  if (header.alg === "HS256") {
    const secret = jwtSecret();
    if (!secret) throw codedError("legacy HS256 secret is not configured", "hs256_disabled");
    const expected = createHmac("sha256", secret).update(signingInput).digest();
    signatureOk = signature.length === expected.length && timingSafeEqual(signature, expected);
  } else if (header.alg === "ES256" || header.alg === "RS256") {
    const jwk = await findJwk(header.kid || "", header.alg);
    const key = createPublicKey({ key: jwk, format: "jwk" });
    const keyOptions = header.alg === "ES256" ? { key, dsaEncoding: "ieee-p1363" as const } : key;
    signatureOk = verifySignature("sha256", signingInput, keyOptions, signature);
  } else {
    throw codedError(`unsupported alg ${header.alg}`, "bad_alg");
  }
  if (!signatureOk) throw codedError("bad signature", "bad_signature");

  let payload: JwtPayload;
  try { payload = JSON.parse(b64urlDecode(p).toString("utf-8")); }
  catch { throw codedError("malformed payload", "malformed"); }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now >= payload.exp) throw codedError("token expired", "expired");
  if (payload.nbf && now < payload.nbf) throw codedError("token not active yet", "not_active");
  const aud = payload.aud;
  const audOk = aud === JWT_AUDIENCE || (Array.isArray(aud) && aud.includes(JWT_AUDIENCE));
  if (aud && !audOk) throw codedError(`bad audience ${aud}`, "bad_audience");
  const expectedIssuer = `${supabaseUrl()}/auth/v1`;
  if (payload.iss && payload.iss.replace(/\/$/, "") !== expectedIssuer) {
    throw codedError(`bad issuer ${payload.iss}`, "bad_issuer");
  }

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
    payload = await verifySupabaseJwt(token);
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
