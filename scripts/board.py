#!/usr/bin/env python3
"""board — the agent message board: /Users/armanisadeghi/code/BOARD.md

  python3 code/scripts/board.py post <conversation id> "<message>" [--title "<its title>"] [--app claude|codex] [--urgent] [--from "<who>"]
  python3 code/scripts/board.py list
  python3 code/scripts/board.py done <number>

An agent can only message conversations in its OWN app instance (Claude: SendMessage /
ListAgents; Codex: its send-to-thread tool). So delivery is "friendly community" help:

post   adds the message. --urgent also puts ONE marker line into the files every agent reads
       when it starts (~/.claude/CLAUDE.md and ~/.codex/AGENTS.md).
list   shows the urgent messages, numbered. An urgent message older than 24 hours is moved to
       Messages (nobody could reach it), so the marker never lingers.
done   deletes urgent message <number> — run it the moment you have delivered it. When no urgent
       message is left, the marker is removed from both files, for everyone.
"""
import datetime
import os
import re
import sys

HERE = os.path.dirname(os.path.realpath(__file__))
BOARD = os.environ.get("MATRX_BOARD") or os.path.join(os.path.dirname(os.path.dirname(HERE)), "BOARD.md")
MARKER_FILES = (os.environ["MATRX_BOARD_MARKER_FILES"].split(":") if os.environ.get("MATRX_BOARD_MARKER_FILES")
                else [os.path.expanduser("~/.claude/CLAUDE.md"), os.path.expanduser("~/.codex/AGENTS.md")])   # env: tests only
MARKER = ("URGENT MESSAGE WAITING: run `python3 /Users/armanisadeghi/code/scripts/board.py list`. If its "
          "recipient is in your own session list, message it, then run `board.py done <number>` at once "
          "(that removes this line for everyone).")
HEADER = """# Agent message board

Messages for specific AI conversations. An agent can only message conversations in its own app
instance, so any agent that CAN reach the recipient delivers it, then runs `board.py done <number>`.
Commands: `python3 /Users/armanisadeghi/code/scripts/board.py post | list | done`.
Nothing is kept here once delivered.

## Urgent

## Messages
"""
WHEN = re.compile(r"^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) \|")
STALE_HOURS = 24


def read():
    return open(BOARD).read() if os.path.exists(BOARD) else HEADER


def write(text):
    with open(BOARD, "w") as f:
        f.write(text)


def set_marker(on):
    for path in MARKER_FILES:
        text = open(path).read() if os.path.exists(path) else ""
        lines = text.splitlines()
        while MARKER in [l.strip() for l in lines]:            # remove the marker AND the blank line it added
            i = [l.strip() for l in lines].index(MARKER)
            del lines[i:i + (2 if i + 1 < len(lines) and not lines[i + 1].strip() else 1)]
        if on:
            lines = [MARKER, ""] + lines if lines else [MARKER]
        new = "\n".join(lines).rstrip("\n") + "\n" if lines else ""
        if new != text:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w") as f:
                f.write(new)


def split(text):
    """(everything up to and including '## Urgent', urgent item lines, rest from '## Messages')."""
    head, _, rest = text.partition("## Urgent\n")
    body, sep, tail = rest.partition("## Messages")
    items = [l for l in body.splitlines() if l.startswith("- ")]
    return head + "## Urgent\n", items, sep + tail


def join(head, items, tail):
    return head + "".join(l + "\n" for l in items) + "\n" + tail


def post(args):
    def opt(name):
        return args[args.index(name) + 1] if name in args else ""
    urgent = "--urgent" in args
    flags = {"--title", "--app", "--from"}
    rest = [a for i, a in enumerate(args) if a not in flags | {"--urgent"} and (i == 0 or args[i - 1] not in flags)]
    if len(rest) < 2:
        sys.exit(__doc__)
    to, msg = rest[0], " ".join(rest[1].split())
    who = "%s %s%s" % (opt("--app") or "?", to, (' "%s"' % opt("--title")) if opt("--title") else "")
    line = "- %s | to: %s | from: %s | %s" % (
        datetime.datetime.now().strftime("%Y-%m-%d %H:%M"), who, opt("--from") or os.environ.get("USER", "?"), msg)
    text = read()
    if urgent:
        head, items, tail = split(text)
        write(join(head, items + [line], tail))
        set_marker(True)
    else:
        write(text.rstrip("\n") + "\n" + line + "\n")
    print("board: posted%s for %s" % (" URGENT" if urgent else "", who))


def expire(items, tail):
    """Move urgent items older than STALE_HOURS to Messages."""
    now, keep, old = datetime.datetime.now(), [], []
    for l in items:
        m = WHEN.match(l)
        age = (now - datetime.datetime.strptime(m.group(1), "%Y-%m-%d %H:%M")).total_seconds() / 3600 if m else 0
        (old if age > STALE_HOURS else keep).append(l)
    for l in old:
        tail = tail.rstrip("\n") + "\n" + l + " — NOT DELIVERED within %dh (nobody could reach it)\n" % STALE_HOURS
    return keep, tail, len(old)


def list_cmd():
    head, items, tail = split(read())
    items, tail, moved = expire(items, tail)
    write(join(head, items, tail))
    if moved:
        print("board: %d urgent message(s) older than %dh moved to Messages." % (moved, STALE_HOURS))
    if not items:
        set_marker(False)
        print("board: no urgent messages.")
        return
    for n, l in enumerate(items, 1):
        print("%d. %s" % (n, l[2:]))


def done(args):
    head, items, tail = split(read())
    try:
        n = int(args[0])
        items.pop(n - 1)
    except (IndexError, ValueError):
        sys.exit("board: done needs the number shown by `board.py list`.")
    write(join(head, items, tail))
    if not items:
        set_marker(False)
    print("board: removed message %d; %d urgent left%s." % (n, len(items), "" if items else ", marker removed"))


def main():
    cmd, args = (sys.argv[1] if len(sys.argv) > 1 else ""), sys.argv[2:]
    {"post": lambda: post(args), "list": list_cmd, "done": lambda: done(args),
     "show": lambda: print(read())}.get(cmd, lambda: sys.exit(__doc__))()


if __name__ == "__main__":
    main()
