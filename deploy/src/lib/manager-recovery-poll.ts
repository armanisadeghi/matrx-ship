export type RecoveryClock = {
  now(): number;
  setTimeout(callback: () => void, milliseconds: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
};

type RecoveryOptions = {
  request(signal: AbortSignal): Promise<{ health_status?: string }>;
  onRunning(): void;
  onDeadline(): void;
  clock?: RecoveryClock;
  delayMs?: number;
  maxAttempts?: number;
};

type BrowserTimerHost = {
  setTimeout(callback: () => void, milliseconds?: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle?: ReturnType<typeof setTimeout>): void;
};

/** Native timer methods require the browser global as their receiver. */
export function createBrowserRecoveryClock(timerHost: BrowserTimerHost = globalThis): RecoveryClock {
  return {
    now: () => Date.now(),
    setTimeout: (callback, milliseconds) => timerHost.setTimeout(callback, milliseconds),
    clearTimeout: (handle) => timerHost.clearTimeout(handle),
  };
}

const browserClock = createBrowserRecoveryClock();

/** One bounded, abortable recovery request at a time. */
export function startManagerRecoveryPoll(options: RecoveryOptions) {
  const clock = options.clock ?? browserClock;
  const delayMs = options.delayMs ?? 3000;
  const deadline = clock.now() + delayMs * (options.maxAttempts ?? 60);
  let disposed = false;
  let completed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;

  const clear = () => {
    if (timer) clock.clearTimeout(timer);
    if (deadlineTimer) clock.clearTimeout(deadlineTimer);
    timer = null; deadlineTimer = null;
  };
  const expire = () => {
    if (disposed || completed) return;
    completed = true;
    controller?.abort();
    clear();
    options.onDeadline();
  };
  const schedule = () => {
    if (disposed) return;
    if (clock.now() >= deadline) { expire(); return; }
    timer = clock.setTimeout(() => { timer = null; void poll(); }, delayMs);
  };
  const poll = async () => {
    if (disposed || completed) return;
    controller = new AbortController();
    const remaining = Math.max(0, deadline - clock.now());
    deadlineTimer = clock.setTimeout(expire, remaining);
    try {
      const result = await options.request(controller.signal);
      if (disposed || completed) return;
      if (result.health_status === "running") { completed = true; clear(); options.onRunning(); return; }
    } catch { /* deadline and transport failures both proceed only while live */
    } finally {
      if (deadlineTimer) clock.clearTimeout(deadlineTimer);
      deadlineTimer = null;
      controller = null;
    }
    if (!disposed && !completed) schedule();
  };
  void poll();
  return {
    dispose() {
      disposed = true;
      controller?.abort();
      clear();
    },
  };
}
