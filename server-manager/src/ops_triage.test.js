import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { OpsSupabaseUnconfiguredError, resolveOpsSupabaseOrRaise, syncFleetIssuesToOps } from "./ops_triage.js";

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

test("source guard bans generic Supabase aliases", () => {
  const source = fs.readFileSync(new URL("./ops_triage.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /process\.env\.MATRX_OPS_SUPABASE_URL\s*\|\|/);
  assert.doesNotMatch(source, /process\.env\.MATRX_OPS_SUPABASE_KEY\s*\|\|/);
});
