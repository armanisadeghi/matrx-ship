import assert from "node:assert/strict";
import test from "node:test";
import { consumeSseEvents, SseEventParser } from "./sse-events";

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
