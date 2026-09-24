#!/usr/bin/env python3
"""agent-message — send a message to an existing Claude Code or Codex conversation, by its id.

Run:  python3 code/scripts/agent-message.py <conversation id> "<message>" [--wait] [--check]

  <conversation id>  a Claude Code session id or a Codex thread id (find-file-sessions.py prints
                     them). The tool is detected from where the transcript lives.
  --wait             wait for the conversation's reply and print it (default: start it in the
                     background and return at once; the reply goes to the log file printed)
  --check            only check that the message COULD be sent (CLI installed, logged in,
                     conversation found); send nothing

How it is delivered
  Codex   A Codex sub-agent is never messaged; its PARENT thread (the one that spawned it) is.
          If the Codex desktop app holds the thread open ("active writer"), the message is put in
          the app's queue with `codex queue`; the app delivers it when that thread's current turn
          ends. Otherwise `codex exec resume <id> "<message>"` runs the turn directly.
  Claude  `claude -p --resume <id> "<message>"` in the conversation's own folder, with
          --permission-mode acceptEdits (it can edit files; nothing interactive can be asked).

Every send is logged to ~/.matrx/agent-messages/<time>_<id>.log.
Exit 0 sent (or check passed), 1 could not send — the printed reason says how to fix it.
"""
import datetime
import glob
import json
import os
import shutil
import subprocess
import sys
from typing import NoReturn

CLAUDE_DIR = os.path.expanduser("~/.claude/projects")
CODEX_DIR = os.path.expanduser("~/.codex/sessions")
CODEX_LOCKS = os.path.expanduser("~/.codex/thread-writer-locks")
LOG_DIR = os.path.expanduser("~/.matrx/agent-messages")


def fail(msg) -> NoReturn:
    print("agent-message: NOT SENT — " + msg, file=sys.stderr)
    sys.exit(1)


def find_claude(sid):
    hits = glob.glob(os.path.join(CLAUDE_DIR, "*", sid + ".jsonl"))
    if not hits:
        return None
    cwd = ""
    with open(hits[0], errors="replace") as f:
        for line in f:
            if '"cwd"' in line:
                try:
                    cwd = json.loads(line).get("cwd") or ""
                except ValueError:
                    continue
                if cwd:
                    break
    return {"tool": "claude", "id": sid, "file": hits[0], "cwd": cwd}


def find_codex(tid):
    hits = glob.glob(os.path.join(CODEX_DIR, "**", "*%s.jsonl" % tid), recursive=True)
    if not hits:
        return None
    with open(hits[0], errors="replace") as f:
        meta = (json.loads(f.readline()).get("payload") or {})
    return {"tool": "codex", "id": tid, "file": hits[0], "cwd": meta.get("cwd") or "",
            "parent": meta.get("parent_thread_id") or "", "nickname": meta.get("agent_nickname") or ""}


def codex_thread_is_held(tid):
    """True when another process (normally the Codex desktop app) holds the thread's writer lock."""
    lock = os.path.join(CODEX_LOCKS, tid + ".lock")
    if not os.path.exists(lock):
        return False
    r = subprocess.run(["lsof", "-t", lock], capture_output=True, text=True)
    return bool(r.stdout.strip())


def preflight(tool):
    if tool == "codex":
        if not shutil.which("codex"):
            fail("the Codex command line is not installed. Fix: npm install -g @openai/codex")
        r = subprocess.run(["codex", "login", "status"], capture_output=True, text=True)
        if r.returncode != 0 or "Logged in" not in (r.stdout + r.stderr):
            fail("the Codex command line is not logged in. Fix (needs a person, opens a browser): codex login")
    else:
        if not shutil.which("claude"):
            fail("the Claude Code command line is not installed. Fix: curl -fsSL https://claude.ai/install.sh | bash")
        r = subprocess.run(["claude", "auth", "status"], capture_output=True, text=True)
        try:
            ok = json.loads(r.stdout).get("loggedIn")
        except ValueError:
            ok = False
        if not ok and not os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"):
            fail("the Claude Code command line is not logged in. Fix (needs a person, opens a browser): "
                 "claude setup-token  — a long-lived login for automation — or: claude auth login")


def main():
    args = sys.argv[1:]
    wait, check = "--wait" in args, "--check" in args
    rest = [a for a in args if a not in ("--wait", "--check")]
    if len(rest) < (1 if check else 2):
        sys.exit(__doc__)
    cid, message = rest[0], (rest[1] if len(rest) > 1 else "")

    target = find_claude(cid) or find_codex(cid)
    if not target:
        fail("no Claude Code or Codex conversation has the id %s. Find ids with: "
             "python3 code/scripts/find-file-sessions.py <file>" % cid)
    if target["tool"] == "codex" and target.get("parent"):
        parent = find_codex(target["parent"])
        print("agent-message: %s is a Codex sub-agent (%s); messaging the thread that spawned it: %s"
              % (cid, target.get("nickname") or "?", target["parent"]))
        if not parent:
            fail("the parent thread %s has no transcript on this machine." % target["parent"])
        target = parent
    preflight(target["tool"])
    cwd = target["cwd"] if target["cwd"] and os.path.isdir(target["cwd"]) else os.path.expanduser("~")

    if target["tool"] == "codex":
        if codex_thread_is_held(target["id"]):
            how = "queue"
            cmd = ["codex", "queue", "--thread", target["id"], "--message", message]
        else:
            how = "resume"
            cmd = ["codex", "exec", "resume", "--skip-git-repo-check", target["id"], message]
    else:
        how = "resume"
        cmd = ["claude", "-p", "--resume", target["id"], "--permission-mode", "acceptEdits", message]

    if check:
        print("agent-message: OK — would send to %s conversation %s by %s (folder %s)"
              % (target["tool"], target["id"], how, cwd))
        return

    os.makedirs(LOG_DIR, exist_ok=True)
    log = os.path.join(LOG_DIR, "%s_%s.log" % (datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S"), target["id"]))
    with open(log, "w") as f:
        f.write("to: %s %s (by %s, folder %s)\nmessage:\n%s\n\n--- reply ---\n" % (
            target["tool"], target["id"], how, cwd, message))
    if how == "queue" or wait:
        with open(log, "a") as f:
            r = subprocess.run(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            f.write(r.stdout)
        if r.returncode != 0:
            fail("%s exited %d:\n%s\nlog: %s" % (" ".join(cmd[:3]), r.returncode, r.stdout[-1500:], log))
        if how == "queue":
            print("agent-message: QUEUED for %s thread %s — the Codex app has it open and delivers it when "
                  "its current turn ends. log: %s" % (target["tool"], target["id"], log))
        else:
            print(r.stdout.rstrip())
            print("agent-message: SENT to %s %s; reply above. log: %s" % (target["tool"], target["id"], log))
        return
    with open(log, "a") as f:
        subprocess.Popen(cmd, cwd=cwd, stdout=f, stderr=subprocess.STDOUT, start_new_session=True)
    print("agent-message: SENT to %s %s (running in the background; its reply lands in %s)"
          % (target["tool"], target["id"], log))


if __name__ == "__main__":
    main()
