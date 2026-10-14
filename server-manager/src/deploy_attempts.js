/**
 * Auto-deploy attempt ledger for the PyPI-deployed microservices.
 * ================================================================
 * 2026-10-13: matrx-files sat on 0.2.280 for four days while PyPI moved to
 * 0.2.293. Every new image refused itself in preflight (three settings missing
 * on the box, then a central-authority contract the main server did not meet).
 * The old ledger allowed ONE attempt per version, forever, and kept no reason —
 * so a configuration problem, fixed an hour later, still left that version
 * skipped, and the only trace of why was a Manager console line.
 *
 * Now every attempt is recorded with when and why it failed, a failed version
 * is tried again after AUTO_DEPLOY_RETRY_HOURS (a broken release costs one
 * cached rebuild per window, never a build loop), and the fleet check reads
 * the reason and how long the service has been behind from here.
 */

export const AUTO_DEPLOY_RETRY_HOURS = 6;
// Behind for longer than this is critical, not a warning.
export const STALE_CRITICAL_HOURS = 24;
const KEEP = 50;

export function emptyLedger() {
  return { attempts: [] };
}

/** Parse a ledger file's text. The old `{tried: [...]}` shape carries no time
 * or reason, so its versions read as failed long ago and become eligible again. */
export function parseLedger(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { return emptyLedger(); }
  if (Array.isArray(raw?.attempts)) return { attempts: raw.attempts.filter((a) => a && a.version) };
  if (Array.isArray(raw?.tried)) {
    return { attempts: raw.tried.map((version) => ({ version, at: null, ok: false, reason: null })) };
  }
  return emptyLedger();
}

function attemptsFor(ledger, version) {
  return ledger.attempts.filter((a) => a.version === version);
}

export function lastAttempt(ledger, version) {
  const list = attemptsFor(ledger, version);
  return list.length ? list[list.length - 1] : null;
}

/** When this version was first seen and attempted: the start of "behind". */
export function firstAttemptAt(ledger, version) {
  const first = attemptsFor(ledger, version).find((a) => a.at);
  return first ? first.at : null;
}

export function shouldAutoAttempt(ledger, version, now = Date.now()) {
  const last = lastAttempt(ledger, version);
  if (!last) return { attempt: true, why: "first attempt" };
  if (last.ok) return { attempt: false, why: "already deployed once" };
  const lastAt = last.at ? Date.parse(last.at) : 0;
  const waitMs = AUTO_DEPLOY_RETRY_HOURS * 3600_000;
  if (now - lastAt >= waitMs) return { attempt: true, why: `retry: last attempt failed ${last.at ? "at " + last.at : "before attempts were timed"}` };
  return { attempt: false, why: `next retry after ${new Date(lastAt + waitMs).toISOString()}` };
}

export function recordAttempt(ledger, version, { ok, reason = null, at = new Date().toISOString() }) {
  const attempts = [...ledger.attempts, { version, at, ok: !!ok, reason: ok ? null : reason }];
  return { attempts: attempts.slice(-KEEP) };
}

/** Drop the latest attempt of a version (a host-disk refusal is not the release's fault). */
export function releaseLastAttempt(ledger, version) {
  const i = ledger.attempts.map((a) => a.version).lastIndexOf(version);
  if (i < 0) return ledger;
  return { attempts: ledger.attempts.filter((_, j) => j !== i) };
}

const SIGNAL = /(Error|BLOCKED|FAILED|refus|missing|No space left|unavailable|denied|Traceback)/i;
const NOISE = /^(#\d+|\s*File "|\s*~|\s*\^|Traceback \(most recent)/;

/** The one line a person needs from a deploy's tail: the last line that names
 * an error and is not a build-log or traceback frame. */
export function failureReason(tail) {
  const lines = String(tail || "").split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (NOISE.test(line) || /^failed to run commands/i.test(line)) continue;
    if (SIGNAL.test(line)) return line.slice(0, 300);
  }
  return lines.length ? lines[lines.length - 1].slice(0, 300) : null;
}

export function hoursSince(iso, now = Date.now()) {
  if (!iso) return null;
  return Math.max(0, (now - Date.parse(iso)) / 3600_000);
}
