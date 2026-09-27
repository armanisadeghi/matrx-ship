import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./index.js", import.meta.url), "utf8");

test("bulk sandbox migration endpoint fails closed without calling the orchestrator", () => {
  const route = source.match(/app\.post\("\/api\/orchestrator-sandboxes-migrate-all"[\s\S]*?\n}\);/);

  assert.ok(route, "bulk migration compatibility route must remain explicit and fail closed");
  assert.match(route[0], /res\.status\(409\)\.json\(\{/);
  assert.match(route[0], /error: "fleet_migration_disabled"/);
  assert.doesNotMatch(route[0], /orchFetch\("\/migrate-all"/);
  assert.doesNotMatch(source, /orchFetch\("\/migrate-all"/);
});
