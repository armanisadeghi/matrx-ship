/**
 * Supabase Persistence Layer for Matrx Server Manager
 * ====================================================
 * Dual-write: every state change writes to local JSON AND Supabase.
 * Supabase is the backup store — local JSON is the primary runtime source.
 * If Supabase is unavailable, the system keeps working from local files.
 *
 * Env vars:
 *   SUPABASE_URL         — Supabase project URL
 *   SUPABASE_SERVICE_KEY  — Service role key (full access, server-side only)
 */

import { hostname } from "node:os";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const DOMAIN_SUFFIX = "dev.codematrx.com";

let serverId = null;

/**
 * Check if Supabase is configured
 */
export function isSupabaseConfigured() {
  return !!(SUPABASE_URL && SUPABASE_KEY);
}

/**
 * Make a Supabase REST API call (PostgREST)
 */
async function supabaseRequest(path, opts = {}) {
  if (!isSupabaseConfigured()) return null;

  try {
    const url = `${SUPABASE_URL}/rest/v1/${path}`;
    const response = await fetch(url, {
      ...opts,
      headers: {
        apikey: SUPABASE_KEY,
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
    console.error(`Supabase request failed [${path}]:`, err.message);
    return null;
  }
}

// ── Server Registration ─────────────────────────────────────────────────────

/**
 * Ensure this server is registered in infra_servers.
 * Returns the server ID (UUID) to use as FK in other tables.
 */
export async function ensureServerRegistered() {
  if (!isSupabaseConfigured()) return null;

  const host = hostname();
  const ip = process.env.SERVER_IP || "unknown";

  // Check if already registered
  const existing = await supabaseRequest(
    `infra_servers?hostname=eq.${encodeURIComponent(host)}&limit=1`,
    { method: "GET" }
  );

  if (existing && existing.length > 0) {
    serverId = existing[0].id;
    // Update heartbeat
    await supabaseRequest(`infra_servers?id=eq.${serverId}`, {
      method: "PATCH",
      body: JSON.stringify({
        last_heartbeat: new Date().toISOString(),
        status: "active",
      }),
    });
    console.log(`Supabase: server registered (id: ${serverId})`);
    return serverId;
  }

  // Register new server
  const result = await supabaseRequest("infra_servers", {
    method: "POST",
    body: JSON.stringify({
      hostname: host,
      ip,
      domain_suffix: DOMAIN_SUFFIX,
      ssh_port: 22,
      status: "active",
      last_heartbeat: new Date().toISOString(),
    }),
  });

  if (result && result.length > 0) {
    serverId = result[0].id;
    console.log(`Supabase: new server registered (id: ${serverId})`);
    return serverId;
  }

  console.error("Supabase: failed to register server");
  return null;
}

export function getServerId() {
  return serverId;
}

// ── Instance Sync ───────────────────────────────────────────────────────────

/**
 * Sync a single instance to Supabase (upsert by server_id + name).
 */
export async function syncInstance(name, instanceData) {
  if (!serverId) return;

  await supabaseRequest("infra_instances", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      server_id: serverId,
      name,
      display_name: instanceData.display_name || name,
      subdomain: instanceData.subdomain || name,
      image: instanceData.image || "matrx-ship:latest",
      status: instanceData.status || "unknown",
      api_key: instanceData.api_key || null,
      admin_secret: instanceData.admin_secret || null,
      postgres_password: instanceData.db_password || null,
      postgres_image: instanceData.postgres_image || "postgres:17-alpine",
      env_vars: instanceData.env_vars || null,
      updated_at: new Date().toISOString(),
    }),
  });
}

/**
 * Sync all instances from local deployments.json to Supabase.
 */
export async function syncAllInstances(deploymentsConfig) {
  if (!serverId) return;

  const instances = deploymentsConfig.instances || {};
  for (const [name, data] of Object.entries(instances)) {
    await syncInstance(name, data);
  }
  console.log(`Supabase: synced ${Object.keys(instances).length} instances`);
}

/**
 * Remove an instance from Supabase.
 */
export async function removeInstanceFromSupabase(name) {
  if (!serverId) return;

  await supabaseRequest(
    `infra_instances?server_id=eq.${serverId}&name=eq.${encodeURIComponent(name)}`,
    { method: "DELETE" }
  );
}

/**
 * Pull all instances from Supabase (for restore).
 */
export async function pullInstancesFromSupabase() {
  if (!serverId) return null;

  const result = await supabaseRequest(
    `infra_instances?server_id=eq.${serverId}&order=name.asc`,
    { method: "GET" }
  );

  if (!result) return null;

  // Convert to deployments.json format
  const instances = {};
  for (const row of result) {
    instances[row.name] = {
      display_name: row.display_name,
      subdomain: row.subdomain,
      url: `https://${row.subdomain}.${DOMAIN_SUFFIX}`,
      api_key: row.api_key,
      db_password: row.postgres_password,
      postgres_image: row.postgres_image,
      created_at: row.created_at,
      status: row.status,
    };
  }
  return instances;
}

// ── Token Sync ──────────────────────────────────────────────────────────────

/**
 * Sync all tokens to Supabase.
 */
