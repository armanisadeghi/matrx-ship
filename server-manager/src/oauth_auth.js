// ── OAuth admin auth: AI Matrx (Supabase) JWT verification + admin gate ──────
//
// Mirrors how the AIDREAM dashboards authenticate. The browser logs in through
// aidream's OAuth broker (GET {AIDREAM_API_URL}/auth/aimatrx?app_redirect=…),
// which runs PKCE against aimatrx.com, checks public.admins, and only then
// redirects back with ?access_token=<Supabase JWT>. So:
//
//   * The ADMIN gate is enforced at login by aidream — non-admins never get a
//     token. We STILL re-verify here: a Bearer Supabase JWT is accepted only if
//     (a) its signature checks out against the project's Supabase JWKS (ES256 /
//         RS256), or the legacy HS256 secret while old tokens are still in use,
//     (b) it isn't expired and has aud "authenticated", and
//     (c) the subject is present in public.admins.
//   * The SUPERADMIN gate is the admins.level column == "super_admin".
//
// Verification uses node:crypto — no JWT dependency. Supabase's asymmetric
// signing keys are discovered from /auth/v1/.well-known/jwks.json and cached
// briefly, with an immediate refresh on an unknown kid so key rotation does not
// interrupt logins. The admins lookup hits the automation-matrix Supabase
// PostgREST with the service key, cached briefly per user.
//
// Disabled unless SUPABASE_MATRIX_URL and SUPABASE_MATRIX_KEY are set. The
// legacy SUPABASE_MATRIX_JWT_SECRET is optional and is used only for HS256.

import { createHmac, createPublicKey, timingSafeEqual, verify as verifySignature } from "node:crypto";

const JWT_AUDIENCE = "authenticated";
const ADMIN_CACHE_TTL_MS = 60_000;
const JWKS_CACHE_TTL_MS = 10 * 60_000;
const JWKS_FORCED_REFRESH_MIN_INTERVAL_MS = 30_000;

// userId -> { level, isAdmin, ts }
const _adminCache = new Map();
let _jwksCache = { url: "", keys: [], ts: 0 };
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

export function oauthEnabled() {
  return !!(supabaseUrl() && supabaseKey());
}

function b64urlDecode(s) {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function codedError(message, code) {
  return Object.assign(new Error(message), { code });
}

async function fetchJwks(url) {
  const resp = await fetch(url, { headers: { Accept: "application/json" } });
  if (!resp.ok) throw codedError(`JWKS request failed: HTTP ${resp.status}`, "jwks_unavailable");
  const body = await resp.json();
  if (!Array.isArray(body?.keys)) throw codedError("JWKS response has no keys", "jwks_invalid");
  _jwksCache = { url, keys: body.keys, ts: Date.now() };
  return body.keys;
}

async function findJwk(kid, alg) {
  if (!kid) throw codedError("asymmetric JWT is missing kid", "missing_kid");
  const url = `${supabaseUrl()}/auth/v1/.well-known/jwks.json`;
  const cacheValid = _jwksCache.url === url && Date.now() - _jwksCache.ts < JWKS_CACHE_TTL_MS;
  let keys = cacheValid ? _jwksCache.keys : await fetchJwks(url);
  let key = keys.find((candidate) => candidate?.kid === kid && candidate?.alg === alg);
  // A valid cache can still be stale during signing-key rotation. Refresh once
  // immediately when the requested kid is absent instead of failing for 10m.
  if (!key && cacheValid && Date.now() - _lastForcedJwksRefresh >= JWKS_FORCED_REFRESH_MIN_INTERVAL_MS) {
    _lastForcedJwksRefresh = Date.now();
    keys = await fetchJwks(url);
    key = keys.find((candidate) => candidate?.kid === kid && candidate?.alg === alg);
  }
  if (!key) throw codedError(`no ${alg} signing key found for kid ${kid}`, "unknown_kid");
  return key;
}

// Verify a Supabase JWT. Modern projects use an asymmetric key advertised by
// JWKS; HS256 remains accepted only when the legacy secret is configured.
// Returns the payload, or throws Error with a stable .code.
export async function verifySupabaseJwt(token) {
  if (!supabaseUrl()) throw codedError("oauth disabled", "disabled");
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw codedError("malformed jwt", "malformed");
  const [h, p, sig] = parts;

  let header;
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
    const jwk = await findJwk(String(header.kid || ""), header.alg);
    const key = createPublicKey({ key: jwk, format: "jwk" });
    const keyOptions = header.alg === "ES256" ? { key, dsaEncoding: "ieee-p1363" } : key;
    signatureOk = verifySignature("sha256", signingInput, keyOptions, signature);
  } else {
    throw codedError(`unsupported alg ${header.alg}`, "bad_alg");
  }
  if (!signatureOk) throw codedError("bad signature", "bad_signature");

  let payload;
  try { payload = JSON.parse(b64urlDecode(p).toString("utf-8")); }
  catch { throw codedError("malformed payload", "malformed"); }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now >= payload.exp) throw codedError("token expired", "expired");
  if (payload.nbf && now < payload.nbf) throw codedError("token not active yet", "not_active");
  // aud may be a string or an array.
  const aud = payload.aud;
  const audOk = aud === JWT_AUDIENCE || (Array.isArray(aud) && aud.includes(JWT_AUDIENCE));
  if (aud && !audOk) throw codedError(`bad audience ${aud}`, "bad_audience");
  const expectedIssuer = `${supabaseUrl()}/auth/v1`;
  if (payload.iss && payload.iss.replace(/\/$/, "") !== expectedIssuer) {
    throw codedError(`bad issuer ${payload.iss}`, "bad_issuer");
  }

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
    payload = await verifySupabaseJwt(token);
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
