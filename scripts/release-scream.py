#!/usr/bin/env python3
"""release-scream — a release-path check failed: say it LOUD, wake the ship-all lanes, and let the release go.

THE RULE (Arman, 2026-09-24 / 10-02 / 10-21): the release script never blocks. "Report warnings and
errors and release." "Release problems scream at the top of their lungs … wake up every agent, but
NOTHING … IS ALLOWED TO BLOCK A RELEASE." Every check on a release path (ship.sh, sync-main's push,
release.sh's push, the git hooks those pushes run) calls this instead of exiting non-zero.

  python3 ~/code/matrx-ship/scripts/release-scream.py --repo aidream --check "settings ratchet" \
      --detail "this ref adds an unbaselined hard-coded setting" [--where pre-push] [--ref <sha>] \
      [--title "NOT PUSHED"]

What it does, and it ALWAYS exits 0:
  1. prints a banner block to stderr (RELEASE WARNING — <title> …) with repo, check, detail; the title
     defaults to PUSHED ANYWAY — a caller whose push did NOT happen passes --title "NOT PUSHED";
  2. sends urgent agent mail (board.py, the existing agent-mail door) to the ship-all lanes, ONCE per
     repo+check+detail+recipient per 6 hours, from a detached child so the release never waits on the
     network. A key enters ~/.matrx/release-scream/sent.json only after board.py exits 0 for it; a failed
     send (expired token, no network) is logged to failed.log beside it and kept in pending.json, and
     the next release-scream call of ANY check retries it first.
Recipients: env MATRX_RELEASE_SCREAM_TO (comma-separated conversation ids), else the ship-all lanes
(the same recipients as ship_all.py's stale-release alarm). MATRX_RELEASE_SCREAM_NO_MAIL=1 prints only
(tests and dry runs).
"""
import argparse
import fcntl
import hashlib
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.realpath(__file__))
BOARD = os.path.join(HERE, "board.py")
BOARD = os.environ.get("MATRX_RELEASE_SCREAM_BOARD") or BOARD  # tests plant a stand-in mail door
STATE_DIR = os.environ.get("MATRX_RELEASE_SCREAM_STATE_DIR") or os.path.expanduser("~/.matrx/release-scream")
SENT = os.path.join(STATE_DIR, "sent.json")
PENDING = os.path.join(STATE_DIR, "pending.json")
FAILED_LOG = os.path.join(STATE_DIR, "failed.log")
LOCK = os.path.join(STATE_DIR, "deliver.lock")
PENDING_MAX_AGE_S = 24 * 3600
SEND_TIMEOUT_S = 120
REPEAT_S = 6 * 3600
SHIP_ALL_LANES = ("6bda811a-6b18-5ef3-a1c1-67f81ae6b2c4", "50b803bb-a5df-5ae9-a769-16f0a253bda6")
FROM = "release path"


def banner(repo, check, detail, where, ref, title="PUSHED ANYWAY"):
    bar = "!" * 100
    lines = [bar,
             "!!! RELEASE WARNING — %s. The release path is never blocked (Arman 2026-10-02)." % title,
             "!!! repo: %s   where: %s%s" % (repo, where or "release path", ("   ref: %s" % ref[:12]) if ref else ""),
             "!!! check: %s" % check]
    lines += ["!!!   " + l for l in (detail or "(no detail)").splitlines()[:30]]
    lines += ["!!! The ship-all lanes were mailed. Whoever reads this: fix the cause now; never re-add a block.", bar]
    return "\n".join(lines)


def _load(path):
    try:
        with open(path) as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _save(path, data):
    try:
        os.makedirs(STATE_DIR, exist_ok=True)
        tmp = "%s.%d.tmp" % (path, os.getpid())
        with open(tmp, "w") as f:
            json.dump(data, f)
        os.replace(tmp, path)
    except OSError:
        pass


def was_sent(key, now):
    return now - float(_load(SENT).get(key, 0)) < REPEAT_S


def mark_sent(key, now):
    sent = {k: v for k, v in _load(SENT).items() if now - float(v) < REPEAT_S}
    sent[key] = now
    _save(SENT, sent)


