#!/usr/bin/env python3
"""find-file-sessions — which Claude Code and Codex conversations edited a file recently.

Run:  python3 matrx-ship/scripts/find-file-sessions.py [--days N] [--json] <file path> [<file path> ...]
      (any number of files, one pass over the transcripts; --json prints {file: [rows]})

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


CODEX_RG = ("/opt/homebrew/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/"
            "vendor/aarch64-apple-darwin/codex-path/rg")


def ripgrep():
    """ripgrep scans the transcripts ~30x faster than macOS grep (6 s vs 180 s for 11 GB)."""
    import shutil
    found = shutil.which("rg") or (CODEX_RG if os.access(CODEX_RG, os.X_OK) else None)
    if not found and not getattr(ripgrep, "warned", False):
        ripgrep.warned = True
        print("find-file-sessions: ripgrep not found, using the slow macOS grep "
              "(install it with: brew install ripgrep)", file=sys.stderr)
    return found


def _search(files, needles, list_only):
    rg = ripgrep()
    pats = []
    for n in needles:
        pats += ["-e", n]
    if rg:
        base = [rg, "-F", "--no-messages"] + (["-l"] if list_only else ["--with-filename", "--no-heading", "--null", "--no-line-number"])
    else:
        base = ["grep", "-F", "-s"] + (["-l"] if list_only else ["-H", "--null"])
    for i in range(0, len(files), 200):
        r = subprocess.run(base + pats + ["--"] + files[i:i + 200], capture_output=True)
        yield r.stdout


def grep_files(files, needles):
    """The subset of files containing any of the needles."""
    hits = []
    for out in _search(files, needles, True):
        hits += [l for l in out.decode("utf-8", "replace").splitlines() if l]
    return hits


def matching_lines(files, needles):
    """{file: [lines]} for every line containing any needle; the search tool does the reading."""
    out = {}
    for chunk in _search(files, needles, False):
        for rec in chunk.split(b"\n"):
            if b"\0" not in rec:
                continue
            name, line = rec.split(b"\0", 1)
            out.setdefault(name.decode("utf-8", "replace"), []).append(line.decode("utf-8", "replace"))
    return out


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


def claude_sessions(targets, days):
    """targets: {rel_path: abs_path}. Returns {rel_path: [rows]} from ONE pass over the transcripts."""
    found = {rel: {} for rel in targets}
    per_file = matching_lines(grep_files(recent_files(CLAUDE_DIR, days), list(targets)),
                              list(targets) + ['"custom-title"'])
    for p, file_lines in per_file.items():
        state = {rel: {"edits": 0, "last": "", "mentioned": False, "cwd": ""} for rel in targets}
        sid, title = None, ""
        for line in file_lines:
            hits = [rel for rel in targets if rel in line]
            if not hits and '"custom-title"' not in line:
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
                blob = json.dumps(inp)
                for rel in hits:
                    st = state[rel]
                    if c.get("name") in CLAUDE_EDIT_TOOLS and (target == targets[rel] or target.endswith("/" + rel)):
                        st["edits"] += 1
                        st["last"] = max(st["last"], e.get("timestamp", ""))
                        st["cwd"] = e.get("cwd") or st["cwd"]
                    elif rel in blob:
                        st["mentioned"] = True
                        st["cwd"] = e.get("cwd") or st["cwd"]
        sid = sid or os.path.basename(p)[:-6]
        for rel, st in state.items():
            if not (st["edits"] or st["mentioned"]):
                continue
            # a session's sub-agents write separate files under the SAME session id: merge, never overwrite
            row = found[rel].setdefault(sid, {"tool": "claude", "session": sid, "title": "", "edits": 0,
                                              "cwd": "", "_sort": ""})
            row["edits"] += st["edits"]
            row["_sort"] = max(row["_sort"], st["last"])
            row["title"] = row["title"] or title or first_prompt(p)
            row["cwd"] = row["cwd"] or st["cwd"]
    for rows in found.values():
        for row in rows.values():
            row["kind"] = "edited" if row["edits"] else "mentioned"
            row["last"] = short_time(row["_sort"]) if row["_sort"] else ""
    return {rel: list(v.values()) for rel, v in found.items()}


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


def codex_sessions(targets, days):
    """targets: {rel_path: abs_path}. Returns {rel_path: [rows]} from ONE pass over the transcripts."""
    titles = codex_titles()
    found = {rel: [] for rel in targets}
    per_file = matching_lines(grep_files(recent_files(CODEX_DIR, days), list(targets)), list(targets))
    for p, file_lines in per_file.items():
        sid = os.path.basename(p)[:-6][-36:]
        state = {rel: {"edits": 0, "last": "", "mentioned": False} for rel in targets}
        cwd = ""
        for line in file_lines:
            hits = [rel for rel in targets if rel in line]
            if not hits:
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
            for rel in hits:
                st = state[rel]
                if ("File: " + targets[rel]) in args or ("File: " + rel) in args:
                    st["edits"] += 1
                    st["last"] = max(st["last"], e.get("timestamp", ""))
                elif rel in args:
                    st["mentioned"] = True
        touched = [rel for rel, st in state.items() if st["edits"] or st["mentioned"]]
        if not touched:
            continue
        parent, nick = codex_meta(p)
        title = titles.get(sid) or first_prompt(p)
        if parent:
            title = "sub-agent %s of %s (%s)" % (nick or "?", parent, titles.get(parent) or "untitled")
        for rel in touched:
            st = state[rel]
            found[rel].append({"tool": "codex", "session": sid, "title": title, "edits": st["edits"],
                               "last": short_time(st["last"]) if st["last"] else "", "cwd": cwd,
                               "parent": parent, "kind": "edited" if st["edits"] else "mentioned",
                               "_sort": st["last"]})
    return found


def find(abs_paths, days=3):
    """{abs_path: [rows]} for any number of files, in one pass over each transcript store."""
    targets = {}
    for ap in abs_paths:
        ap = os.path.abspath(ap)
        top = subprocess.run(["git", "-C", os.path.dirname(ap), "rev-parse", "--show-toplevel"],
                             capture_output=True, text=True).stdout.strip()
        rel = os.path.relpath(ap, top) if top else os.path.basename(ap)
        targets[rel] = ap
    cl, cx = claude_sessions(targets, days), codex_sessions(targets, days)
    out = {}
    for rel, ap in targets.items():
        rows = cl.get(rel, []) + cx.get(rel, [])
        rows.sort(key=lambda r: r["_sort"], reverse=True)       # newest edit first (ISO timestamps)
        rows.sort(key=lambda r: r["kind"] != "edited")         # edited before mentioned; stable
        for r in rows:
            r.pop("_sort", None)
        out[ap] = rows
    return out


def main():
    args = sys.argv[1:]
    as_json = "--json" in args
    days = int(args[args.index("--days") + 1]) if "--days" in args else 3
    paths = [a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or args[i - 1] != "--days")]
    if not paths:
        sys.exit(__doc__)
    result = find(paths, days)
    if as_json:
        print(json.dumps(result, indent=2))
        return
    for ap, rows in result.items():
        if not rows:
            print("No Claude Code or Codex conversation touched %s in the last %d day(s)." % (ap, days))
            continue
        print("Conversations that touched %s (last %d day(s)), newest edit first:" % (ap, days))
        for r in rows:
            print("  %-9s %-6s %-38s %-17s edits=%-3d %s" % (
                r["kind"], r["tool"], r["session"], r["last"] or "-", r["edits"], r["title"][:70]))


if __name__ == "__main__":
    main()
