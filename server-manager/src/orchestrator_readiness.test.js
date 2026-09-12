import assert from "node:assert/strict";
import test from "node:test";
import { waitForOrchestratorReady } from "./orchestrator_readiness.js";

test("authenticated orchestrator readiness sends the target API key", async () => {
  let clock = 0;
  const requests = [];
  const result = await waitForOrchestratorReady({
    url: "https://orchestrator.example.com",
    apiKey: "expected-orchestrator-key",
    totalMs: 2,
    stepMs: 1,
    now: () => clock,
    wait: async (ms) => { clock += ms; },
    fetchImpl: async (url, init) => {
      requests.push({ url, headers: init.headers });
      return new Response(null, {
        status: init.headers?.["X-API-Key"] === "expected-orchestrator-key" ? 200 : 401,
      });
    },
  });

  assert.deepEqual(result, { ready: true, waited_ms: 0 });
  assert.deepEqual(requests, [{
    url: "https://orchestrator.example.com/",
    headers: { "X-API-Key": "expected-orchestrator-key" },
  }]);
});
