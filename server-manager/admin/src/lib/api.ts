// ── API Route Constants ─────────────────────────────────────────────────────
// Single source of truth for all API paths used by this admin UI.
// If a backend route changes, update it here and the whole UI follows.
export const API = {
  HEALTH: "/health",
  SYSTEM: "/api/system",
  ME: "/api/me",
  AUTH_CONFIG: "/api/auth-config",
  INSTANCES: "/api/instances",
  INSTANCE: (name: string) => `/api/instances/${name}`,
  INSTANCE_ENV: (name: string) => `/api/instances/${name}/env`,
  INSTANCE_COMPOSE: (name: string) => `/api/instances/${name}/compose`,
  INSTANCE_BACKUPS: (name: string) => `/api/instances/${name}/backups`,
  INSTANCE_LOGS: (name: string) => `/api/instances/${name}/logs`,
  INSTANCE_BACKUP: (name: string) => `/api/instances/${name}/backup`,
  INSTANCE_ACTION: (name: string, action: string) => `/api/instances/${name}/${action}`,
  SANDBOXES: "/api/sandboxes",
  SANDBOX: (name: string) => `/api/sandboxes/${name}`,
  SANDBOX_LOGS: (name: string) => `/api/sandboxes/${name}/logs`,
  SANDBOX_ACTION: (name: string, action: string) => `/api/sandboxes/${name}/${action}`,
  TOKENS: "/api/tokens",
  TOKEN: (id: string) => `/api/tokens/${id}`,
  SECRETS: "/api/secrets",
  SECRET_ENTRIES: (id: string, reveal = false) => `/api/secrets/entries?id=${encodeURIComponent(id)}${reveal ? "&reveal=1" : ""}`,
  SECRET_BULK: (id: string) => `/api/secrets/bulk?id=${encodeURIComponent(id)}`,
  BUILD_INFO: "/api/build-info",
  BUILD_HISTORY: "/api/build-history",
  REBUILD: "/api/rebuild",
  REBUILD_STALE_ONLY: "/api/rebuild/stale-only",
  REBUILD_STREAM: "/api/rebuild/stream",
  ROLLBACK: "/api/rollback",
  SELF_REBUILD: "/api/self-rebuild",
  SELF_REBUILD_STREAM: "/api/self-rebuild/stream",
  BUILD_CLEANUP: "/api/build-cleanup",
  ORCH_STATUS: "/api/orchestrator-sandboxes-status",
  FLEET_HEALTH: "/api/fleet-health",
  VERSIONS: "/api/versions",
  HOSTS: "/api/hosts",
  HOST_EXEC: (id: string) => `/api/hosts/${encodeURIComponent(id)}/exec`,
  HOST_POWER: (id: string) => `/api/hosts/${encodeURIComponent(id)}/power`,
  LOCAL_EXEC: "/api/hosts/local/exec",
  CONTAINERS: "/api/containers",
  CONTAINER_EXEC: (name: string) => `/api/containers/${encodeURIComponent(name)}/exec`,
  AGENT_GW_STATUS: "/api/agent-gw/status",
  AGENT_GW_GRANT: "/api/agent-gw/grant",
  AGENT_GW_REVOKE: "/api/agent-gw/revoke",
  AGENT_GW_TARGETS: "/api/agent-gw/targets",
  AUDIT: (limit = 200) => `/api/audit?limit=${limit}`,
  SANDBOX_IMAGES_HEALTH: "/api/sandbox-images/health",
  ORCH_RESTART: "/api/orchestrator/restart",
  ORCH_REDEPLOY: "/api/orchestrator/redeploy",
  ORCH_PULL_REDEPLOY: "/api/orchestrator/pull-redeploy",
  ORCH_READY: (target: "hosted" | "ec2" = "hosted", waitMs = 30000) =>
    `/api/orchestrator/ready?target=${target}&wait_ms=${waitMs}`,
  ORCH_LOGS: (since = "24h", tail = 1000, grep = "", format: "text" | "json" = "json") => {
    const params = new URLSearchParams({ since, tail: String(tail), format });
    if (grep) params.set("grep", grep);
    return `/api/orchestrator/logs?${params}`;
  },
  EC2_TRIGGER_DEPLOY: "/api/ec2/trigger-deploy",
  ORCH_BUILD_STREAM: "/api/orchestrator/build/stream",
  SANDBOX_IMAGE_BUILD_STREAM: (variant: string) => `/api/sandbox-images/build/stream?variant=${encodeURIComponent(variant)}`,
  SANDBOX_IMAGES_REBUILD_MISSING_STREAM: (variant?: string) =>
    variant
      ? `/api/sandbox-images/rebuild-missing/stream?variant=${encodeURIComponent(variant)}`
      : `/api/sandbox-images/rebuild-missing/stream`,
  ORCH_SANDBOXES: "/api/orchestrator-sandboxes",
  ORCH_SANDBOXES_BULK_DESTROY: "/api/orchestrator-sandboxes/bulk-destroy",
  ORCH_SANDBOX: (id: string) => `/api/orchestrator-sandboxes/${id}`,
  ORCH_SANDBOX_DIAG: (id: string) => `/api/orchestrator-sandboxes/${id}/diagnostics`,
  ORCH_SANDBOX_LOGS: (id: string, source = "orchestrator", tail = 500) =>
    `/api/orchestrator-sandboxes/${id}/logs?source=${encodeURIComponent(source)}&tail=${tail}`,
  ORCH_SANDBOX_RESET: (id: string, wipeVolume = false) =>
    `/api/orchestrator-sandboxes/${id}/reset?wipe_volume=${wipeVolume ? "true" : "false"}`,
  ORCH_SANDBOX_EXTEND: (id: string) => `/api/orchestrator-sandboxes/${id}/extend`,
  ORCH_SANDBOX_RESUME: (id: string) => `/api/orchestrator-sandboxes/${id}/resume`,
  // Zero-drift migration (matrx-sandbox/docs/ZERO_DRIFT.md). Hyphenated drift /
  // migrate-all paths avoid colliding with ORCH_SANDBOX(id).
  ORCH_SANDBOXES_DRIFT: "/api/orchestrator-sandboxes-drift",
  ORCH_SANDBOXES_MIGRATE_ALL: "/api/orchestrator-sandboxes-migrate-all",
  ORCH_SANDBOX_MIGRATE: (id: string) => `/api/orchestrator-sandboxes/${id}/migrate`,
  ORCH_SANDBOX_STATS: (id: string) => `/api/orchestrator-sandboxes/${id}/stats`,
  // Destroy uses ORCH_SANDBOX(id) with the DELETE method.
  ORCH_SANDBOX_AGENT_ENV: (id: string) =>
    `/api/orchestrator-sandboxes/${id}/agent-env`,
  ORCH_SANDBOX_FS_LIST: (id: string, path: string, depth = 1) =>
    `/api/orchestrator-sandboxes/${id}/fs/list?path=${encodeURIComponent(path)}&depth=${depth}`,
  ORCH_SANDBOX_FS_READ: (id: string, path: string, encoding: "utf8" | "base64" = "utf8") =>
    `/api/orchestrator-sandboxes/${id}/fs/read?path=${encodeURIComponent(path)}&encoding=${encoding}`,
} as const;

