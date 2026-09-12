import assert from "node:assert/strict";
import test from "node:test";
import { consumeOperationSseEvents, consumeSseEvents, SseEventParser } from "./sse-events";

test("split SSE event/data chunks retain the done type", () => {
  const parser = new SseEventParser();
  assert.deepEqual(parser.push("event: done\n"), []);
  assert.deepEqual(parser.push('data: {"success":true}\n\n'), [{ event: "done", data: { success: true } }]);
});

test("multiple events and malformed data do not corrupt the following event", () => {
  const parser = new SseEventParser();
  assert.deepEqual(parser.push('event: log\ndata: bad\n\nevent: error\ndata: {"error":"x"}\n\n'), [{ event: "error", data: { error: "x" } }]);
});

test("stream consumer delivers a terminal frame split at the network boundary", async () => {
  const chunks = [new TextEncoder().encode("event: done\n"), new TextEncoder().encode('data: {"success":true}\n\n')];
  const reader = {
    async read() {
      const value = chunks.shift();
      return value ? { done: false as const, value } : { done: true as const, value: undefined };
    },
  };
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  await consumeSseEvents(reader, (event) => events.push(event));
  assert.deepEqual(events, [{ event: "done", data: { success: true } }]);
});

test("terminal frame cancels the reader instead of waiting forever for EOF", async () => {
  const chunks = [new TextEncoder().encode("event: error\ndata: {\"error\":\"conflict\"}\n\n")];
  let reads = 0;
  let cancelled = false;
  const reader = {
    async read() {
      reads += 1;
      const value = chunks.shift();
      if (value) return { done: false as const, value };
      throw new Error("consumer read after terminal frame");
    },
    async cancel() { cancelled = true; },
  };
  await consumeSseEvents(reader, () => {}, { stopWhen: ({ event }) => event === "error" });
  assert.equal(reads, 1);
  assert.equal(cancelled, true);
});

test("rebuild stream consumer treats done as terminal even when transport EOF never arrives", async () => {
  const chunks = [new TextEncoder().encode("event: done\ndata: {\"success\":true}\n\n")];
  let reads = 0;
  const reader = {
    async read() {
      reads += 1;
      const value = chunks.shift();
      if (value) return { done: false as const, value };
      throw new Error("operation consumer read after done");
    },
    async cancel() {},
  };
  await consumeOperationSseEvents(reader, () => {});
  assert.equal(reads, 1);
});
