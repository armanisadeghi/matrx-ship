#!/usr/bin/env python3
"""find-file-sessions — which Claude Code and Codex conversations edited a file recently.

Run:  python3 matrx-ship/scripts/find-file-sessions.py [--days N] [--json] <file path>

Reads the local transcripts (Claude Code: ~/.claude/projects/**/*.jsonl, Codex:
~/.codex/sessions/**/*.jsonl) changed in the last N days (default 3) and lists every
conversation that EDITED the file (Claude Edit / Write / MultiEdit / NotebookEdit; a Codex
patch naming it), newest first, with: tool, conversation id, title, when it last edited the
file, how many edits, and the working folder. Conversations that only mention the path in a
tool call are listed after them as "mentioned".

To reach a conversation:
  Claude Code  the id is the session id (claude --resume <id>; desktop sessions by title)
  Codex        the id is the thread id; the title is the thread name in the Codex app. A
               sub-agent is listed with the thread that spawned it ("parent"), which is the
               conversation that owns the work.
"""
import datetime
import json
import os
import subprocess
import sys
import time

CLAUDE_DIR = os.path.expanduser("~/.claude/projects")
CODEX_DIR = os.path.expanduser("~/.codex/sessions")
CODEX_INDEX = os.path.expanduser("~/.codex/session_index.jsonl")
CLAUDE_EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}


def recent_files(root, days):
    cutoff = time.time() - days * 86400
    out = []
    for d, _, files in os.walk(root):
        for f in files:
            if f.endswith(".jsonl"):
                p = os.path.join(d, f)
                try:
                    if os.path.getmtime(p) >= cutoff:
                        out.append(p)
                except OSError:
                    pass
    return out


def grep_files(files, needle):
    """The subset of files containing needle (fast prefilter with grep)."""
    hits = []
    for i in range(0, len(files), 200):
        r = subprocess.run(["grep", "-lF", "-e", needle, "--"] + files[i:i + 200],
                           capture_output=True, text=True)
        hits += [l for l in r.stdout.splitlines() if l]
    return hits


def short_time(ts):
    try:
        t = datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))
        return t.astimezone().strftime("%Y-%m-%d %H:%M")
    except (ValueError, AttributeError):
        return ts or "?"


def first_prompt(path):
    """The first thing the user typed in a transcript, as a fallback title."""
    try:
        with open(path, errors="replace") as f:
            for n, line in enumerate(f):
                if n > 400:
                    break
                if '"user"' not in line:
                    continue
                try:
                    e = json.loads(line)
                except ValueError:
                    continue
                msg = e.get("message") or (e.get("payload") if (e.get("payload") or {}).get("role") == "user" else None)
                if not msg or msg.get("role", e.get("type")) not in ("user",):
                    continue
                content = msg.get("content")
                texts = [content] if isinstance(content, str) else [
                    c.get("text", "") for c in (content or []) if isinstance(c, dict)]
                for t in texts:
                    t = " ".join(t.split())
                    if t and not t.startswith(("<", "#")) and "AGENTS.md" not in t[:200]:
                        return "(first prompt) " + t[:80]
    except OSError:
        pass
    return ""


def claude_sessions(abs_path, rel_path, days):
    found = {}
    for p in grep_files(recent_files(CLAUDE_DIR, days), rel_path):
        sid, title, cwd, edits, last_edit, mentioned = None, "", "", 0, "", False
        for line in open(p, errors="replace"):
            if rel_path not in line and '"custom-title"' not in line:
                continue
            try:
                e = json.loads(line)
            except ValueError:
                continue
            sid = e.get("sessionId") or sid
            if e.get("type") == "custom-title":
                title = e.get("customTitle") or title
                continue
            content = (e.get("message") or {}).get("content")
            if not isinstance(content, list):
                continue
            for c in content:
                if not isinstance(c, dict) or c.get("type") != "tool_use":
                    continue
                inp = c.get("input") or {}
                target = inp.get("file_path") or inp.get("notebook_path") or ""
                if c.get("name") in CLAUDE_EDIT_TOOLS and (target == abs_path or target.endswith("/" + rel_path)):
                    edits += 1
                    last_edit = max(last_edit, e.get("timestamp", ""))
                    cwd = e.get("cwd") or cwd
                elif rel_path in json.dumps(inp):
                    mentioned = True
                    cwd = e.get("cwd") or cwd
        sid = sid or os.path.basename(p)[:-6]
        if edits or mentioned:
            found[sid] = {"tool": "claude", "session": sid, "title": title or first_prompt(p), "edits": edits,
                          "last": short_time(last_edit) if last_edit else "", "cwd": cwd,
                          "kind": "edited" if edits else "mentioned", "_sort": last_edit}
    return list(found.values())


