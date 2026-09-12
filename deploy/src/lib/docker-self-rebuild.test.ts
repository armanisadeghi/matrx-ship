import assert from "node:assert/strict";
import { spawn as realSpawn } from "node:child_process";
import { EventEmitter } from "node:events";
import test from "node:test";
import { streamingSelfRebuild } from "./docker";

class FakeProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
}

test("manual Manager rebuild refuses the existing host deploy lock before compose can run", async () => {
  const child = new FakeProcess();
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  let command: string | undefined;
  const completed = streamingSelfRebuild(
    (event, data) => events.push({ event, data }),
    {
      existsSync: () => true,
      spawn: ((file: string, args: string[]) => {
        command = `${file} ${args.join(" ")}`;
        queueMicrotask(() => child.emit("close", 75));
        return child as never;
      }) as unknown as typeof import("node:child_process").spawn,
    },
  );
  await completed;
  assert.match(command || "", /flock -n -E 75 \/host-srv\/apps\/deploy-state\/.ship-deploy\.lock sh -ceu/);
  assert.deepEqual(events.at(-1), {
    event: "error",
    data: { success: false, error: "A Ship deployment is already running; Manager recreation was not started." },
  });
});

test("manual Manager rebuild reports done only after the health-gated locked process succeeds", async () => {
  const child = new FakeProcess();
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const completed = streamingSelfRebuild(
    (event, data) => events.push({ event, data }),
    {
      existsSync: () => true,
      spawn: ((_: string, args: string[]) => {
        const script = args.at(-1) || "";
        assert.match(script, /timeout 60 docker compose up -d --force-recreate server-manager/);
        assert.match(script, /MATRX_MANAGER_HEALTH=ready/);
        assert.match(script, /127\.0\.0\.1:3000\/health/);
        queueMicrotask(() => child.emit("close", 0));
        return child as never;
      }) as unknown as typeof import("node:child_process").spawn,
    },
  );
  await completed;
  assert.deepEqual(events.at(-1), {
    event: "done",
    data: { success: true, message: "Manager updated, recreated, and passed its in-container health check." },
  });
});

test("unhealthy Manager recreation is an error, never a success terminal", async () => {
  const child = new FakeProcess();
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const completed = streamingSelfRebuild(
    (event, data) => events.push({ event, data }),
    {
      existsSync: () => true,
      spawn: ((_: string, _args: string[]) => {
        queueMicrotask(() => child.emit("close", 42));
        return child as never;
      }) as unknown as typeof import("node:child_process").spawn,
    },
  );
  await completed;
  assert.deepEqual(events.at(-1), {
    event: "error",
    data: { success: false, error: "Manager recreation completed but its in-container health check did not become ready." },
  });
});

test("process exit delivers one health-gated terminal event even when close never arrives", async () => {
  const child = new FakeProcess();
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const completed = streamingSelfRebuild(
    (event, data) => events.push({ event, data }),
    {
      existsSync: () => true,
      spawn: ((_: string, _args: string[]) => {
        queueMicrotask(() => child.emit("exit", 0));
        return child as never;
      }) as unknown as typeof import("node:child_process").spawn,
    },
  );
  await completed;
  assert.deepEqual(events.at(-1), {
    event: "done",
    data: { success: true, message: "Manager updated, recreated, and passed its in-container health check." },
  });
  child.emit("close", 0);
  assert.equal(events.filter(({ event }) => event === "done").length, 1);
});

test("real child stdout is retained while its exit still completes the stream", async () => {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  let closed!: () => void;
  const stdioClosed = new Promise<void>((resolve) => { closed = resolve; });
  const completed = streamingSelfRebuild(
    (event, data) => events.push({ event, data }),
    {
      existsSync: () => true,
      spawn: (() => {
        const child = realSpawn(process.execPath, ["-e", "process.stdout.write('health-log\\n')"]);
        child.once("close", () => closed());
        return child;
      }) as unknown as typeof import("node:child_process").spawn,
    },
  );
  await completed;
  await stdioClosed;
  assert.ok(events.some(({ event, data }) => event === "log" && data.message === "health-log"));
  assert.equal(events.filter(({ event }) => event === "done").length, 1);
});

test("inherited stdout after parent exit cannot enqueue after the terminal event", async () => {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  let closed!: () => void;
  const stdioClosed = new Promise<void>((resolve) => { closed = resolve; });
  const completed = streamingSelfRebuild(
    (event, data) => events.push({ event, data }),
    {
      existsSync: () => true,
      spawn: (() => {
        const lateWriter = "setTimeout(() => process.stdout.write('late-log\\n'), 25)";
        const code = [
          "const { spawn } = require('node:child_process');",
          `spawn(process.execPath, ['-e', ${JSON.stringify(lateWriter)}], { stdio: ['ignore', 'inherit', 'inherit'] });`,
          "process.exit(0);",
        ].join(" ");
        const child = realSpawn(process.execPath, ["-e", code]);
        child.once("close", () => closed());
        return child;
      }) as unknown as typeof import("node:child_process").spawn,
    },
  );
  await completed;
  await stdioClosed;
  assert.equal(events.filter(({ event }) => event === "done").length, 1);
  assert.equal(events.some(({ data }) => data.message === "late-log"), false);
});
