// ── Agent Gateway: scoped, expiring tokens for real-infra agent access ──────
//
// This is the "hijack the sandbox mechanism" layer (CONTROL_PLANE_PLAN.md
// Workstream B), done WITHOUT standing up an unauthenticated daemon on the
// host. The Manager itself becomes the authenticated proxy: it mints a
// short-TTL HMAC token scoped to one target (the /srv host or one container),
// and the gateway routes verify that token before running anything. This is
// the same shape the orchestrator uses for sandboxes (public proxy + scoped
// X-Sandbox-Access-Token), so a matrx-ai consumer can be handed the binding
// { base_url, access_token, root_path } and its fs/shell tools work unchanged.
//
// Token format (stateless, compact):  base64url(payload) "." base64url(hmac)
//   payload = { t: target, r: root_path, s: scopes[], iat, exp, jti, lbl }
//   hmac    = HMAC-SHA256(AGENT_GW_SECRET, base64url(payload))
//
// Security:
//   - Disabled unless AGENT_GW_SECRET is set (>= 32 chars). 503 otherwise.
//   - Signature checked with timingSafeEqual; expiry + target match enforced.
//   - jti revocation list (in-memory; rotating the secret revokes everything).
//   - Short default TTL. Every grant + call is audited by the caller.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const MIN_SECRET_LEN = 32;
const DEFAULT_TTL_SECONDS = 3600; // 1h; grant can request less, capped at 12h.
const MAX_TTL_SECONDS = 12 * 3600;

// Scopes a binding can carry — mirrors the orchestrator's sandbox scopes so the
// vocabulary is shared. The gateway currently enforces exec.* ; fs/search are
// reserved for the additive follow-up surface.
export const ALL_SCOPES = ["exec.run", "fs.read", "fs.write", "search", "git"];

// In-memory revocation set (jti -> true). Durable revocation = rotate secret.
const revoked = new Set();

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlJson(obj) {
  return b64url(JSON.stringify(obj));
}
function fromB64urlJson(s) {
  return JSON.parse(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8"));
}

export function gwSecret() {
  const s = process.env.AGENT_GW_SECRET || "";
  return s.length >= MIN_SECRET_LEN ? s : null;
}
export function gwEnabled() {
  return gwSecret() !== null;
}

function sign(payloadPart, secret) {
  return b64url(createHmac("sha256", secret).update(payloadPart).digest());
}

// Parse + validate a target string. Returns { kind, name } or throws.
//   "host"            → the local /srv host (kind=host)
//   "container:NAME"  → a local docker container (kind=container, name=NAME)
export function parseTarget(target) {
  const t = String(target || "").trim();
  if (t === "host") return { kind: "host", name: "host" };
  const m = /^container:([A-Za-z0-9][A-Za-z0-9_.-]*)$/.exec(t);
  if (m) return { kind: "container", name: m[1] };
  throw new Error(`invalid target '${t}' (expected 'host' or 'container:<name>')`);
}

// Mint a scoped token for a target. Returns { access_token, jti, expires_at, payload }.
export function mintAgentToken({ target, rootPath, scopes, ttlSeconds, label } = {}) {
  const secret = gwSecret();
  if (!secret) throw new Error("agent gateway disabled (AGENT_GW_SECRET unset)");
  parseTarget(target); // validate shape; throws on bad input
  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.min(Math.max(Number(ttlSeconds) || DEFAULT_TTL_SECONDS, 60), MAX_TTL_SECONDS);
  const useScopes = Array.isArray(scopes) && scopes.length
    ? scopes.filter((s) => ALL_SCOPES.includes(s))
    : ["exec.run"];
  const payload = {
    t: String(target),
    r: rootPath || (parseTarget(target).kind === "host" ? "/srv" : "/"),
    s: useScopes,
    iat: now,
    exp: now + ttl,
    jti: randomBytes(9).toString("hex"),
    lbl: label || "agent",
  };
  const part = b64urlJson(payload);
  const token = `${part}.${sign(part, secret)}`;
  return { access_token: token, jti: payload.jti, expires_at: new Date(payload.exp * 1000).toISOString(), payload };
}

// Verify a token. Returns the payload, or throws Error with .code set to one of
// "disabled" | "malformed" | "bad_signature" | "expired" | "revoked" | "target_mismatch".
export function verifyAgentToken(token, { requiredTarget } = {}) {
  const secret = gwSecret();
  if (!secret) { const e = new Error("agent gateway disabled"); e.code = "disabled"; throw e; }
  const raw = String(token || "");
  const dot = raw.indexOf(".");
  if (dot <= 0 || dot === raw.length - 1) { const e = new Error("malformed token"); e.code = "malformed"; throw e; }
  const part = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = sign(part, secret);
  // timingSafeEqual requires equal-length buffers; length-check first.
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    const e = new Error("bad signature"); e.code = "bad_signature"; throw e;
  }
  let payload;
  try { payload = fromB64urlJson(part); } catch { const e = new Error("malformed payload"); e.code = "malformed"; throw e; }
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || now >= payload.exp) { const e = new Error("token expired"); e.code = "expired"; throw e; }
  if (payload.jti && revoked.has(payload.jti)) { const e = new Error("token revoked"); e.code = "revoked"; throw e; }
  if (requiredTarget && payload.t !== requiredTarget) {
    const e = new Error(`token not valid for target '${requiredTarget}'`); e.code = "target_mismatch"; throw e;
  }
  return payload;
}

export function revokeJti(jti) {
  if (jti) revoked.add(jti);
}
export function isRevoked(jti) {
  return revoked.has(jti);
}
