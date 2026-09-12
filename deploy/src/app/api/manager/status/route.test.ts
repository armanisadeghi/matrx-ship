import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "./route";
import { managerStatusPayload, managerStatusResponse, type CommandRunner } from "@/lib/manager-status";

function runner(inspect: unknown, probe: { success: boolean; output: string; error?: string }, commands: string[] = []): CommandRunner {
  return (command) => {
    commands.push(command);
    if (command.startsWith("docker inspect")) return { success: true, output: JSON.stringify(inspect) };
    if (command.startsWith("docker exec")) return probe;
    return { success: true, output: "main" };
  };
}

test("status route reports running only from the native in-container successful probe", () => {
  const commands: string[] = [];
  const payload = managerStatusPayload(runner({ State: { Running: true } }, { success: true, output: '{"status":200,"body":"ok"}' }, commands));
  assert.equal(payload.health_status, "running");
  assert.equal(payload.health_response_status, 200);
  const probeCommand = commands.find((command) => command.startsWith("docker exec"));
  assert.match(probeCommand ?? "", /node -e/);
  assert.doesNotMatch(probeCommand ?? "", /wget/);
});

test("status route reports a non-2xx native probe as proven down", () => {
  const payload = managerStatusPayload(runner({ State: { Running: true } }, { success: true, output: '{"status":503,"body":"unavailable"}' }));
  assert.equal(payload.health_status, "down");
  assert.equal(payload.health_response_status, 503);
});

test("status route reports probe failure as unknown rather than down", () => {
  const payload = managerStatusPayload(runner({ State: { Running: true } }, { success: false, output: "", error: "node unavailable" }));
  assert.equal(payload.health_status, "unknown");
  assert.equal(payload.health_response_status, null);
});

test("actual GET refuses unauthenticated requests", async () => {
  const response = await GET(new Request("http://localhost/api/manager/status") as never);
  assert.equal(response.status, 401);
});

test("response factory refuses unauthenticated requests before any Docker command", () => {
  let called = false;
  const response = managerStatusResponse(new Request("http://localhost/api/manager/status") as never, () => {
    called = true;
    return { success: true, output: "{}" };
  });
  assert.equal(response.status, 401);
  assert.equal(called, false);
});

test("status route accepts a valid canonical Deploy token and performs the probe", async () => {
  const previous = process.env.DEPLOY_TOKENS;
  process.env.DEPLOY_TOKENS = "manager-status-test-token";
  try {
    const response = managerStatusResponse(
      new Request("http://localhost/api/manager/status", { headers: { Authorization: "Bearer manager-status-test-token" } }) as never,
      runner({ State: { Running: true } }, { success: true, output: '{"status":200,"body":"ok"}' }),
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).health_status, "running");
  } finally {
    if (previous === undefined) delete process.env.DEPLOY_TOKENS;
    else process.env.DEPLOY_TOKENS = previous;
  }
});
