import assert from "node:assert/strict";
import test from "node:test";
import { classifyManagerHealth } from "./manager-health";

test("native successful manager probe is running", () => {
  assert.deepEqual(
    classifyManagerHealth({ running: true }, { success: true, output: '{"status":200,"body":"ok"}' }),
    { status: "running", response_status: 200 },
  );
});

test("native non-2xx manager probe proves down", () => {
  assert.deepEqual(
    classifyManagerHealth({ running: true }, { success: true, output: '{"status":503,"body":"unavailable"}' }),
    { status: "down", response_status: 503 },
  );
});

test("probe execution or malformed output is unknown, never falsely down", () => {
  assert.deepEqual(classifyManagerHealth({ running: true }, { success: false, output: "", error: "exec failed" }), { status: "unknown", response_status: null });
  assert.deepEqual(classifyManagerHealth({ running: true }, { success: true, output: "not-json" }), { status: "unknown", response_status: null });
});

test("a known stopped container is down without requiring a probe", () => {
  assert.deepEqual(classifyManagerHealth({ running: false }, { success: false, output: "" }), { status: "down", response_status: null });
});
