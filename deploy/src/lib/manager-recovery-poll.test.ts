import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserRecoveryClock, startManagerRecoveryPoll, type RecoveryClock } from "./manager-recovery-poll";

function fakeClock() {
  let now = 0, next = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const clock: RecoveryClock = {
    now: () => now,
    setTimeout: (callback, milliseconds) => { const id = ++next; timers.set(id, { at: now + milliseconds, callback }); return id as never; },
    clearTimeout: (id) => { timers.delete(id as never); },
  };
  return { clock, advance(milliseconds: number) { now += milliseconds; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); } } };
}

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

test("serial poll advances down then unknown to running without overlap", async () => {
  const fake = fakeClock(); let active = 0, maximum = 0, calls = 0, running = 0;
  startManagerRecoveryPoll({ clock: fake.clock, delayMs: 10, maxAttempts: 3,
    request: async () => { active++; maximum = Math.max(maximum, active); const status = ["down", "unknown", "running"][calls++]!; active--; return { health_status: status }; },
    onRunning: () => { running++; }, onDeadline: () => assert.fail("must reach running"),
  });
  await flush(); fake.advance(10); await flush(); fake.advance(10); await flush();
  assert.equal(calls, 3); assert.equal(maximum, 1); assert.equal(running, 1);
});

test("dispose aborts a pending request and suppresses future callbacks", async () => {
  const fake = fakeClock(); let aborted = false, settle!: (value: { health_status: string }) => void, callbacks = 0;
  const poll = startManagerRecoveryPoll({ clock: fake.clock, delayMs: 10, maxAttempts: 3,
    request: (signal) => new Promise((resolve) => { settle = resolve; signal.addEventListener("abort", () => { aborted = true; }); }),
    onRunning: () => { callbacks++; }, onDeadline: () => { callbacks++; },
  });
  poll.dispose(); settle({ health_status: "running" }); await flush(); fake.advance(100); await flush();
  assert.equal(aborted, true); assert.equal(callbacks, 0);
});

test("deadline aborts a hung request and reports once", async () => {
  const fake = fakeClock(); let aborted = false, deadlines = 0;
  startManagerRecoveryPoll({ clock: fake.clock, delayMs: 10, maxAttempts: 2,
    request: (signal) => new Promise(() => signal.addEventListener("abort", () => { aborted = true; })),
    onRunning: () => assert.fail("hung request cannot run"), onDeadline: () => { deadlines++; },
  });
  fake.advance(20); await flush();
  assert.equal(aborted, true); assert.equal(deadlines, 1);
});

test("browser clock preserves the native timer receiver through a recovery completion", async () => {
  let timerReceiver: unknown;
  let clearReceiver: unknown;
  const timerHost = {
    setTimeout(this: unknown, _callback: () => void, _milliseconds?: number) {
      timerReceiver = this;
      return 1 as never;
    },
    clearTimeout(this: unknown, _handle?: ReturnType<typeof setTimeout>) {
      clearReceiver = this;
    },
  };
  let running = false;
  startManagerRecoveryPoll({
    clock: createBrowserRecoveryClock(timerHost),
    request: async () => ({ health_status: "running" }),
    onRunning: () => { running = true; },
    onDeadline: () => assert.fail("running response must not reach the deadline"),
  });
  await flush();
  assert.equal(timerReceiver, timerHost, "native timer must not be rebound to the recovery-clock object");
  assert.equal(clearReceiver, timerHost, "native timer cleanup must preserve its browser receiver");
  assert.equal(running, true);
});
