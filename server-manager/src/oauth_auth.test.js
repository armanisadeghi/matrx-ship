import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import { authenticateOAuthAdmin, verifySupabaseJwt } from "./oauth_auth.js";

const originalFetch = globalThis.fetch;
const originalEnv = {
  url: process.env.SUPABASE_MATRIX_URL,
  key: process.env.SUPABASE_MATRIX_KEY,
  secret: process.env.SUPABASE_MATRIX_JWT_SECRET,
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  restoreEnv("SUPABASE_MATRIX_URL", originalEnv.url);
  restoreEnv("SUPABASE_MATRIX_KEY", originalEnv.key);
  restoreEnv("SUPABASE_MATRIX_JWT_SECRET", originalEnv.secret);
});

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function es256Token(privateKey, kid, payload) {
  const input = `${encode({ alg: "ES256", typ: "JWT", kid })}.${encode(payload)}`;
  const signature = sign("sha256", Buffer.from(input), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${input}.${signature.toString("base64url")}`;
}

function hs256Token(secret, payload) {
  const input = `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}`;
  const signature = createHmac("sha256", secret).update(input).digest("base64url");
  return `${input}.${signature}`;
}

function claims(url, sub = "user-1") {
  return {
    sub,
    email: `${sub}@example.com`,
    aud: "authenticated",
    iss: `${url}/auth/v1`,
    exp: Math.floor(Date.now() / 1000) + 300,
  };
}

function publicJwk(publicKey, kid) {
  return { ...publicKey.export({ format: "jwk" }), alg: "ES256", kid, use: "sig" };
}

test("accepts current Supabase ES256 tokens and resolves the admin", async () => {
  const url = "https://es256-test.supabase.co";
  process.env.SUPABASE_MATRIX_URL = url;
  process.env.SUPABASE_MATRIX_KEY = "test-service-key";
  delete process.env.SUPABASE_MATRIX_JWT_SECRET;

  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const token = es256Token(privateKey, "current-key", claims(url));
  let jwksRequests = 0;
  globalThis.fetch = async (requestUrl) => {
    const target = String(requestUrl);
    if (target.endsWith("/.well-known/jwks.json")) {
      jwksRequests += 1;
      return Response.json({ keys: [publicJwk(publicKey, "current-key")] });
    }
    if (target.includes("/rest/v1/admins?")) {
      return Response.json([{ user_id: "user-1", level: "super_admin" }]);
    }
    throw new Error(`unexpected URL: ${target}`);
  };

  const payload = await verifySupabaseJwt(token);
  assert.equal(payload.sub, "user-1");
  const result = await authenticateOAuthAdmin(token);
  assert.equal(result.ok, true);
  assert.equal(result.isSuperadmin, true);
  assert.equal(jwksRequests, 1, "JWKS should be cached between verifications");
});

test("refreshes a valid JWKS cache immediately when Supabase rotates kid", async () => {
  const url = "https://rotation-test.supabase.co";
  process.env.SUPABASE_MATRIX_URL = url;
  process.env.SUPABASE_MATRIX_KEY = "test-service-key";
  delete process.env.SUPABASE_MATRIX_JWT_SECRET;

  const oldPair = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const newPair = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const oldToken = es256Token(oldPair.privateKey, "old-key", claims(url, "old-user"));
  const newToken = es256Token(newPair.privateKey, "new-key", claims(url, "new-user"));
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    const key = requests === 1
      ? publicJwk(oldPair.publicKey, "old-key")
      : publicJwk(newPair.publicKey, "new-key");
    return Response.json({ keys: [key] });
  };

  assert.equal((await verifySupabaseJwt(oldToken)).sub, "old-user");
  assert.equal((await verifySupabaseJwt(newToken)).sub, "new-user");
  assert.equal(requests, 2);
});

test("rejects an ES256 token whose signature does not match the advertised key", async () => {
  const url = "https://bad-signature-test.supabase.co";
  process.env.SUPABASE_MATRIX_URL = url;
  process.env.SUPABASE_MATRIX_KEY = "test-service-key";
  delete process.env.SUPABASE_MATRIX_JWT_SECRET;

  const trusted = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const attacker = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const token = es256Token(attacker.privateKey, "trusted-key", claims(url));
  globalThis.fetch = async () => Response.json({
    keys: [publicJwk(trusted.publicKey, "trusted-key")],
  });

  await assert.rejects(
    verifySupabaseJwt(token),
    (error) => error?.code === "bad_signature",
  );
});

test("keeps legacy HS256 verification working when a secret is configured", async () => {
  const url = "https://legacy-test.supabase.co";
  const secret = "legacy-secret";
  process.env.SUPABASE_MATRIX_URL = url;
  process.env.SUPABASE_MATRIX_KEY = "test-service-key";
  process.env.SUPABASE_MATRIX_JWT_SECRET = secret;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error("HS256 verification must not fetch JWKS");
  };

  const payload = await verifySupabaseJwt(hs256Token(secret, claims(url, "legacy-user")));
  assert.equal(payload.sub, "legacy-user");
  assert.equal(fetchCalled, false);
});
