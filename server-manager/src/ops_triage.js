/**
 * Fleet Health → AI Dream ops-triage bridge
 * =========================================
 * The operator lives in the AI Dream admin dashboard (ops-triage), not the
 * Manager UI — infra problems that only show in the Manager go unseen (the
 * dedicated aidream server crashlooped for 3 DAYS in July 2026 with zero
 * visibility). This module mirrors Fleet Health findings into the same
 * `ops_issue_class` / `ops_issue_event` tables aidream's own startup
 * env-validation writes to, so fleet problems surface in the one dashboard
 * that's actually watched.
 *
 * Contract per check (id, label, status, detail):
 *   critical/warning → upsert class `fleet:<id>` (is_active=true, severity
 *     critical/medium) + ONE event on the transition into the bad state
 *     (not per sweep — a 5-min sweep would spam 288 events/day).
 *   ok → resolve the class (is_active=false + resolution note).
 *   unknown → leave untouched (no data ≠ recovered).
 *
 * Env: MATRX_OPS_SUPABASE_URL / MATRX_OPS_SUPABASE_KEY (service-role key for
 * the Matrx Main project — the one holding ops_issue_class). Falls back to
 * SUPABASE_URL / SUPABASE_SERVICE_KEY. Unset → the bridge is a silent no-op.
 *
 * ops_issue_event.organization_id is NOT NULL with no default; the Manager
 * has no org concept, so we borrow the org id from the most recent existing
 * ops event (the system org aidream writes with) and skip events (classes
 * only) until one exists.
 */

const OPS_URL = process.env.MATRX_OPS_SUPABASE_URL || process.env.SUPABASE_URL;
const OPS_KEY = process.env.MATRX_OPS_SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY;

export function opsConfigured() {
  return !!(OPS_URL && OPS_KEY);
}

async function opsRequest(path, opts = {}) {
  if (!opsConfigured()) return null;
  try {
    const response = await fetch(`${OPS_URL}/rest/v1/${path}`, {
      ...opts,
      headers: {
        apikey: OPS_KEY,
        Authorization: `Bearer ${OPS_KEY}`,
        "Content-Type": "application/json",
        Prefer: opts.prefer || "return=representation",
        ...opts.headers,
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      console.error(`ops-triage error [${response.status}] ${path}:`, (await response.text()).slice(0, 300));
      return null;
    }
    const text = await response.text();
    return text ? JSON.parse(text) : [];
  } catch (err) {
    console.error(`ops-triage request failed [${path}]:`, err.message);
    return null;
  }
}

let _cachedOrgId; // undefined = not looked up yet; null = none available

async function defaultOrgId() {
  if (_cachedOrgId !== undefined) return _cachedOrgId;
  const rows = await opsRequest("ops_issue_event?select=organization_id&order=created_at.desc&limit=1");
  _cachedOrgId = rows && rows[0] ? rows[0].organization_id : null;
  return _cachedOrgId;
}

const SEVERITY = { critical: "critical", warning: "medium" };

async function reportIssue(check) {
  const key = `fleet:${check.id}`;
  const now = new Date().toISOString();
  const severity = SEVERITY[check.status] || "medium";
  const description = String(check.detail || "").slice(0, 800);

  const rows = await opsRequest(`ops_issue_class?key=eq.${encodeURIComponent(key)}&select=id,is_active`);
  if (rows === null) return; // request failed — logged already
  let cls = rows[0];
  let transitioned = false;

  if (!cls) {
    const ins = await opsRequest("ops_issue_class", {
      method: "POST",
      body: JSON.stringify({
        key,
        name: `Fleet: ${check.label}`,
        category: "infrastructure",
        severity,
        disposition: "monitor",
        is_active: true,
        description,
      }),
    });
    cls = ins && ins[0];
    transitioned = true;
  } else {
    transitioned = !cls.is_active;
    await opsRequest(`ops_issue_class?id=eq.${cls.id}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: JSON.stringify({ is_active: true, severity, description, updated_at: now }),
    });
  }

  if (cls && transitioned) {
    const orgId = await defaultOrgId();
    if (orgId) {
      await opsRequest("ops_issue_event", {
        method: "POST",
        prefer: "return=minimal",
        body: JSON.stringify({
          issue_class_id: cls.id,
          organization_id: orgId,
          error_type: `fleet_${check.status}`,
          occurred_at: now,
          detail: { check: check.id, label: check.label, status: check.status, detail: check.detail, source: "matrx-manager" },
          is_retryable: false,
          was_recovered: false,
          retry_count: 0,
        }),
      });
    }
  }
}

async function resolveIssue(check) {
  const key = `fleet:${check.id}`;
  const rows = await opsRequest(`ops_issue_class?key=eq.${encodeURIComponent(key)}&is_active=eq.true&select=id`);
  if (!rows || !rows[0]) return;
  await opsRequest(`ops_issue_class?id=eq.${rows[0].id}`, {
    method: "PATCH",
    prefer: "return=minimal",
    body: JSON.stringify({
      is_active: false,
      resolution_notes: `auto-resolved ${new Date().toISOString()} — fleet-health check back to ok`,
      updated_at: new Date().toISOString(),
    }),
  });
}

/**
 * Mirror one fleet-health snapshot into ops-triage. Never throws.
 */
export async function syncFleetIssuesToOps(checks) {
  if (!opsConfigured()) return { skipped: "ops supabase not configured (set MATRX_OPS_SUPABASE_URL/_KEY)" };
  let reported = 0, resolved = 0;
  for (const check of checks || []) {
    try {
      if (check.status === "critical" || check.status === "warning") {
        await reportIssue(check); reported++;
      } else if (check.status === "ok") {
        await resolveIssue(check); resolved++;
      } // unknown → leave as-is: no data is not the same as recovered
    } catch (err) {
      console.error(`ops-triage sync failed for check '${check.id}':`, err.message);
    }
  }
  return { reported, resolved };
}