export async function syncAllTokens(tokenStore) {
  if (!serverId) return;

  for (const token of tokenStore.tokens || []) {
    await supabaseRequest("infra_tokens", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({
        server_id: serverId,
        token_hash: token.token_hash,
        label: token.label,
        role: token.role,
        created_at: token.created_at,
        last_used_at: token.last_used_at,
      }),
    });
  }
  console.log(`Supabase: synced ${tokenStore.tokens?.length || 0} tokens`);
}

/**
 * Pull tokens from Supabase (for restore).
 */
export async function pullTokensFromSupabase() {
  if (!serverId) return null;

  const result = await supabaseRequest(
    `infra_tokens?server_id=eq.${serverId}&order=created_at.asc`,
    { method: "GET" }
  );

  if (!result) return null;
  return {
    tokens: result.map((row) => ({
      id: row.id,
      token_hash: row.token_hash,
      label: row.label,
      role: row.role,
      created_at: row.created_at,
      last_used_at: row.last_used_at,
    })),
  };
}

// ── Build History Sync ──────────────────────────────────────────────────────

/**
 * Record a build in Supabase.
 */
export async function recordBuildInSupabase(buildEntry) {
  if (!serverId) return;

  await supabaseRequest("infra_builds", {
    method: "POST",
    body: JSON.stringify({
      server_id: serverId,
      tag: buildEntry.tag,
      git_commit: buildEntry.git_commit,
      git_message: buildEntry.git_message,
      image_id: buildEntry.image_id,
      status: buildEntry.success ? "success" : "failed",
      duration_ms: buildEntry.duration_ms,
      triggered_by: buildEntry.triggered_by,
      instances_restarted: buildEntry.instances_restarted,
      error: buildEntry.error,
      started_at: buildEntry.timestamp,
      finished_at: new Date().toISOString(),
    }),
  });
}

/**
 * Pull build history from Supabase (for restore).
 */
export async function pullBuildsFromSupabase(limit = 100) {
  if (!serverId) return null;

  const result = await supabaseRequest(
    `infra_builds?server_id=eq.${serverId}&order=started_at.desc&limit=${limit}`,
    { method: "GET" }
  );

  if (!result) return null;
  return {
    builds: result.map((row) => ({
      id: row.id,
      tag: row.tag,
      timestamp: row.started_at,
      git_commit: row.git_commit,
      git_message: row.git_message,
      image_id: row.image_id,
      success: row.status === "success",
      error: row.error,
      duration_ms: row.duration_ms,
      triggered_by: row.triggered_by,
      instances_restarted: row.instances_restarted || [],
    })),
  };
}

// ── Backup Registry ─────────────────────────────────────────────────────────

/**
 * Record a backup in Supabase.
 */
export async function recordBackupInSupabase(backup) {
  if (!serverId) return;

  await supabaseRequest("infra_backups", {
    method: "POST",
    body: JSON.stringify({
      server_id: serverId,
      instance_name: backup.instance_name,
      backup_type: backup.type,
      s3_key: backup.s3_key,
      size_bytes: backup.size_bytes,
      metadata: backup.metadata || null,
    }),
  });
}

// ── Audit Log ───────────────────────────────────────────────────────────────

/**
 * Log an action to the audit trail.
 */
export async function auditLog(actor, action, target, details = null) {
  if (!serverId) return;

  // Fire and forget — audit logging should never block the main operation
  supabaseRequest("infra_audit_log", {
    method: "POST",
    body: JSON.stringify({
      server_id: serverId,
      actor,
      action,
      target,
      details,
    }),
  }).catch((err) => console.error("Audit log failed:", err.message));
}

// ── Full Sync ───────────────────────────────────────────────────────────────

/**
 * Push ALL local state to Supabase.
 * Called on startup and via the /api/supabase/sync endpoint.
 */
export async function fullSync(deploymentsConfig, tokenStore, buildHistory) {
  if (!isSupabaseConfigured()) {
    console.log("Supabase: not configured, skipping sync");
    return { synced: false, reason: "not_configured" };
  }

  await ensureServerRegistered();

  if (!serverId) {
    return { synced: false, reason: "server_registration_failed" };
  }

  await syncAllInstances(deploymentsConfig);
  await syncAllTokens(tokenStore);

  // Sync recent builds (last 50)
  for (const build of (buildHistory.builds || []).slice(0, 50)) {
    await recordBuildInSupabase(build);
  }

  await auditLog("system", "full_sync", "all", {
    instances: Object.keys(deploymentsConfig.instances || {}).length,
    tokens: (tokenStore.tokens || []).length,
    builds: (buildHistory.builds || []).length,
  });

  return { synced: true, server_id: serverId };
}

/**
 * Pull ALL state from Supabase (for disaster recovery).
 */
export async function fullRestore() {
  if (!isSupabaseConfigured()) {
    return { restored: false, reason: "not_configured" };
  }

  await ensureServerRegistered();
  if (!serverId) {
    return { restored: false, reason: "server_registration_failed" };
  }

  const instances = await pullInstancesFromSupabase();
  const tokens = await pullTokensFromSupabase();
  const builds = await pullBuildsFromSupabase();

  await auditLog("system", "full_restore", "all", {
    instances: instances ? Object.keys(instances).length : 0,
    tokens: tokens?.tokens?.length || 0,
    builds: builds?.builds?.length || 0,
  });

  return {
    restored: true,
    server_id: serverId,
    instances,
    tokens,
    builds,
  };
}
