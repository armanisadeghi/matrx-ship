// ── OAuth admin auth: AI Matrx (Supabase) JWT verification + admin gate ──────
//
// Mirrors how the AIDREAM dashboards authenticate. The browser logs in through
// aidream's OAuth broker (GET {AIDREAM_API_URL}/auth/aimatrx?app_redirect=…),
// which runs PKCE against aimatrx.com, checks public.admins, and only then
// redirects back with ?access_token=<Supabase JWT>. So:
//
//   * The ADMIN gate is enforced at login by aidream — non-admins never get a
//     token. We STILL re-verify here: a Bearer Supabase JWT is accepted only if
//     (a) its HS256 signature checks out against SUPABASE_MATRIX_JWT_SECRET,
//     (b) it isn't expired and has aud "authenticated", and
//     (c) the subject is present in public.admins.
//   * The SUPERADMIN gate is the admins.level column == "super_admin".
//
// Verification uses node:crypto (HMAC-SHA256) — no JWT dependency, same style
// as agent_gateway.js. The admins lookup hits the automation-matrix Supabase
// PostgREST with the service key, cached briefly per user.
//
// Disabled (every check returns null) unless the three env vars are set, so the
// existing operator-token auth keeps working untouched when OAuth isn't wired.

import { createHmac, timingSafeEqual } from "node:crypto";

const JWT_AUDIENCE = "authenticated";
const ADMIN_CACHE_TTL_MS = 60_000;

// userId -> { level, isAdmin, ts }
const _adminCache = new Map();

function jwtSecret() {
  return process.env.SUPABASE_MATRIX_JWT_SECRET || "";
}
function supabaseUrl() {
  return (process.env.SUPABASE_MATRIX_URL || "").replace(/\/$/, "");
}
function supabaseKey() {
  return process.env.SUPABASE_MATRIX_KEY || "";
}

export function oauthEnabled() {
  return !!(jwtSecret() && supabaseUrl() && supabaseKey());
}

function b64urlDecode(s) {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

// Verify a Supabase HS256 JWT. Returns the payload, or throws Error with .code:
// "disabled" | "malformed" | "bad_alg" | "bad_signature" | "expired" | "bad_audience".
export function verifySupabaseJwt(token) {
  const secret = jwtSecret();
  if (!secret) { const e = new Error("oauth disabled"); e.code = "disabled"; throw e; }
  const parts = String(token || "").split(".");
  if (parts.length !== 3) { const e = new Error("malformed jwt"); e.code = "malformed"; throw e; }
  const [h, p, sig] = parts;

  let header;
  try { header = JSON.parse(b64urlDecode(h).toString("utf-8")); } catch { const e = new Error("malformed header"); e.code = "malformed"; throw e; }
  if (header.alg !== "HS256") { const e = new Error(`unsupported alg ${header.alg}`); e.code = "bad_alg"; throw e; }

  const expected = createHmac("sha256", secret).update(`${h}.${p}`).digest();
  const got = b64urlDecode(sig);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    const e = new Error("bad signature"); e.code = "bad_signature"; throw e;
  }

  let payload;
  try { payload = JSON.parse(b64urlDecode(p).toString("utf-8")); } catch { const e = new Error("malformed payload"); e.code = "malformed"; throw e; }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now >= payload.exp) { const e = new Error("token expired"); e.code = "expired"; throw e; }
  // aud may be a string or an array.
  const aud = payload.aud;
  const audOk = aud === JWT_AUDIENCE || (Array.isArray(aud) && aud.includes(JWT_AUDIENCE));
  if (aud && !audOk) { const e = new Error(`bad audience ${aud}`); e.code = "bad_audience"; throw e; }

  return payload;
}

// Look the user up in public.admins (automation-matrix). Returns
// { isAdmin, level, isSuperadmin }. Cached per user for ADMIN_CACHE_TTL_MS.
// Throws on transport error (fail-closed — caller treats as not-admin/denied).
export async function resolveAdmin(userId) {
  if (!userId) return { isAdmin: false, level: null, isSuperadmin: false };
  const cached = _adminCache.get(userId);
  if (cached && Date.now() - cached.ts < ADMIN_CACHE_TTL_MS) {
    return { isAdmin: cached.isAdmin, level: cached.level, isSuperadmin: cached.level === "super_admin" };
  }
  const url = `${supabaseUrl()}/rest/v1/admins?user_id=eq.${encodeURIComponent(userId)}&select=user_id,level`;
  const resp = await fetch(url, {
    headers: { apikey: supabaseKey(), Authorization: `Bearer ${supabaseKey()}`, Accept: "application/json" },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`admins lookup failed: HTTP ${resp.status} ${body.slice(0, 120)}`);
  }
  const rows = await resp.json();
  const row = Array.isArray(rows) && rows.length ? rows[0] : null;
  const level = row ? row.level : null;
  const isAdmin = !!row;
  _adminCache.set(userId, { isAdmin, level, ts: Date.now() });
  return { isAdmin, level, isSuperadmin: level === "super_admin" };
}

// Convenience: verify a bearer token as an OAuth admin. Returns
// { ok:true, email, userId, level, isSuperadmin } when it's a valid admin JWT,
// or { ok:false, reason } otherwise. Never throws.
export async function authenticateOAuthAdmin(token) {
  if (!oauthEnabled()) return { ok: false, reason: "disabled" };
  let payload;
  try {
    payload = verifySupabaseJwt(token);
  } catch (e) {
    return { ok: false, reason: e.code || "invalid" };
  }
  const userId = String(payload.sub || "");
  try {
    const a = await resolveAdmin(userId);
    if (!a.isAdmin) return { ok: false, reason: "not_admin", email: payload.email };
    return { ok: true, userId, email: payload.email || "", level: a.level, isSuperadmin: a.isSuperadmin };
  } catch (e) {
    return { ok: false, reason: `lookup_error: ${e.message}` };
  }
}
