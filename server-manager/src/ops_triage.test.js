import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  FleetOpsOrganizationUnconfiguredError,
  OpsSupabaseUnconfiguredError,
  opsConfigured,
  resolveFleetOpsOrganizationIdOrRaise,
  resolveOpsSupabaseOrRaise,
  syncFleetIssuesToOps,
} from "./ops_triage.js";

test("dedicated ops resolver refuses generic-project substitution", async () => {
  const saved = { ...process.env };
  delete process.env.MATRX_OPS_SUPABASE_URL;
  delete process.env.MATRX_OPS_SUPABASE_KEY;
  process.env.SUPABASE_URL = "https://wrong-project.example";
  process.env.SUPABASE_SERVICE_KEY = "wrong-key";
  try {
    assert.throws(() => resolveOpsSupabaseOrRaise(), (error) => {
      assert.ok(error instanceof OpsSupabaseUnconfiguredError);
      assert.match(error.message, /MATRX_OPS_SUPABASE_URL/);
      assert.match(error.message, /MATRX_FLEET_OPS_SYNC_SECONDS=0/);
      return true;
    });
    await assert.rejects(() => syncFleetIssuesToOps([]), OpsSupabaseUnconfiguredError);
  } finally { process.env = saved; }
});

test("safe dedicated-project path remains configured", () => {
  const saved = { ...process.env };
  process.env.MATRX_OPS_SUPABASE_URL = "https://ops.example/";
  process.env.MATRX_OPS_SUPABASE_KEY = "ops-key";
  try {
    assert.deepEqual(resolveOpsSupabaseOrRaise(), { url: "https://ops.example", key: "ops-key" });
  } finally { process.env = saved; }
});

test("fleet ops writer refuses a missing organization before any database request", async () => {
  const saved = { ...process.env };
  const savedFetch = globalThis.fetch;
  process.env.MATRX_OPS_SUPABASE_URL = "https://ops.example/";
  process.env.MATRX_OPS_SUPABASE_KEY = "ops-key";
  delete process.env.MATRX_FLEET_OPS_ORGANIZATION_ID;
  globalThis.fetch = async () => { throw new Error("database request must not run"); };
  try {
    assert.throws(() => resolveFleetOpsOrganizationIdOrRaise(), (error) => {
      assert.ok(error instanceof FleetOpsOrganizationUnconfiguredError);
      assert.match(error.message, /MATRX_FLEET_OPS_ORGANIZATION_ID/);
      assert.match(error.message, /MATRX_FLEET_OPS_SYNC_SECONDS=0/);
      return true;
    });
    await assert.rejects(
      () => syncFleetIssuesToOps([{ id: "host", label: "Host", status: "critical" }]),
      FleetOpsOrganizationUnconfiguredError,
    );
    assert.equal(opsConfigured(), false);
  } finally {
    globalThis.fetch = savedFetch;
    process.env = saved;
  }
});

test("fleet ops writer rejects a non-UUID organization", () => {
  const saved = { ...process.env };
  process.env.MATRX_FLEET_OPS_ORGANIZATION_ID = "system";
  try {
    assert.throws(() => resolveFleetOpsOrganizationIdOrRaise(), FleetOpsOrganizationUnconfiguredError);
    assert.equal(opsConfigured(), false);
  } finally { process.env = saved; }
});

test("transition event POST carries the configured organization without lookup", async () => {
  const saved = { ...process.env };
  const savedFetch = globalThis.fetch;
  const organizationId = "28f0f412-6f23-4d51-8f1e-30138522b1ab";
  const requests = [];
  process.env.MATRX_OPS_SUPABASE_URL = "https://ops.example/";
  process.env.MATRX_OPS_SUPABASE_KEY = "ops-key";
  process.env.MATRX_FLEET_OPS_ORGANIZATION_ID = organizationId;
  globalThis.fetch = async (url, opts = {}) => {
    requests.push({ url, opts });
    if (String(url).includes("ops_issue_class?")) {
      return new Response(JSON.stringify([{ id: "class-1", is_active: false }]), { status: 200 });
    }
    return new Response("", { status: 200 });
  };
  try {
    assert.equal(resolveFleetOpsOrganizationIdOrRaise(), organizationId);
    assert.equal(opsConfigured(), true);
    await syncFleetIssuesToOps([{ id: "host", label: "Host", status: "critical", detail: "down" }]);
    assert.equal(requests.some(({ url }) => String(url).includes("order=created_at.desc")), false);
    const eventPost = requests.find(({ url, opts }) => String(url).endsWith("/ops_issue_event") && opts.method === "POST");
    assert.ok(eventPost, "expected an ops_issue_event POST");
    assert.equal(JSON.parse(eventPost.opts.body).organization_id, organizationId);
  } finally {
    globalThis.fetch = savedFetch;
    process.env = saved;
  }
});

test("source guard bans generic Supabase aliases", () => {
  const source = fs.readFileSync(new URL("./ops_triage.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /process\.env\.MATRX_OPS_SUPABASE_URL\s*\|\|/);
  assert.doesNotMatch(source, /process\.env\.MATRX_OPS_SUPABASE_KEY\s*\|\|/);
  assert.doesNotMatch(source, /defaultOrgId|order=created_at\.desc/);
});
