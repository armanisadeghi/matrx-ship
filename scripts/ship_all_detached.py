#!/usr/bin/env python3
"""ship_all_detached — run ONE ship-all round that outlives whoever started it.

THE ROUND OUTLIVES ITS CALLER (2026-10-21). Every ship-all round used to run as a child of the agent
turn that started it. From 14:17 to 20:08 PDT no round finished: a Codex turn interrupted at 19:14
took round 19-01-15 with it mid-way through the matrx-frontend package trial, owners TERM-stopped
each other's "duplicate" rounds (18-46-42, 18-59-10), a host timeout ended others. Each death left
no release, no summary.json and a half-built trial tree, and the next round started from scratch.
matrx-frontend did not release for 5 h 16 min.

Now ship-all.sh runs this:
  - ONE ROUND AT A TIME. A round holds ~/.matrx/ship-all/round.lock for its whole run. A second
    caller does not start a duplicate: it follows the running round's output and returns its exit
    code. So there is never a "duplicate sweep" to stop.
  - THE ROUND IS NOT THE CALLER'S CHILD. It is double-forked into its own session (parent: launchd),
    so a turn abort, a tool timeout, a process-tree kill or `kill -TERM -<pgid>` of the caller ends
    only the caller's view of it. Stopping a round is a deliberate `kill <pid>` of the pid it prints.
  - THE CALLER SEES THE SAME OUTPUT. It streams the round's output file live and exits with the
    round's exit code; a round that ended without one is announced, never silent.
  - A SILENT ROUND IS ANNOUNCED. No output for SILENT_ALARM_SECONDS prints one alarm line naming the
    round's pid and output file (nothing is killed).

MATRX_SHIP_ALL_ATTACHED=1 runs the round in the foreground instead (the old behaviour).
Files: ~/.matrx/ship-all/round.lock, round.json (the running round), rounds/<stamp>.out and .rc.
"""
import datetime
import fcntl
import json
import os
import signal
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.realpath(__file__))
SHIP_ALL = os.path.join(HERE, "ship_all.py")
OUT_ROOT = os.environ.get("MATRX_SHIP_ALL_ROOT") or os.path.expanduser("~/.matrx/ship-all")
LOCK = os.path.join(OUT_ROOT, "round.lock")
ROUND = os.path.join(OUT_ROOT, "round.json")
SILENT_ALARM_SECONDS = int(os.environ.get("MATRX_SHIP_ALL_SILENT_ALARM", str(40 * 60)))
POLL = float(os.environ.get("MATRX_SHIP_ALL_POLL", "1"))


def code_dir():
    """The code folder (ship_all.workspace_root): $MATRX_CODE_DIR, else ~/code, else two above this
    script. Never ship's own location first: ship moves into aidream/infra/matrx-ship."""
    env = os.environ.get("MATRX_CODE_DIR")
    if env:
        return os.path.abspath(os.path.expanduser(env))
    home = os.path.expanduser("~/code")
    return home if os.path.isdir(home) else os.path.dirname(os.path.dirname(HERE))


def say(msg):
    sys.stdout.write(msg + "\n")
    sys.stdout.flush()


def lock_is_free():
    """True when no round holds round.lock (checked without keeping it)."""
    fd = os.open(LOCK, os.O_RDWR | os.O_CREAT, 0o644)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(fd, fcntl.LOCK_UN)
        return True
    except OSError:
        return False
    finally:
        os.close(fd)


def read_round():
    try:
        with open(ROUND) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def start_round(args):
    """Take round.lock, double-fork the supervisor into its own session. Returns the round record,
    or None when another round holds the lock."""
    fd = os.open(LOCK, os.O_RDWR | os.O_CREAT, 0o644)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        os.close(fd)
        return None
    stamp = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    rounds = os.path.join(OUT_ROOT, "rounds")
    os.makedirs(rounds, exist_ok=True)
    out = os.path.join(rounds, "%s_%d.out" % (stamp, os.getpid()))
    rec = {"out": out, "rc": out[:-4] + ".rc", "started": stamp, "argv": args,
           "started_by_pid": os.getpid(), "pid": None}
    open(out, "w").close()
    r, w = os.pipe()
    first = os.fork()
    if first == 0:                                   # child: new session, fork again, exit
        os.close(r)
        os.setsid()
        if os.fork() != 0:
            os._exit(0)
        supervise(fd, rec, w, args)                  # grandchild: never returns
    os.close(w)
    os.waitpid(first, 0)
    pid = os.read(r, 32).decode().strip()
    os.close(r)
    os.close(fd)                                     # the supervisor's copy keeps the lock held
    rec["pid"] = int(pid) if pid.isdigit() else None
    written = read_round()
    return written if written.get("out") == rec["out"] else rec


