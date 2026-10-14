/**
 * Release freshness for services this Manager does not deploy itself.
 * ====================================================================
 * The Manager deploys matrx-files and matrx-seo (MICROSERVICES) and watches the
 * sandbox orchestrators and aidream's ECS pipeline. Everything else that ships
 * on its own release path had no freshness check at all (2026-10-13 census):
 * the scraper's only check lived inside its deploy workflow, and the website's
 * running commit was readable but nobody compared it with the latest release.
 *
 * Each entry names where the RUNNING version is read (a public endpoint, no
 * credentials) and how the LATEST RELEASED version is found. A service that is
 * behind longer than its grace window is a warning; behind longer than
 * STALE_CRITICAL_HOURS is critical. "Behind since" is remembered per (service,
 * latest) so the age survives Manager restarts and never resets on a re-check.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { STALE_CRITICAL_HOURS, hoursSince } from "./deploy_attempts.js";

const STATE_FILE = "/host-srv/apps/deploy-state/release-freshness.json";

// A release commit on the website repo starts with one of these (vercel.json →
// scripts/vercel-ignore-build.sh in ai-matrx). Every prefix builds www.
export const WEBSITE_RELEASE_SUBJECT = /^release(-all|-admin|-demos|-lab)?:/;

export const RELEASED_SERVICES = [
  {
    id: "scraper",
    label: "Scraper (scraper.app.matrxserver.com)",
    impact: "Scraping runs on an older build than the one released.",
    runningUrl: "https://scraper.app.matrxserver.com/health/version",
    runningField: "version",
    latest: { kind: "pypi", package: "matrx-scraper" },
    graceMinutes: 60,
    howItShips: "aidream's release deploys it on Coolify (deploy-scraper job); a skipped or failed job leaves it behind.",
  },
  {
    id: "website",
    label: "Website (www.aimatrx.com)",
    impact: "People are using an older build of the app than the one released.",
    runningUrl: "https://www.aimatrx.com/api/version",
    runningField: "commit",
    latest: { kind: "github-release-commit", repo: "armanisadeghi/ai-matrx", subject: WEBSITE_RELEASE_SUBJECT },
    graceMinutes: 60,
    howItShips: "Vercel builds each release commit; a failed or cancelled build leaves the site behind.",
  },
];

export function loadState(path = STATE_FILE) {
  try { return JSON.parse(readFileSync(path, "utf-8")); } catch { return {}; }
}

export function saveState(state, path = STATE_FILE) {
  try { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(state, null, 2)); } catch { /* the check still answers; only the age resets */ }
}

/** Pure: the verdict for one observation. `state` is mutated with behind-since. */
export function judgeFreshness(svc, { running, latest, latestAt = null, now = Date.now() }, state) {
  const base = { id: svc.id, label: svc.label, actions: [] };
  const short = (v) => (v && /^[0-9a-f]{40}$/.test(v) ? v.slice(0, 7) : v);
  if (!latest) return { ...base, status: "unknown", detail: `Could not read the latest release of ${svc.label}.` };
  if (!running) return { ...base, status: "critical", detail: `${svc.label} does not report a running version at ${svc.runningUrl}. ${svc.impact}` };
  if (running === latest) {
    delete state[svc.id];
    return { ...base, status: "ok", detail: `Running the latest release (${short(latest)}).` };
  }
  const prior = state[svc.id];
  const since = prior && prior.latest === latest ? prior.since : (latestAt || new Date(now).toISOString());
  state[svc.id] = { latest, since };
  const hours = hoursSince(since, now) ?? 0;
  const facts = { service: svc.id, running, latest, behind_since: since };
  if (hours * 60 < svc.graceMinutes) {
    return { ...base, status: "ok", facts, detail: `Release ${short(latest)} is rolling out (${Math.round(hours * 60)} of ${svc.graceMinutes} minutes); still running ${short(running)}.` };
  }
  const status = hours >= STALE_CRITICAL_HOURS ? "critical" : "warning";
  return {
    ...base, status, facts,
    detail: `Running ${short(running)} while ${short(latest)} was released ${formatHours(hours)} ago. ${svc.impact} ${svc.howItShips}`,
  };
}

export function formatHours(hours) {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} minutes`;
  if (hours < 48) return `${Math.round(hours)} hours`;
  return `${Math.round(hours / 24)} days`;
}

async function readRunning(svc) {
  const r = await fetch(svc.runningUrl, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`${svc.runningUrl} -> HTTP ${r.status}`);
  const body = await r.json();
  const v = body?.[svc.runningField];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

async function readLatest(svc, githubToken) {
  const l = svc.latest;
  if (l.kind === "pypi") {
    const r = await fetch(`https://pypi.org/pypi/${l.package}/json`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`PyPI ${l.package} -> HTTP ${r.status}`);
    const j = await r.json();
    const version = j.info.version;
    const files = j.releases?.[version] || [];
    const latestAt = files.map((f) => f.upload_time_iso_8601).filter(Boolean).sort()[0] || null;
    return { latest: version, latestAt };
  }
  if (l.kind === "github-release-commit") {
    const r = await fetch(`https://api.github.com/repos/${l.repo}/commits?sha=main&per_page=100`, {
      headers: { ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}), Accept: "application/vnd.github+json", "User-Agent": "matrx-manager" },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`GitHub ${l.repo} commits -> HTTP ${r.status}`);
    const commit = (await r.json()).find((c) => l.subject.test(c.commit?.message || ""));
    if (!commit) return { latest: null, latestAt: null };
    return { latest: commit.sha, latestAt: commit.commit?.committer?.date || null };
  }
  throw new Error(`unknown latest kind ${l.kind}`);
}

export async function checkReleasedService(svc, { githubToken = "", state, now = Date.now() } = {}) {
  try {
    const [running, { latest, latestAt }] = await Promise.all([readRunning(svc), readLatest(svc, githubToken)]);
    return judgeFreshness(svc, { running, latest, latestAt, now }, state);
  } catch (e) {
    return { id: svc.id, label: svc.label, status: "unknown", detail: `Freshness check failed: ${e.message}`, actions: [] };
  }
}

export async function checkAllReleasedServices(opts = {}) {
  const state = loadState();
  const results = [];
  for (const svc of RELEASED_SERVICES) results.push(await checkReleasedService(svc, { ...opts, state }));
  saveState(state);
  return results;
}
