#!/usr/bin/env python3
"""release-scream — a release-path check failed: say it LOUD, wake the ship-all lanes, and let the release go.

THE RULE (Arman, 2026-09-24 / 10-02 / 10-21): the release script never blocks. "Report warnings and
errors and release." "Release problems scream at the top of their lungs … wake up every agent, but
NOTHING … IS ALLOWED TO BLOCK A RELEASE." Every check on a release path (ship.sh, sync-main's push,
release.sh's push, the git hooks those pushes run) calls this instead of exiting non-zero.

  python3 ~/code/matrx-ship/scripts/release-scream.py --repo aidream --check "settings ratchet" \
      --detail "this ref adds an unbaselined hard-coded setting" [--where pre-push] [--ref <sha>]

What it does, and it ALWAYS exits 0:
  1. prints a banner block to stderr (RELEASE WARNING — PUSHED ANYWAY …) with repo, check, detail;
  2. sends urgent agent mail (board.py, the existing agent-mail door) to the ship-all lanes, ONCE per
     repo+check+detail per 6 hours (state in ~/.matrx/release-scream/sent.json), in a detached child
     so the release never waits on the network.
Recipients: env MATRX_RELEASE_SCREAM_TO (comma-separated conversation ids), else the ship-all lanes
(the same recipients as ship_all.py's stale-release alarm). MATRX_RELEASE_SCREAM_NO_MAIL=1 prints only
(tests and dry runs).
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.realpath(__file__))
BOARD = os.path.join(HERE, "board.py")
STATE_DIR = os.path.expanduser("~/.matrx/release-scream")
SENT = os.path.join(STATE_DIR, "sent.json")
REPEAT_S = 6 * 3600
SHIP_ALL_LANES = ("6bda811a-6b18-5ef3-a1c1-67f81ae6b2c4", "50b803bb-a5df-5ae9-a769-16f0a253bda6")
FROM = "release path"


def banner(repo, check, detail, where, ref):
    bar = "!" * 100
    lines = [bar,
             "!!! RELEASE WARNING — PUSHED ANYWAY. The release path is never blocked (Arman 2026-10-02).",
             "!!! repo: %s   where: %s%s" % (repo, where or "release path", ("   ref: %s" % ref[:12]) if ref else ""),
             "!!! check: %s" % check]
    lines += ["!!!   " + l for l in (detail or "(no detail)").splitlines()[:30]]
    lines += ["!!! The ship-all lanes were mailed. Whoever reads this: fix the cause now; never re-add a block.", bar]
    return "\n".join(lines)


def should_mail(key, now):
    try:
        with open(SENT) as f:
            sent = json.load(f)
    except (OSError, ValueError):
        sent = {}
    if now - float(sent.get(key, 0)) < REPEAT_S:
        return False
    sent = {k: v for k, v in sent.items() if now - float(v) < REPEAT_S}
    sent[key] = now
    try:
        os.makedirs(STATE_DIR, exist_ok=True)
        with open(SENT, "w") as f:
            json.dump(sent, f)
    except OSError:
        pass
    return True


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--repo", required=True)
    p.add_argument("--check", required=True)
    p.add_argument("--detail", default="")
    p.add_argument("--where", default="")
    p.add_argument("--ref", default="")
    try:
        a = p.parse_args(argv)
    except SystemExit:
        return 0  # a bad call is never allowed to fail a release
    print(banner(a.repo, a.check, a.detail, a.where, a.ref), file=sys.stderr, flush=True)
    if os.environ.get("MATRX_RELEASE_SCREAM_NO_MAIL") == "1":
        return 0
    to = [t.strip() for t in os.environ.get("MATRX_RELEASE_SCREAM_TO", "").split(",") if t.strip()] or list(SHIP_ALL_LANES)
    key = hashlib.sha1(("%s\n%s\n%s" % (a.repo, a.check, (a.detail or "").splitlines()[0] if a.detail else "")).encode()).hexdigest()
    if not should_mail(key, time.time()):
        print("release-scream: the ship-all lanes were already mailed about this in the last 6 hours.", file=sys.stderr)
        return 0
    msg = ("RELEASE WARNING (pushed anyway) in %s at %s: %s. %s%s — fix the cause; the release path never blocks."
           % (a.repo, a.where or "the release path", a.check, (a.detail or "").strip()[:600],
              (" (ref %s)" % a.ref[:12]) if a.ref else ""))
    for t in to:
        try:
            subprocess.Popen([sys.executable, BOARD, "post", t, msg, "--urgent", "--from", FROM],
                             stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             start_new_session=True)
        except OSError as e:
            print("release-scream: could not start the mail to %s: %s" % (t[:8], e), file=sys.stderr)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # never, ever fail the caller
        print("release-scream crashed (%s); the release continues." % e, file=sys.stderr)
        sys.exit(0)
