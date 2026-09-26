import assert from "node:assert/strict";
import test from "node:test";
import { exchangeOAuthHandoff, parseOAuthCallback, runOAuthCallback, type OAuthCallbackEnvironment } from "./oauth-handoff";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function callbackEnvironment(search: string, fetchImpl: typeof fetch, events: string[]): OAuthCallbackEnvironment {
  return {
    search,
    pathname: "/admin/oauth/callback",
    fetchImpl,
    scrubUrl: (pathname) => events.push(`scrub:${pathname}`),
    removeStoredToken: () => events.push("remove"),
    storeToken: (token) => events.push(`store:${token}`),
    setStatus: (status) => events.push(`status:${status}`),
  };
}

test("refuses every credential-shaped callback parameter", () => {
  for (const name of ["access_token", "token", "refresh_token", "id_token"]) {
    assert.deepEqual(parseOAuthCallback(`?${name}=live-secret&handoff=one-time-code`), { kind: "unsafe-token" });
  }
});

test("accepts a one-time handoff and exchanges it with AI Dream using cookies", async () => {
  let request: RequestInit | undefined;
  let url = "";
  const token = await exchangeOAuthHandoff("https://aidream.example/", "one-time-code", async (input, init) => {
    url = String(input);
    request = init;
    return new Response(JSON.stringify({ access_token: "response-only-token" }), { status: 200 });
  });

  assert.equal(token, "response-only-token");
  assert.equal(url, "https://aidream.example/auth/session/exchange");
  assert.equal(request?.method, "POST");
  assert.equal(request?.credentials, "include");
  assert.equal(request?.body, JSON.stringify({ handoff: "one-time-code" }));
});

test("does not accept a missing or failed exchange token", async () => {
  await assert.rejects(
    () => exchangeOAuthHandoff("https://aidream.example", "expired", async () => new Response("{}", { status: 401 })),
    /handoff_exchange_failed/,
  );
});

test("callback scrubs and rejects a query token before making any network request", async () => {
  const events: string[] = [];
  runOAuthCallback(callbackEnvironment("?access_token=live-secret", async () => {
    events.push("fetch");
    return response({});
  }, events));
  await Promise.resolve();
  assert.deepEqual(events, ["scrub:/admin/oauth/callback", "remove", "status:error"]);
});

test("callback verifies the response-only token before storing it", async () => {
  const events: string[] = [];
  runOAuthCallback(callbackEnvironment("?handoff=one-time-code", async (input, init) => {
    const url = String(input);
    events.push(url === "/api/me" ? `me:${String((init?.headers as Record<string, string>).Authorization)}` : `fetch:${url}`);
    if (url === "/api/auth-config") return response({ aidream_url: "https://aidream.example" });
    if (url.endsWith("/auth/session/exchange")) return response({ access_token: "response-only-token" });
    return response({ authenticated: true });
  }, events));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(events, [
    "scrub:/admin/oauth/callback",
    "fetch:/api/auth-config",
    "fetch:https://aidream.example/auth/session/exchange",
    "me:Bearer response-only-token",
    "store:response-only-token",
    "status:ok",
  ]);
});

test("failed verification and an unmounted callback never store a token", async () => {
  const rejected: string[] = [];
  runOAuthCallback(callbackEnvironment("?handoff=expired", async (input) => {
    if (String(input) === "/api/auth-config") return response({ aidream_url: "https://aidream.example" });
    if (String(input).endsWith("/auth/session/exchange")) return response({ access_token: "unverified" });
    return response({ authenticated: false }, 401);
  }, rejected));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(!rejected.some((event) => event.startsWith("store:")));
  assert.ok(rejected.includes("remove"));

  const unmounted: string[] = [];
  let resolveExchange!: (value: Response) => void;
  const cleanup = runOAuthCallback(callbackEnvironment("?handoff=late", async (input) => {
    if (String(input) === "/api/auth-config") return response({ aidream_url: "https://aidream.example" });
    return new Promise<Response>((resolve) => { resolveExchange = resolve; });
  }, unmounted));
  await new Promise((resolve) => setTimeout(resolve, 0));
  cleanup();
  resolveExchange(response({ access_token: "late-token" }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(!unmounted.some((event) => event.startsWith("store:")));
});