def codex_titles():
    titles = {}
    if os.path.exists(CODEX_INDEX):
        for line in open(CODEX_INDEX, errors="replace"):
            try:
                e = json.loads(line)
                titles[e["id"]] = e.get("thread_name", "")
            except (ValueError, KeyError):
                pass
    return titles


def codex_meta(path):
    """(parent_thread_id, agent nickname) from a Codex transcript's first line (session_meta)."""
    try:
        with open(path, errors="replace") as f:
            e = json.loads(f.readline())
        pl = e.get("payload") or {}
        return pl.get("parent_thread_id") or "", pl.get("agent_nickname") or ""
    except (OSError, ValueError):
        return "", ""


def codex_sessions(abs_path, rel_path, days):
    titles = codex_titles()
    found = []
    markers = ["File: " + abs_path, "File: " + rel_path]
    for p in grep_files(recent_files(CODEX_DIR, days), rel_path):
        sid = os.path.basename(p)[:-6][-36:]
        edits, last_edit, mentioned, cwd = 0, "", False, ""
        for line in open(p, errors="replace"):
            if rel_path not in line:
                continue
            try:
                e = json.loads(line)
            except ValueError:
                continue
            pl = e.get("payload") or {}
            if pl.get("type") not in ("function_call", "custom_tool_call", "local_shell_call"):
                if pl.get("type") == "turn_context":
                    cwd = pl.get("cwd") or cwd
                continue
            args = str(pl.get("arguments") or pl.get("input") or pl.get("action") or "")
            if any(m in args for m in markers):
                edits += 1
                last_edit = max(last_edit, e.get("timestamp", ""))
            elif rel_path in args:
                mentioned = True
        if edits or mentioned:
            parent, nick = codex_meta(p)
            title = titles.get(sid) or first_prompt(p)
            if parent:
                # a sub-agent: the conversation to reach is the one that spawned it
                title = "sub-agent %s of %s (%s)" % (nick or "?", parent, titles.get(parent) or "untitled")
            found.append({"tool": "codex", "session": sid, "title": title, "edits": edits,
                          "last": short_time(last_edit) if last_edit else "", "cwd": cwd,
                          "parent": parent, "kind": "edited" if edits else "mentioned", "_sort": last_edit})
    return found


def main():
    args = sys.argv[1:]
    as_json = "--json" in args
    days = int(args[args.index("--days") + 1]) if "--days" in args else 3
    paths = [a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or args[i - 1] != "--days")]
    if not paths:
        sys.exit(__doc__)
    abs_path = os.path.abspath(paths[0])
    top = subprocess.run(["git", "-C", os.path.dirname(abs_path), "rev-parse", "--show-toplevel"],
                         capture_output=True, text=True).stdout.strip()
    rel_path = os.path.relpath(abs_path, top) if top else os.path.basename(abs_path)

    rows = claude_sessions(abs_path, rel_path, days) + codex_sessions(abs_path, rel_path, days)
    rows.sort(key=lambda r: r["_sort"], reverse=True)       # newest edit first (ISO timestamps)
    rows.sort(key=lambda r: r["kind"] != "edited")         # edited before mentioned; stable
    for r in rows:
        r.pop("_sort", None)
    if as_json:
        print(json.dumps(rows, indent=2))
        return
    if not rows:
        print("No Claude Code or Codex conversation touched %s in the last %d day(s)." % (rel_path, days))
        return
    print("Conversations that touched %s (last %d day(s)), newest edit first:" % (rel_path, days))
    for r in rows:
        print("  %-9s %-6s %-38s %-17s edits=%-3d %s" % (
            r["kind"], r["tool"], r["session"], r["last"] or "-", r["edits"], r["title"][:60]))


if __name__ == "__main__":
    main()