def deliver(jobs):
    """The detached child: send each {key, to, msg}, oldest pending first. A key is marked sent ONLY after
    board.py exits 0; a failure is logged and kept pending for the next call. One deliverer at a time
    (flock), and each send re-checks sent.json, so two screams racing never mail twice."""
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(LOCK, "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        now = time.time()
        pending = {k: v for k, v in _load(PENDING).items() if now - float(v.get("first", now)) < PENDING_MAX_AGE_S}
        for job in jobs:
            pending.setdefault(job["key"], dict(job, first=now))
        for key, job in sorted(pending.items(), key=lambda kv: kv[1].get("first", 0)):
            if was_sent(key, time.time()):
                pending.pop(key, None)
                continue
            try:
                r = subprocess.run([sys.executable, BOARD, "post", job["to"], job["msg"], "--urgent", "--from", FROM],
                                   stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=SEND_TIMEOUT_S)
                rc, why = r.returncode, (r.stderr or r.stdout or "").strip()
            except (OSError, subprocess.TimeoutExpired) as e:
                rc, why = -1, "%s: %s" % (type(e).__name__, e)
            if rc == 0:
                mark_sent(key, time.time())
                pending.pop(key, None)
                continue
            job["tries"] = int(job.get("tries", 0)) + 1
            try:
                with open(FAILED_LOG, "a") as f:
                    f.write("%s  to=%s  exit=%s  tries=%d  %s\n    %s\n" % (
                        time.strftime("%Y-%m-%d %H:%M:%S"), job["to"], rc, job["tries"],
                        job["msg"][:200].replace("\n", " "), why[-400:].replace("\n", " | ")))
            except OSError:
                pass
        _save(PENDING, pending)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--repo", required=True)
    p.add_argument("--check", required=True)
    p.add_argument("--detail", default="")
    p.add_argument("--where", default="")
    p.add_argument("--ref", default="")
    p.add_argument("--title", default="PUSHED ANYWAY",
                   help='banner/mail headline; a caller whose push did not happen passes "NOT PUSHED"')
    try:
        a = p.parse_args(argv)
    except SystemExit:
        return 0  # a bad call is never allowed to fail a release
    title = (a.title or "PUSHED ANYWAY").strip()
    print(banner(a.repo, a.check, a.detail, a.where, a.ref, title), file=sys.stderr, flush=True)
    if os.environ.get("MATRX_RELEASE_SCREAM_NO_MAIL") == "1":
        return 0
    to = [t.strip() for t in os.environ.get("MATRX_RELEASE_SCREAM_TO", "").split(",") if t.strip()] or list(SHIP_ALL_LANES)
    base = "%s\n%s\n%s" % (a.repo, a.check, (a.detail or "").splitlines()[0] if a.detail else "")
    msg = ("RELEASE WARNING (%s) in %s at %s: %s. %s%s — fix the cause; the release path never blocks."
           % (title.lower(), a.repo, a.where or "the release path", a.check, (a.detail or "").strip()[:600],
              (" (ref %s)" % a.ref[:12]) if a.ref else ""))
    now = time.time()
    jobs = [{"key": hashlib.sha1((base + "\n" + t).encode()).hexdigest(), "to": t, "msg": msg} for t in to]
    fresh = [j for j in jobs if not was_sent(j["key"], now)]
    if not fresh:
        print("release-scream: the ship-all lanes were already mailed about this in the last 6 hours.", file=sys.stderr)
    # Always start the deliverer when something is pending, even if this scream is a repeat: it retries
    # earlier failed sends.
    if not fresh and not _load(PENDING):
        return 0
    try:
        child = subprocess.Popen([sys.executable, os.path.realpath(__file__), "--deliver", json.dumps(fresh)],
                                 stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                 start_new_session=True)
        if os.environ.get("MATRX_RELEASE_SCREAM_WAIT") == "1":  # tests only: wait for the detached deliverer
            child.wait(timeout=SEND_TIMEOUT_S * 3)
    except OSError as e:
        print("release-scream: could not start the mail: %s" % e, file=sys.stderr)
    return 0


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--deliver":
        try:
            deliver(json.loads(sys.argv[2]))
        except Exception:
            pass
        sys.exit(0)
    try:
        sys.exit(main())
    except Exception as e:  # never, ever fail the caller
        print("release-scream crashed (%s); the release continues." % e, file=sys.stderr)
        sys.exit(0)
