/**
 * Supabase Persistence Layer for Deploy Server
 * ==============================================
 * Records build history and audit events to Supabase for persistence.
 * The deploy server is lighter-weight than the manager — it primarily
 * records builds and audit events rather than managing instance state.
 *
 * Env vars:
 *   SUPABASE_URL         — Supabase project URL
 *   SUPABASE_SERVICE_KEY  — Service role key
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

let serverId: string | null = null;

export function isSupabaseConfigured(): boolean {
  return !!(SUPABASE_URL && SUPABASE_KEY);
}

async function supabaseRequest(
  path: string,
  opts: RequestInit & { prefer?: string; headers?: Record<string, string> } = {},
): Promise<unknown[] | null> {
  if (!isSupabaseConfigured()) return null;

  try {
    const url = `${SUPABASE_URL}/rest/v1/${path}`;
    const response = await fetch(url, {
      ...opts,
      headers: {
        apikey: SUPABASE_KEY!,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: opts.prefer || "return=representation",
        ...opts.headers,
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Supabase error [${response.status}] ${path}:`, errText);
      return null;
    }

    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch (err) {
    console.error(`Supabase request failed [${path}]:`, (err as Error).message);
    return null;
  }
}

/**
 * Resolve the server ID from Supabase. Uses hostname matching.
 */
export async function ensureServerRegistered(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  if (serverId) return serverId;

  // The deploy server doesn't know its hostname the same way,
  // so we look up the server by domain_suffix
  const result = await supabaseRequest(
    `infra_servers?domain_suffix=eq.dev.codematrx.com&limit=1`,
    { method: "GET" },
  );

  if (result && (result as { id: string }[]).length > 0) {
    serverId = (result as { id: string }[])[0].id;
    return serverId;
  }

  return null;
}

/**
 * Record a build event in Supabase.
 */
export async function recordBuildInSupabase(buildEntry: {
  tag: string;
  git_commit?: string;
  git_message?: string;
  image_id?: string | null;
  success: boolean;
  error?: string | null;
  duration_ms?: number;
  triggered_by?: string;
  instances_restarted?: string[];
  timestamp?: string;
}): Promise<void> {
  await ensureServerRegistered();
  if (!serverId) return;

  await supabaseRequest("infra_builds", {
    method: "POST",
    body: JSON.stringify({
      server_id: serverId,
      tag: buildEntry.tag,
      git_commit: buildEntry.git_commit || null,
      git_message: buildEntry.git_message || null,
      image_id: buildEntry.image_id || null,
      status: buildEntry.success ? "success" : "failed",
      duration_ms: buildEntry.duration_ms || null,
      triggered_by: buildEntry.triggered_by || "deploy-app",
      instances_restarted: buildEntry.instances_restarted || [],
      error: buildEntry.error || null,
      started_at: buildEntry.timestamp || new Date().toISOString(),
      finished_at: new Date().toISOString(),
    }),
  });
}

/**
 * Log an action to the audit trail.
 */
export async function auditLog(
  actor: string,
  action: string,
  target: string | null,
  details: Record<string, unknown> | null = null,
): Promise<void> {
  await ensureServerRegistered();
  if (!serverId) return;

  supabaseRequest("infra_audit_log", {
    method: "POST",
    body: JSON.stringify({
      server_id: serverId,
      actor,
      action,
      target,
      details,
    }),
  }).catch((err) => console.error("Audit log failed:", (err as Error).message));
}

/**
 * Get Supabase connection status for the UI.
 */
export function getSupabaseStatus(): {
  configured: boolean;
  server_id: string | null;
} {
  return {
    configured: isSupabaseConfigured(),
    server_id: serverId,
  };
}
