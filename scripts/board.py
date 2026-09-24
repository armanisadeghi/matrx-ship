#!/usr/bin/env python3
"""board — the agent message board: /Users/armanisadeghi/code/BOARD.md

  python3 code/scripts/board.py post <conversation id> "<message>" [--urgent] [--from "<who>"]
  python3 code/scripts/board.py deliver          # deliver every urgent message, then clear it
  python3 code/scripts/board.py show

post      adds the message to BOARD.md. --urgent also puts ONE marker line into the files every
          agent reads when it starts (~/.claude/CLAUDE.md and ~/.codex/AGENTS.md), so the next
          agent to start, anywhere, sees it.
deliver   removes the marker FIRST (so only one agent acts), sends each urgent message with
          agent-message.py, deletes each delivered line. A message that could not be delivered
          stays on the board with the reason, and the marker goes back so the next agent retries.
"""
import datetime
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.realpath(__file__))
BOARD = os.environ.get("MATRX_BOARD") or os.path.join(os.path.dirname(os.path.dirname(HERE)), "BOARD.md")   # code/BOARD.md
SEND = os.path.join(HERE, "agent-message.py")
MARKER_FILES = (os.environ["MATRX_BOARD_MARKER_FILES"].split(":") if os.environ.get("MATRX_BOARD_MARKER_FILES")
                else [os.path.expanduser("~/.claude/CLAUDE.md"), os.path.expanduser("~/.codex/AGENTS.md")])   # env: tests only
MARKER = ("URGENT BOARD MESSAGE: run `python3 /Users/armanisadeghi/code/scripts/board.py deliver` "
          "before anything else (it removes this line).")
HEADER = """# Agent message board

Messages for specific AI conversations on this Mac (Claude Code sessions, Codex threads).
Post: `python3 /Users/armanisadeghi/code/scripts/board.py post <conversation id> "<message>" [--urgent]`
Urgent messages are delivered by the first agent that starts and sees the marker in its
CLAUDE.md / AGENTS.md: `python3 /Users/armanisadeghi/code/scripts/board.py deliver`.
A delivered message is deleted. Nothing is kept here once handled.

## Urgent

## Messages
"""
LINE = re.compile(r"^- (?P<when>[^|]+) \| to: (?P<to>\S+) \| from: (?P<frm>[^|]*) \| (?P<msg>.*)$")


def read():
    return open(BOARD).read() if os.path.exists(BOARD) else HEADER


def write(text):
    with open(BOARD, "w") as f:
        f.write(text)


def set_marker(on):
    for path in MARKER_FILES:
        text = open(path).read() if os.path.exists(path) else ""
        lines = [l for l in text.splitlines() if l.strip() != MARKER]
        if on:
            lines = [MARKER, ""] + lines if lines else [MARKER]
        new = "\n".join(lines).rstrip("\n") + "\n" if lines else ""
        if new != text:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w") as f:
                f.write(new)


def section_insert(text, heading, line):
    i = text.index(heading) + len(heading)
    j = text.find("\n## ", i)
    j = len(text) if j == -1 else j
    return text[:j].rstrip("\n") + "\n" + line + "\n" + text[j:]


def post(args):
    urgent = "--urgent" in args
    frm = args[args.index("--from") + 1] if "--from" in args else os.environ.get("USER", "?")
    rest = [a for i, a in enumerate(args) if a not in ("--urgent", "--from") and (i == 0 or args[i - 1] != "--from")]
    if len(rest) < 2:
        sys.exit(__doc__)
    to, msg = rest[0], " ".join(rest[1].split())
    when = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    write(section_insert(read(), "## Urgent" if urgent else "## Messages",
                         "- %s | to: %s | from: %s | %s" % (when, to, frm, msg)))
    if urgent:
        set_marker(True)
    print("board: posted%s for %s" % (" URGENT" if urgent else "", to))


FAILED = re.compile(r" — NOT DELIVERED \((\d+)\): .*$")


def deliver():
    set_marker(False)                      # claim first: nobody else acts on the same marker
    text = read()
    if "## Urgent" not in text:
        print("board: nothing urgent.")
        return
    head, _, rest = text.partition("## Urgent")
    body, sep, tail = rest.partition("\n## ")
    kept, gave_up, sent = [], [], 0
    for line in body.splitlines():
        base = FAILED.sub("", line)
        m = LINE.match(base)
        if not m:
            if line.strip():
                kept.append(line)
            continue
        msg = "Message from %s (via the agent board): %s" % (m["frm"].strip(), m["msg"].strip())
        r = subprocess.run([sys.executable, SEND, m["to"], msg], capture_output=True, text=True)
        if r.returncode == 0:
            sent += 1
            out = r.stdout.strip().splitlines()
            print("board: delivered to %s — %s" % (m["to"], out[-1] if out else ""))
            continue
        err = (r.stderr or r.stdout).strip().splitlines()
        reason = err[-1] if err else "unknown"
        tries = int(FAILED.search(line).group(1)) + 1 if FAILED.search(line) else 1
        print("board: could not deliver to %s (attempt %d) — %s" % (m["to"], tries, reason))
        if tries >= 3:                     # stop re-triggering every agent: park it, visibly
            gave_up.append(base + " — GAVE UP after 3 attempts: " + reason)
        else:
            kept.append(base + " — NOT DELIVERED (%d): %s" % (tries, reason))
    new = head + "## Urgent\n" + "".join(l + "\n" for l in kept) + ("\n" + sep.lstrip("\n") + tail if sep else "")
    for line in gave_up:
        new = section_insert(new, "## Messages", line)
    write(new)
    if kept:
        set_marker(True)                   # something is still waiting: the next agent retries
    print("board: %d delivered, %d still waiting, %d given up (moved to Messages)." % (sent, len(kept), len(gave_up)))


def main():
    cmd, args = (sys.argv[1] if len(sys.argv) > 1 else ""), sys.argv[2:]
    if cmd == "post":
        post(args)
    elif cmd == "deliver":
        deliver()
    elif cmd == "show":
        print(read())
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
