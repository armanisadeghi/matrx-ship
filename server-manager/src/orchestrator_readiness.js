export async function waitForOrchestratorReady({
  url,
  apiKey = "",
  totalMs = 30000,
  stepMs = 1000,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const start = now();
  while (now() - start < totalMs) {
    try {
      const headers = apiKey ? { "X-API-Key": apiKey } : {};
      const response = await fetchImpl(`${url}/`, {
        headers,
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) return { ready: true, waited_ms: now() - start };
    } catch { /* still booting */ }
    await wait(stepMs);
  }
  return { ready: false, waited_ms: now() - start };
}
