export type SseEvent = { event: string; data: Record<string, unknown> };

export type SseReader = {
  read(): Promise<ReadableStreamReadResult<Uint8Array>>;
  cancel?(reason?: unknown): Promise<void>;
};

export type SseConsumeOptions = {
  /** Stop immediately after an application-level terminal frame. */
  stopWhen?: (event: SseEvent) => boolean;
};

/** Incremental SSE parser: event and data fields may arrive in separate chunks. */
export class SseEventParser {
  private buffer = "";
  private event = "message";

  push(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";
    const events: SseEvent[] = [];
    for (const line of lines) {
      if (line.startsWith("event: ")) this.event = line.slice(7);
      else if (line.startsWith("data: ")) {
        try { events.push({ event: this.event, data: JSON.parse(line.slice(6)) as Record<string, unknown> }); }
        catch { /* malformed event is ignored */ }
      } else if (line === "") this.event = "message";
    }
    return events;
  }
}

/**
 * Reads an SSE response incrementally. Fetch/chunk boundaries are unrelated to
 * SSE event boundaries, so consumers must not parse one network chunk at a time.
 */
export async function consumeSseEvents(
  reader: SseReader,
  onEvent: (event: SseEvent) => void,
  options: SseConsumeOptions = {},
): Promise<void> {
  const decoder = new TextDecoder();
  const parser = new SseEventParser();
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    for (const event of parser.push(decoder.decode(value, { stream: true }))) {
      onEvent(event);
      if (options.stopWhen?.(event)) {
        await reader.cancel?.("received terminal SSE event");
        return;
      }
    }
  }
}

/** Rebuild streams use `done`/`error` as the operation terminal, not transport EOF. */
export function consumeOperationSseEvents(reader: SseReader, onEvent: (event: SseEvent) => void): Promise<void> {
  return consumeSseEvents(reader, onEvent, {
    stopWhen: ({ event }) => event === "done" || event === "error",
  });
}
