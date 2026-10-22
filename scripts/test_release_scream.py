#!/usr/bin/env python3
"""release-scream.py: --title, and a key is marked sent only after the mail really went (2026-10-22).

Runs a COPY of release-scream.py in a scratch HOME with a stand-in board.py beside it (no real mail is
ever sent, whichever version is under test):
  1. --title "NOT PUSHED" puts NOT PUSHED in the banner, never PUSHED ANYWAY;
  2. a failed send (board.py exit 1, e.g. an expired token) is NOT marked sent; it is logged to
     failed.log and kept pending;
  3. the next scream (any check) retries it: once board.py exits 0 the key is marked sent;
  4. a repeat of a delivered scream within 6 hours mails nobody.

Run:  python3 ~/code/matrx-ship/scripts/test_release_scream.py
      RELEASE_SCREAM_PATH=<old copy> ... runs the same proof against another version (fail-before).
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.realpath(__file__))
SCRIPT = os.environ.get("RELEASE_SCREAM_PATH") or os.path.join(HERE, "release-scream.py")

FAKE_BOARD = r'''#!/usr/bin/env python3
import json, os, sys
root = os.path.dirname(os.path.realpath(__file__))
rc = int(open(os.path.join(root, "board_rc")).read().strip() or 0)
with open(os.path.join(root, "board_calls.jsonl"), "a") as f:
    f.write(json.dumps({"argv": sys.argv[1:], "rc": rc}) + "\n")
if rc:
    print("token expired (planted)", file=sys.stderr)
sys.exit(rc)
'''


def main():
    tmp = os.path.realpath(tempfile.mkdtemp(prefix="release-scream-test-"))
    failures = []

    def expect(cond, what, got=""):
        print(("ok   " if cond else "FAIL ") + what)
        if not cond:
            failures.append("%s\n    got: %s" % (what, str(got)[:600]))

    try:
        bindir, home = os.path.join(tmp, "bin"), os.path.join(tmp, "home")
        os.makedirs(bindir)
        os.makedirs(home)
        shutil.copy(SCRIPT, os.path.join(bindir, "release-scream.py"))
        with open(os.path.join(bindir, "board.py"), "w") as f:
            f.write(FAKE_BOARD)
        state = os.path.join(home, ".matrx", "release-scream")
        calls = os.path.join(bindir, "board_calls.jsonl")
        env = {k: v for k, v in os.environ.items() if not k.startswith("MATRX_RELEASE_SCREAM")}
        env.update(HOME=home, MATRX_RELEASE_SCREAM_TO="lane-a", MATRX_RELEASE_SCREAM_WAIT="1",
                   MATRX_RELEASE_SCREAM_BOARD=os.path.join(bindir, "board.py"), MATRX_RELEASE_SCREAM_STATE_DIR=state)

        def set_rc(rc):
            with open(os.path.join(bindir, "board_rc"), "w") as f:
                f.write(str(rc))

        def scream(*args):
            r = subprocess.run([sys.executable, os.path.join(bindir, "release-scream.py"), "--repo", "r", *args],
                               env=env, capture_output=True, text=True, timeout=120)
            time.sleep(0.5)  # a version without MATRX_RELEASE_SCREAM_WAIT still gets its detached child time
            return r

        def board_calls():
            try:
                return [json.loads(l) for l in open(calls)]
            except OSError:
                return []

        def sent():
            try:
                return json.load(open(os.path.join(state, "sent.json")))
            except (OSError, ValueError):
                return {}

        r = scream("--check", "sync", "--detail", "merge conflict", "--title", "NOT PUSHED")
        expect("RELEASE WARNING — NOT PUSHED" in r.stderr and "PUSHED ANYWAY" not in r.stderr,
               '--title "NOT PUSHED" heads the banner, never PUSHED ANYWAY', r.stderr[-400:])

        set_rc(1)
        if os.path.exists(calls):
            os.remove(calls)
        shutil.rmtree(state, ignore_errors=True)
        scream("--check", "settings ratchet", "--detail", "unbaselined setting")
        expect(len(board_calls()) == 1 and board_calls()[0]["rc"] == 1, "the failing mail door was really tried once", board_calls())
        expect(sent() == {}, "a failed send is NOT marked sent", sent())
        log = os.path.join(state, "failed.log")
        expect(os.path.exists(log) and "token expired" in open(log).read(), "a failed send is logged to failed.log",
               open(log).read() if os.path.exists(log) else "(no failed.log)")

        set_rc(0)
        scream("--check", "another check", "--detail", "x")
        msgs = [c["argv"][2] for c in board_calls() if c["rc"] == 0]
        expect(any("settings ratchet" in m for m in msgs) and any("another check" in m for m in msgs),
               "the next scream retries the failed send and sends its own", msgs)
        expect(len(sent()) == 2, "both keys are marked sent once board.py exited 0", sent())

        before = len(board_calls())
        r = scream("--check", "settings ratchet", "--detail", "unbaselined setting")
        expect(len(board_calls()) == before and "already mailed" in r.stderr,
               "a repeat within 6 hours mails nobody", board_calls()[before:])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    if failures:
        print("\nrelease-scream proof FAILED:\n" + "\n".join(failures))
        return 1
    print("release-scream proof: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
