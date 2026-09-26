export const TOKEN_QUERY_PARAMETERS = ["access_token", "token", "refresh_token", "id_token"] as const;

export type OAuthCallbackInput =
  | { kind: "unsafe-token" }
  | { kind: "error" }
  | { kind: "handoff"; handoff: string }
  | { kind: "missing" };

/**
 * OAuth credentials must never arrive in a URL. The broker gives this app a
 * one-time handoff code instead, which is exchanged directly with AI Dream.
 */
export function parseOAuthCallback(search: string): OAuthCallbackInput {
  const params = new URLSearchParams(search);
  if (TOKEN_QUERY_PARAMETERS.some((name) => params.has(name))) return { kind: "unsafe-token" };
  if (params.has("error")) return { kind: "error" };
  const handoff = params.get("handoff")?.trim();
  return handoff ? { kind: "handoff", handoff } : { kind: "missing" };
}

type FetchLike = typeof fetch;

export interface OAuthCallbackEnvironment {
  search: string;
  pathname: string;
  scrubUrl: (pathname: string) => void;
  removeStoredToken: () => void;
  storeToken: (token: string) => void;
  setStatus: (status: "ok" | "error", message?: string) => void;
  fetchImpl?: FetchLike;
}

/** Exchanges a one-time AI Dream handoff without ever reading credentials from the URL. */
export async function exchangeOAuthHandoff(
  aidreamUrl: string,
  handoff: string,
  fetchImpl: FetchLike = fetch,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetchImpl(`${aidreamUrl.replace(/\/$/, "")}/auth/session/exchange`, {
    method: "POST",
    credentials: "include",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ handoff }),
  });
  const body = await response.json().catch(() => ({})) as { access_token?: unknown };
  if (!response.ok || typeof body.access_token !== "string" || !body.access_token.trim()) {
    throw new Error("handoff_exchange_failed");
  }
  return body.access_token;
}

/**
 * Runs the client-side callback transaction. Its cleanup aborts every request
 * and prevents an obsolete callback from writing a newer browser session.
 */
export function runOAuthCallback(environment: OAuthCallbackEnvironment): () => void {
  const callback = parseOAuthCallback(environment.search);
  const fetchImpl = environment.fetchImpl ?? fetch;
  const controller = new AbortController();
  let cancelled = false;

  // Always scrub first, including malformed and rejected callback URLs.
  environment.scrubUrl(environment.pathname);

  if (callback.kind === "unsafe-token") {
    environment.removeStoredToken();
    environment.setStatus("error", "This sign-in link used an unsafe credential parameter. Please sign in again.");
    return () => {};
  }
  if (callback.kind === "error") {
    environment.setStatus("error", "Sign in could not be completed. Please try again.");
    return () => {};
  }
  if (callback.kind === "missing") {
    environment.setStatus("error", "No sign-in handoff was received.");
    return () => {};
  }

  void (async () => {
    try {
      const configResponse = await fetchImpl("/api/auth-config", { signal: controller.signal });
      const config = await configResponse.json().catch(() => ({})) as { aidream_url?: unknown };
      if (!configResponse.ok || typeof config.aidream_url !== "string" || !config.aidream_url.trim()) {
        throw new Error("missing_aidream_url");
      }
      const token = await exchangeOAuthHandoff(config.aidream_url, callback.handoff, fetchImpl, controller.signal);
      const response = await fetchImpl("/api/me", {
        signal: controller.signal,
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json().catch(() => ({})) as { authenticated?: boolean; error?: string };
      if (!response.ok || !body.authenticated) throw new Error("manager_session_rejected");
      if (cancelled) return;
      environment.storeToken(token);
      environment.setStatus("ok");
    } catch {
      if (cancelled || controller.signal.aborted) return;
      environment.removeStoredToken();
      environment.setStatus("error", "Unable to complete sign in. The handoff may have expired; please try again.");
    }
  })();

  return () => {
    cancelled = true;
    controller.abort();
  };
}
