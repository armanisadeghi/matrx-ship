#!/usr/bin/env python3
"""board — tell another AI session something, through agent mail (the file board is retired).

  python3 code/scripts/board.py post <conversation id | provider session id (or its first 6+ chars)> "<message>"
                                     [--urgent] [--from "<your conversation id | who you are>"]

post   sends the message into the recipient's direct room on the server (REST door
       POST /api/agent-messages/post, service aidream/services/agent_messaging). Priority is `note`,
       or `urgent` with --urgent (an urgent message wakes an idle Claude Code session, a Matrx 2
       session, and reaches Codex at its next hook). The recipient is an AI Matrx conversation
       id, or a provider session id ("claude 7665566b" works: the leading word is ignored).
       Sender: --from <conversation id> (or env MATRX_CONVERSATION_ID) sends as that session;
       anything else sends as the signed-in person, with "[from <who>]" in front of the text.
list / done   retired. Mail is read by the recipient session itself (agent_messages tool,
       action "read"), and nothing is left to deliver by hand.

Sign-in: the AI Matrx Claude Code plugin's stored token, borrowed READ-ONLY (never refreshed or
rewritten here: Supabase rotates refresh tokens, so refreshing would sign the plugin out). If it
has expired, any running Claude Code session with the plugin refreshes it.
Environment (tests only): MATRX_AGENT_MAIL_URL, MATRX_AUTH_TOKEN.
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

API = os.environ.get("MATRX_API_ENDPOINT", "https://server.app.matrxserver.com/api").rstrip("/")
URL = os.environ.get("MATRX_AGENT_MAIL_URL") or API + "/agent-messages/post"   # organization-free door
SERVICE = "AI Matrx (Claude Code plugin)"
FILE_STORE = os.path.expanduser("~/.matrx/claude-plugin-auth.json")
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
EARLY_S = 30


def token():
    """The Claude plugin's access token, read-only; exits with the reason when unusable."""
    if os.environ.get("MATRX_AUTH_TOKEN"):
        return os.environ["MATRX_AUTH_TOKEN"]
    rec = {}
    if sys.platform == "darwin":
        r = subprocess.run(["security", "find-generic-password", "-s", SERVICE, "-a", API, "-w"],
                           capture_output=True, text=True)
        if r.returncode == 0 and r.stdout.strip():
            try:
                rec = json.loads(r.stdout.strip())
            except ValueError:
                rec = {}
    if not rec:
        try:
            with open(FILE_STORE) as fh:
                rec = (json.load(fh) or {}).get(API, {})
        except (OSError, ValueError):
            rec = {}
    if not rec.get("access_token"):
        sys.exit("board: not signed in. Sign in to the AI Matrx Claude Code plugin (any Claude Code session "
                 "with the plugin does it), then retry.")
    if rec.get("expires_at", 0) - time.time() < EARLY_S:
        sys.exit("board: the plugin's sign-in has expired (this tool never refreshes it). Use any Claude Code "
                 "session with the AI Matrx plugin once, then retry.")
    return rec["access_token"]


def call(body):
    req = urllib.request.Request(
        URL, data=json.dumps(body).encode(), method="POST",
        headers={"Authorization": "Bearer " + token(), "Content-Type": "application/json",
                 "Accept": "application/json", "User-Agent": "matrx-board/2"})   # Cloudflare refuses Python's default
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            detail = json.loads(raw).get("detail", raw)
        except ValueError:
            detail = raw
        if isinstance(detail, dict):
            detail = "%s: %s %s" % (detail.get("error", e.code), detail.get("message", ""), detail.get("remedy", ""))
        sys.exit("board: not delivered (%s): %s" % (e.code, str(detail).strip()[:600]))
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        sys.exit("board: could not reach %s: %s" % (URL, e))


def parse(args):
    """-> (to, message, urgent, from_text). Unknown --title / --app flags are accepted and ignored."""
    value_flags, urgent, rest, opts, i = {"--from", "--title", "--app"}, False, [], {}, 0
    while i < len(args):
        a = args[i]
        if a == "--urgent":
            urgent = True
        elif a in value_flags and i + 1 < len(args):
            opts[a] = args[i + 1]
            i += 1
        else:
            rest.append(a)
        i += 1
    if len(rest) < 2:
        sys.exit(__doc__)
    return rest[0], " ".join(rest[1].split()), urgent, opts.get("--from") or os.environ.get("MATRX_CONVERSATION_ID", "")


def build(to, msg, urgent, who):
    body = {"to": to, "priority": "urgent" if urgent else "note"}
    if UUID.match(who.strip()):
        body.update({"from": who.strip(), "text": msg})
    else:
        body.update({"from": "person", "text": ("[from %s] %s" % (who, msg)) if who else msg})
    return body


def post(args):
    to, msg, urgent, who = parse(args)
    out = call(build(to, msg, urgent, who))
    print("board: delivered%s to %s (%s) — message %s%s" % (
        " URGENT" if urgent else "", out.get("to_label") or to, out.get("to") or to, out.get("message_id"),
        ", already sent before" if out.get("replayed") else ""))
    if out.get("delivery"):
        print("board: " + out["delivery"])


def main():
    cmd, args = (sys.argv[1] if len(sys.argv) > 1 else ""), sys.argv[2:]
    if cmd == "post":
        post(args)
    elif cmd in ("list", "done", "show"):
        sys.exit("board: the file board is retired; there is nothing to list or mark done. Mail is read by the "
                 "recipient session itself (agent_messages tool, action \"read\"). Send with `board.py post`.")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
