/**
 * Auto-capture environment information from the browser.
 */
export function captureEnvironment(): {
  browserInfo: string;
  osInfo: string;
  route: string;
} {
  if (typeof window === "undefined") {
    return { browserInfo: "server", osInfo: "server", route: "/" };
  }

  const ua = navigator.userAgent;
  const platform = navigator.platform ?? "unknown";

  // Simple browser detection
  let browser = "unknown";
  if (ua.includes("Chrome") && !ua.includes("Edg")) browser = "Chrome";
  else if (ua.includes("Safari") && !ua.includes("Chrome")) browser = "Safari";
  else if (ua.includes("Firefox")) browser = "Firefox";
  else if (ua.includes("Edg")) browser = "Edge";

  // Simple OS detection
  let os = platform;
  if (ua.includes("Windows")) os = "Windows";
  else if (ua.includes("Mac")) os = "macOS";
  else if (ua.includes("Linux")) os = "Linux";
  else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS";
  else if (ua.includes("Android")) os = "Android";

  return {
    browserInfo: `${browser} (${ua.slice(0, 100)})`,
    osInfo: os,
    route: window.location.pathname,
  };
}

/**
 * Generate an idempotent client reference ID.
 */
export function generateClientRefId(): string {
  return `tw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Make an API call to the Matrx Ship instance.
 */
export async function apiCall<T>(
  baseUrl: string,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    reporterToken?: string;
  } = {},
): Promise<T> {
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (options.reporterToken) {
    headers["X-Reporter-Token"] = options.reporterToken;
  }

  const res = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(errData.error ?? `HTTP ${res.status}`);
  }

  return res.json();
}