// ── Token Management ────────────────────────────────────────────────────────

function getToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("manager_token") || "";
}

export function setToken(token: string) {
  localStorage.setItem("manager_token", token);
}

export function clearToken() {
  localStorage.removeItem("manager_token");
}

// ── API Client ──────────────────────────────────────────────────────────────

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T = Record<string, unknown>>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...opts.headers,
    },
    body: opts.body ? (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body)) : undefined,
  });

  if (res.status === 401) throw new ApiError("Unauthorized", 401);

  // Treat 404 as a clear "not found" error, not an auth failure
  if (res.status === 404) {
    const text = await res.text();
    throw new ApiError(text.includes("Cannot") ? `Route not found: ${path}` : text, 404);
  }

  // Try to parse JSON, but handle non-JSON responses gracefully
  const contentType = res.headers.get("content-type");
  if (!contentType?.includes("application/json")) {
    const text = await res.text();
    // If it's an error status and we got HTML/text instead of JSON, throw a clear error
    if (!res.ok) {
      throw new ApiError(text.includes("Bad Gateway") ? "Service temporarily unavailable (Bad Gateway)" : text, res.status);
    }
    throw new ApiError(`Unexpected response format: ${text}`, res.status);
  }

  const data = await res.json();
  if (!res.ok && data.error) throw new ApiError(data.error, res.status);
  return data as T;
}

export async function apiText(path: string, opts: RequestInit = {}): Promise<string> {
  const token = getToken();
  const res = await fetch(path, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, ...opts.headers },
  });
  if (res.status === 401) throw new ApiError("Unauthorized", 401);
  if (res.status === 404) throw new ApiError(`Route not found: ${path}`, 404);
  return res.text();
}