def supervise(fd, rec, w, args):
    """The detached supervisor: run ship_all.py, record its exit code, release the lock."""
    try:
        rec["pid"], rec["pgid"] = os.getpid(), os.getpgrp()
        tmp = ROUND + ".tmp"
        with open(tmp, "w") as f:
            json.dump(rec, f)
        os.replace(tmp, ROUND)
        os.write(w, str(os.getpid()).encode())
        os.close(w)
        devnull = os.open(os.devnull, os.O_RDONLY)
        os.dup2(devnull, 0)
        out = os.open(rec["out"], os.O_WRONLY | os.O_APPEND)
        os.dup2(out, 1)
        os.dup2(out, 2)
        env = dict(os.environ, MATRX_SHIP_ALL_DETACHED="1", PYTHONUNBUFFERED="1")
        cmd = [sys.executable, SHIP_ALL] + args
        if os.environ.get("MATRX_SHIP_ALL_TEST_CMD"):
            cmd = ["bash", "-c", os.environ["MATRX_SHIP_ALL_TEST_CMD"]]

        def stopped(signum, _frame):
            # A deliberate `kill <pid>` of the round stops the whole round, never only its supervisor.
            signal.signal(signal.SIGTERM, signal.SIG_IGN)
            print("\nship-all: round %s STOPPED by signal %d (kill %s); the steps running now were "
                  "stopped too." % (rec["started"], signum, os.getpid()), flush=True)
            os.killpg(0, signal.SIGTERM)
            with open(rec["rc"], "w") as f:
                f.write(str(128 + signum))
            fcntl.flock(fd, fcntl.LOCK_UN)
            os._exit(0)

        signal.signal(signal.SIGTERM, stopped)
        signal.signal(signal.SIGINT, stopped)
        signal.signal(signal.SIGHUP, signal.SIG_IGN)
        rc = subprocess.call(cmd, cwd=code_dir(), env=env)
        with open(rec["rc"], "w") as f:
            f.write(str(rc))
    finally:
        try:
            fcntl.flock(fd, fcntl.LOCK_UN)
        finally:
            os._exit(0)


def follow(rec, joined):
    """Stream the round's output until it ends; return its exit code (1 when it ended without one)."""
    if joined:
        say("ship-all: a round is already running (pid %s, started %s): following it instead of "
            "starting a second one. Output: %s" % (rec.get("pid"), rec.get("started"), rec.get("out")))
    else:
        say("ship-all: round %s runs detached as pid %s (it keeps running if this caller ends; stop it "
            "only with `kill %s`). Output: %s" % (rec["started"], rec["pid"], rec["pid"], rec["out"]))
    pos, last_growth, alarmed = 0, time.time(), False
    while True:
        try:
            with open(rec["out"], "rb") as f:
                f.seek(pos)
                chunk = f.read()
        except OSError:
            chunk = b""
        if chunk:
            pos += len(chunk)
            sys.stdout.write(chunk.decode("utf-8", "replace"))
            sys.stdout.flush()
            last_growth, alarmed = time.time(), False
        if os.path.exists(rec["rc"]):
            with open(rec["out"], "rb") as f:
                f.seek(pos)
                rest = f.read()
            if rest:
                sys.stdout.write(rest.decode("utf-8", "replace"))
            try:
                with open(rec["rc"]) as f:
                    return int(f.read().strip() or 1)
            except (OSError, ValueError):
                return 1
        if lock_is_free() and not os.path.exists(rec["rc"]):
            say("\nship-all: ROUND ENDED WITHOUT A RESULT — round %s (pid %s) is gone and wrote no exit "
                "code (it was killed). Nothing after its last line above ran. Run ship-all again."
                % (rec.get("started"), rec.get("pid")))
            return 1
        if not alarmed and time.time() - last_growth >= SILENT_ALARM_SECONDS:
            say("ship-all: ROUND SILENT for %d min — round %s (pid %s) has printed nothing since; it may be "
                "hung in a child step (ps -axo pid,pgid,etime,command | awk '$2==%s'). Nothing was stopped." % (
                    SILENT_ALARM_SECONDS // 60, rec.get("started"), rec.get("pid"), rec.get("pgid")))
            alarmed = True
        time.sleep(POLL)


def main(args):
    os.makedirs(OUT_ROOT, exist_ok=True)
    rec = start_round(args)
    joined = rec is None
    if joined:
        for _ in range(50):                          # a round that just started writes round.json first
            rec = read_round()
            if rec.get("out") and not os.path.exists(rec.get("rc", "")):
                break
            time.sleep(0.1)
        if not rec.get("out"):
            say("ship-all: round.lock is held but round.json names no round; check `lsof %s`." % LOCK)
            return 1
    return follow(rec, joined)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
