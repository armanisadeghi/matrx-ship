import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseLedger, shouldAutoAttempt, recordAttempt, releaseLastAttempt, failureReason,
  firstAttemptAt, AUTO_DEPLOY_RETRY_HOURS,
} from "./deploy_attempts.js";
import { judgeFreshness, WEBSITE_RELEASE_SUBJECT } from "./release_freshness.js";

const H = 3600_000;
const T0 = Date.parse("2026-10-12T10:00:00Z");

test("a failed version is retried after the window, never skipped forever", () => {
  let ledger = parseLedger("");
  assert.equal(shouldAutoAttempt(ledger, "0.2.293", T0).attempt, true);
  ledger = recordAttempt(ledger, "0.2.293", { ok: false, reason: "missing: MATRX_SESSION_AUTHORITY_URL", at: new Date(T0).toISOString() });
  assert.equal(shouldAutoAttempt(ledger, "0.2.293", T0 + H).attempt, false);
  assert.equal(shouldAutoAttempt(ledger, "0.2.293", T0 + AUTO_DEPLOY_RETRY_HOURS * H).attempt, true);
  ledger = recordAttempt(ledger, "0.2.293", { ok: true, at: new Date(T0 + 7 * H).toISOString() });
  assert.equal(shouldAutoAttempt(ledger, "0.2.293", T0 + 100 * H).attempt, false);
  assert.equal(firstAttemptAt(ledger, "0.2.293"), new Date(T0).toISOString());
});

test("the old one-attempt ledger shape becomes eligible again", () => {
  const ledger = parseLedger(JSON.stringify({ tried: ["0.2.281", "0.2.293"] }));
  assert.equal(shouldAutoAttempt(ledger, "0.2.293", T0).attempt, true);
});

test("a host-disk refusal leaves no attempt behind", () => {
  const ledger = recordAttempt(parseLedger(""), "1.0.0", { ok: false, reason: "No space left on device" });
  assert.equal(releaseLastAttempt(ledger, "1.0.0").attempts.length, 0);
});

test("the failure reason is the line that names the error, not a build or traceback frame", () => {
  const tail = [
    "#8 naming to docker.io/library/matrx-files:0.2.293 done",
    "Traceback (most recent call last):",
    '  File "/usr/local/lib/python3.13/site-packages/matrx_files/standalone/preflight.py", line 33, in verify',
    "RuntimeError: Files central authority refusal contract is unavailable",
    "failed to run commands: exit status 1",
  ].join("\n");
  assert.equal(failureReason(tail), "RuntimeError: Files central authority refusal contract is unavailable");
});

const SVC = { id: "scraper", label: "Scraper", impact: "Old build.", runningUrl: "x", graceMinutes: 60, howItShips: "" };

test("current is ok and clears the behind-since memory", () => {
  const state = { scraper: { latest: "1", since: "2026-10-01T00:00:00Z" } };
  assert.equal(judgeFreshness(SVC, { running: "1", latest: "1", now: T0 }, state).status, "ok");
  assert.equal(state.scraper, undefined);
});

test("behind inside the grace window is a rollout, then a warning, then critical after a day", () => {
  const state = {};
  const at = new Date(T0).toISOString();
  assert.equal(judgeFreshness(SVC, { running: "1", latest: "2", latestAt: at, now: T0 + 30 * 60_000 }, state).status, "ok");
  const warn = judgeFreshness(SVC, { running: "1", latest: "2", latestAt: at, now: T0 + 2 * H }, state);
  assert.equal(warn.status, "warning");
  assert.match(warn.detail, /released 2 hours ago/);
  assert.equal(warn.facts.behind_since, at);
  assert.equal(judgeFreshness(SVC, { running: "1", latest: "2", latestAt: at, now: T0 + 25 * H }, state).status, "critical");
});

test("behind-since survives re-checks and resets only for a newer release", () => {
  const state = {};
  judgeFreshness(SVC, { running: "1", latest: "2", now: T0 }, state);
  judgeFreshness(SVC, { running: "1", latest: "2", now: T0 + 5 * H }, state);
  assert.equal(state.scraper.since, new Date(T0).toISOString());
  judgeFreshness(SVC, { running: "1", latest: "3", now: T0 + 6 * H }, state);
  assert.equal(state.scraper.since, new Date(T0 + 6 * H).toISOString());
});

test("no running version is critical; no latest is unknown", () => {
  assert.equal(judgeFreshness(SVC, { running: null, latest: "2", now: T0 }, {}).status, "critical");
  assert.equal(judgeFreshness(SVC, { running: "1", latest: null, now: T0 }, {}).status, "unknown");
});

test("every website release prefix counts as a release commit", () => {
  for (const s of ["release: v1", "release-all: v1", "release-admin: v1", "release-demos: x", "release-lab: x"]) assert.ok(WEBSITE_RELEASE_SUBJECT.test(s), s);
  assert.ok(!WEBSITE_RELEASE_SUBJECT.test("fix: release notes"));
});
