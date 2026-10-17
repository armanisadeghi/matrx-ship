#!/usr/bin/env python3
"""board — tell another AI session something, through agent mail (the file board is retired).

  python3 code/scripts/board.py post <conversation id | provider session id (or its first 6+ chars)> "<message>"
                                     [--urgent] [--from "<your conversation id | script name>"]

post   sends the message into the recipient's direct room on the server (REST door
       POST /api/agent-messages/post, service aidream/services/agent_messaging). Priority is `note`,
       or `urgent` with --urgent (an urgent message wakes an idle Claude Code session, a Matrx 2
       session, and reaches Codex at its next hook). The recipient is an AI Matrx conversation
       id, or a provider session id ("claude 7665566b" works: the leading word is ignored).
       Sender: --from <conversation id> (or env MATRX_CONVERSATION_ID) sends as that session.
       Anything else is an AUTOMATED NOTICE, never the person: --from "<script or lane name>"
       (e.g. "ship-all", "frontend release"), else env MATRX_AUTOMATION_LABEL, else the calling
       script's name, else the coding agent's own session (CLAUDE_CODE_SESSION_ID / CODEX_THREAD_ID),
       else an unnamed notice, with a loud warning. The recipient reads "automated notice from <label>".
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


class Refused(Exception):
    """The server refused the post (HTTP error); `.error` is its error code when it named one."""

    def __init__(self, code, error, text):
        super().__init__(text)
        self.code, self.error, self.text = code, error, text


def call(body, fatal=True):
    try:
        return _call(body)
    except Refused as e:
        if not fatal:
            raise
        sys.exit("board: not delivered (%s): %s" % (e.code, e.text))


def _call(body):
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
        error = detail.get("error") if isinstance(detail, dict) else None
        if isinstance(detail, dict):
            detail = "%s: %s %s" % (detail.get("error", e.code), detail.get("message", ""), detail.get("remedy", ""))
        raise Refused(e.code, error, str(detail).strip()[:600])
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


def caller_label():
    """The calling script's name (lint-guard.py -> "lint-guard"); "" for a shell or an agent."""
    try:
        r = subprocess.run(["ps", "-o", "command=", "-p", str(os.getppid())], capture_output=True, text=True)
        args = r.stdout.split()
    except OSError:
        return ""
    for a in args[:3]:
        base = os.path.basename(a)
        if base.endswith((".py", ".sh", ".mjs", ".js")) and base != "board.py":
            return base.rsplit(".", 1)[0]
    return ""


UNNAMED = "board.py (sender not named)"


def automation_label(who):
    """Who an automated notice is from: never the person whose sign-in carries it."""
    label = " ".join((who or os.environ.get("MATRX_AUTOMATION_LABEL") or caller_label()).split())
    return (label or UNNAMED)[:80]


#: The coding agent's own session id, which the server accepts as `from` (a provider session id):
#: an agent that forgot --from still sends as itself, never as an unnamed script.
AGENT_SESSION_ENV = (("CLAUDE_CODE_SESSION_ID", "Claude session"), ("CODEX_THREAD_ID", "Codex session"))


def agent_session():
    """-> (session id, kind) of the coding agent running this command, or None."""
    for var, kind in AGENT_SESSION_ENV:
        value = os.environ.get(var, "").strip()
        if UUID.match(value):
            return value, kind
    return None


def sender(who):
    """-> (from_text, fallback label or None). Explicit --from / env / calling script first; then the
    agent's own session (falling back to a label naming it if the server does not know it)."""
    if who or os.environ.get("MATRX_AUTOMATION_LABEL") or caller_label():
        return who, None
    found = agent_session()
    if found:
        sid, kind = found
        return sid, "%s %s" % (kind, sid[:8])
    return "", None


WARN_UNNAMED = ("board: WARNING: this went out as an UNNAMED automated notice (\"%s\"), so the "
                "recipient cannot tell who wrote it or answer you. Next time name yourself: "
                "--from <your AI Matrx conversation id> (an agent) or --from <script or lane name>." % UNNAMED)


def build(to, msg, urgent, who):
    body = {"to": to, "priority": "urgent" if urgent else "note"}
    if UUID.match(who.strip()):
        body.update({"from": who.strip(), "text": msg})
    else:
        body.update({"from": "automation:" + automation_label(who), "text": msg})
    return body


def post(args):
    to, msg, urgent, who = parse(args)
    who, fallback = sender(who)
    if fallback:
        try:
            out = call(build(to, msg, urgent, who), fatal=False)
        except Refused as e:
            if e.error not in ("not_your_session", "ambiguous_session", "from_required"):
                sys.exit("board: not delivered (%s): %s" % (e.code, e.text))
            # This agent's session is not mirrored to AI Matrx: still never unnamed.
            print("board: your session %s is not known to AI Matrx; sent as an automated notice "
                  "from \"%s\" (pass --from to name yourself)." % (who, fallback), file=sys.stderr)
            out = call(build(to, msg, urgent, fallback))
    else:
        body = build(to, msg, urgent, who)
        out = call(body)
        if body["from"] == "automation:" + UNNAMED:
            print(WARN_UNNAMED, file=sys.stderr)
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
