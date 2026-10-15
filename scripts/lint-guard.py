#!/usr/bin/env python3
"""lint-guard — every agent catches its OWN lint errors; errors it inherits go to whoever wrote them.

Arman, 2026-10-14: lint errors must not stop a release (whoever releases cannot tell who caused
them) — they must stop the AGENT that wrote them, and when another agent finds one, the agent that
caused it is told.

  lint-guard.py check  --repo <repo> (--staged | --worktree) [file ...]
      Lint the files (default: every changed file the repo's linter covers). An error on a line
      this change touched is YOURS: printed, exit 1. An error on an untouched line is INHERITED:
      its author (git blame -> the commit's Agent-Session trailer, else the conversation that
      edited the file around then) is mailed once through agent mail, and it never fails you.
  lint-guard.py stop-hook
      Claude Code Stop / SubagentStop hook (JSON on stdin). Lints every file this session edited
      and BLOCKS the turn's end while one of its changed lines carries an error (at most
      MAX_BLOCKS times in a row, so a stuck agent is never trapped).
  lint-guard.py self-test
      Proves the changed-line split and the hunk parser can fail.

Linters: matrx-frontend -> its own eslint (errors only, severity 2); aidream *.py -> ruff.
A repo or file type with no linter is skipped, never failed.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import time

CODE = os.path.expanduser("~/code")
SCRIPTS = os.path.dirname(os.path.realpath(__file__))
STATE_DIR = os.path.expanduser("~/.matrx/lint-guard")
SENT_FILE = os.path.join(STATE_DIR, "sent.json")
MAX_BLOCKS = 3
# An inherited error older than this is backlog, not a live session's mess: never mailed.
BLAME_WINDOW_DAYS = 3
JS_EXT = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts")


# ---------------------------------------------------------------- repos and linters

def git(repo, *args, check=False):
    r = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True)
    if check and r.returncode != 0:
        raise RuntimeError(r.stderr.strip())
    return r.stdout


def repo_root(path):
    d = path if os.path.isdir(path) else os.path.dirname(path)
    out = git(d, "rev-parse", "--show-toplevel").strip()
    return out or None


def linter_for(repo, rel):
    name = os.path.basename(repo)
    if name == "matrx-frontend" and rel.endswith(JS_EXT):
        return "eslint"
    if name == "aidream" and rel.endswith(".py"):
        return "ruff"
    return None


def run_eslint(repo, rels):
    exe = os.path.join(repo, "node_modules", ".bin", "eslint")
    if not os.path.exists(exe):
        return []
    r = subprocess.run([exe, "--format", "json", "--no-warn-ignored", *rels], cwd=repo, capture_output=True, text=True)
    try:
        data = json.loads(r.stdout or "[]")
    except json.JSONDecodeError:
        return []
    out = []
    for f in data:
        rel = os.path.relpath(f["filePath"], repo)
        for m in f.get("messages", []):
            if m.get("severity") == 2 and m.get("line"):
                out.append({"file": rel, "line": m["line"], "rule": m.get("ruleId") or "parse", "message": m.get("message", "")})
    return out


def run_ruff(repo, rels):
    r = subprocess.run(["uv", "run", "--quiet", "ruff", "check", "--output-format", "json", *rels], cwd=repo, capture_output=True, text=True)
    try:
        data = json.loads(r.stdout or "[]")
    except json.JSONDecodeError:
        return []
    return [
        {"file": os.path.relpath(d["filename"], repo), "line": d["location"]["row"], "rule": d.get("code") or "syntax", "message": d.get("message", "")}
        for d in data
    ]


def lint(repo, rels):
    by = {}
    for rel in rels:
        kind = linter_for(repo, rel)
        if kind and os.path.exists(os.path.join(repo, rel)):
            by.setdefault(kind, []).append(rel)
    found = []
    if by.get("eslint"):
        found += run_eslint(repo, by["eslint"])
    if by.get("ruff"):
        found += run_ruff(repo, by["ruff"])
    return found


# ---------------------------------------------------------------- what this change touched

HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")


def parse_hunks(diff_text):
    """Unified diff (-U0) -> set of new-side line numbers it added or changed."""
    lines = set()
    for row in diff_text.splitlines():
        m = HUNK.match(row)
        if m:
            start, count = int(m.group(1)), int(m.group(2) if m.group(2) is not None else 1)
            lines.update(range(start, start + count))
    return lines


def changed_lines(repo, rel, staged):
    if staged:
        return parse_hunks(git(repo, "diff", "--cached", "-U0", "--", rel))
    if not git(repo, "ls-files", "--", rel).strip():
        return None  # untracked: every line is this change's
    return parse_hunks(git(repo, "diff", "-U0", "HEAD", "--", rel))


def changed_files(repo, staged):
    if staged:
        return git(repo, "diff", "--cached", "--name-only", "--diff-filter=ACMR").split()
    tracked = git(repo, "diff", "--name-only", "--diff-filter=ACMR", "HEAD").split()
    return tracked + git(repo, "ls-files", "--others", "--exclude-standard").split()


def split(findings, touched):
    """touched: {rel: set|None}. None = whole file is new. -> (mine, inherited)."""
    mine, inherited = [], []
    for f in findings:
        lines = touched.get(f["file"], set())
        (mine if lines is None or f["line"] in lines else inherited).append(f)
    return mine, inherited


# ---------------------------------------------------------------- inherited -> its author

def blame(repo, rel, line):
    out = git(repo, "blame", "--porcelain", "-L", f"{line},{line}", "HEAD", "--", rel)
    if not out:
        return None
    sha = out.split()[0]
    t = re.search(r"^committer-time (\d+)", out, re.M)
    return sha, int(t.group(1)) if t else 0


def session_of_commit(repo, sha):
    body = git(repo, "show", "-s", "--format=%B", sha)
    m = re.search(r"^Agent-Session:\s*(\S+)\s+(\S+)", body, re.M)
    return (m.group(1), m.group(2)) if m else None


def session_by_edit_time(repo, rel, when):
    """No trailer: the conversation whose last edit of the file is closest before the commit."""
    r = subprocess.run(
        [sys.executable, os.path.join(SCRIPTS, "find-file-sessions.py"), "--days", str(BLAME_WINDOW_DAYS + 1), "--json", os.path.join(repo, rel)],
        capture_output=True, text=True,
    )
    try:
        rows = next(iter(json.loads(r.stdout or "{}").values()), [])
    except (json.JSONDecodeError, StopIteration):
        return None
    best = None
    for row in rows:
        if row.get("kind") != "edited" or not row.get("last"):
            continue
        t = time.mktime(time.strptime(row["last"], "%Y-%m-%d %H:%M"))
        if t <= when + 120 and (best is None or t > best[0]):
            # A sub-agent's work belongs to the conversation that spawned it.
            parent = re.search(r"sub-agent .* of ([0-9a-f-]{36})", row.get("title", ""))
            best = (t, (row["tool"], parent.group(1) if parent else row["session"]))
    return best[1] if best else None


def load_sent():
    try:
        with open(SENT_FILE) as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return {}


def notify_inherited(repo, inherited, me):
    if not inherited:
        return []
    sent = load_sent()
    by_session = {}
    for f in inherited:
        b = blame(repo, f["file"], f["line"])
        if not b or set(b[0]) == {"0"}:
            continue  # uncommitted: someone's live edit; their own Stop hook owns it
        sha, when = b
        if time.time() - when > BLAME_WINDOW_DAYS * 86400:
            continue
        key = hashlib.sha1(f"{sha}|{f['file']}|{f['rule']}|{f['message']}".encode()).hexdigest()
        if key in sent:
            continue
        who = session_of_commit(repo, sha) or session_by_edit_time(repo, f["file"], when)
        if not who or who[1] == me:
            continue
        by_session.setdefault(who, []).append((key, sha, f))
    told = []
    for (tool, session), items in by_session.items():
        lines = [f"- {f['file']}:{f['line']} {f['rule']} — {(f['message'].splitlines() or [''])[0][:160]} (commit {sha[:10]})" for _, sha, f in items]
        text = (
            f"[lint-guard] Lint errors in code your conversation committed in {os.path.basename(repo)} — "
            "another agent hit them. Fix them now, in place, and push:\n" + "\n".join(lines[:20])
            + (f"\n(+{len(lines) - 20} more)" if len(lines) > 20 else "")
        )
        if os.environ.get("LINT_GUARD_DRY"):
            print(f"[dry] would mail {tool} {session}:\n{text}", file=sys.stderr)
            told.append((tool, session, len(items)))
            continue
        r = subprocess.run([sys.executable, os.path.join(SCRIPTS, "board.py"), "post", f"{tool} {session}", text, "--urgent"], capture_output=True, text=True)
        if r.returncode == 0:
            for key, _, _ in items:
                sent[key] = int(time.time())
            told.append((tool, session, len(items)))
        else:
            print(f"lint-guard: could not mail {tool} {session}: {(r.stderr or r.stdout).strip()[:200]}", file=sys.stderr)
    if told:
        os.makedirs(STATE_DIR, exist_ok=True)
        with open(SENT_FILE, "w") as fh:
            json.dump(sent, fh)
    return told


# ---------------------------------------------------------------- commands

def describe(mine):
    return "\n".join(f"  {f['file']}:{f['line']}  {f['rule']}  {f['message'].splitlines()[0][:200] if f['message'] else ''}" for f in mine)


def check(repo, rels, staged, me):
    rels = rels or changed_files(repo, staged)
    rels = [r for r in rels if linter_for(repo, r)]
    if not rels:
        return [], []
    touched = {r: changed_lines(repo, r, staged) for r in rels}
    mine, inherited = split(lint(repo, rels), touched)
    told = notify_inherited(repo, inherited, me)
    return mine, told


def cmd_check(argv):
    repo, staged, files, i = None, False, [], 0
    while i < len(argv):
        a = argv[i]
        if a == "--repo":
            repo, i = os.path.realpath(argv[i + 1]), i + 2
            continue
        if a == "--staged":
            staged = True
        elif not a.startswith("--"):
            files.append(a)
        i += 1
    repo = repo or repo_root(os.getcwd())
    me = os.environ.get("CLAUDE_CODE_SESSION_ID") or os.environ.get("CODEX_THREAD_ID") or ""
    mine, told = check(repo, files, staged, me)
    for tool, session, n in told:
        print(f"lint-guard: {n} inherited lint error(s) mailed to {tool} {session[:8]} (they wrote them).", file=sys.stderr)
    if mine:
        print(f"LINT ERRORS ON LINES YOU CHANGED ({len(mine)}) — fix them before you continue:\n{describe(mine)}", file=sys.stderr)
        return 1
    return 0


EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
SERENA_EDIT = re.compile(r"^mcp__serena__(replace|insert|rename|safe_delete|create_text_file)")


def edited_files(transcript):
    files = set()
    try:
        fh = open(transcript)
    except OSError:
        return files
    with fh:
        for raw in fh:
            if '"tool_use"' not in raw:
                continue
            try:
                msg = json.loads(raw).get("message") or {}
            except json.JSONDecodeError:
                continue
            for part in msg.get("content") or []:
                if not isinstance(part, dict) or part.get("type") != "tool_use":
                    continue
                name, inp = part.get("name", ""), part.get("input") or {}
                if name in EDIT_TOOLS and inp.get("file_path"):
                    files.add(inp["file_path"])
                elif SERENA_EDIT.match(name) and inp.get("relative_path"):
                    files.add(inp["relative_path"])  # resolved against cwd below
    return files


def cmd_stop_hook():
    try:
        hook = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0
    session = hook.get("session_id", "")
    transcript = hook.get("agent_transcript_path") or hook.get("transcript_path") or ""
    cwd = hook.get("cwd") or os.getcwd()
    counter = os.path.join(STATE_DIR, f"blocks-{session}")
    by_repo = {}
    for p in edited_files(transcript):
        full = p if os.path.isabs(p) else os.path.join(cwd, p)
        repo = repo_root(full) if os.path.exists(full) else None
        if not repo or not full.startswith(CODE):
            continue
        rel = os.path.relpath(full, repo)
        if linter_for(repo, rel):
            by_repo.setdefault(repo, []).append(rel)
    mine = []
    for repo, rels in by_repo.items():
        # Only files still carrying uncommitted changes: committed work already passed pre-commit.
        dirty = set(changed_files(repo, False))
        rels = [r for r in rels if r in dirty]
        if rels:
            found, _ = check(repo, rels, False, session)
            mine += [dict(f, file=os.path.join(os.path.basename(repo), f["file"])) for f in found]
    if not mine:
        try:
            os.remove(counter)
        except OSError:
            pass
        return 0
    os.makedirs(STATE_DIR, exist_ok=True)
    try:
        n = int(open(counter).read())
    except (OSError, ValueError):
        n = 0
    if n >= MAX_BLOCKS:
        os.remove(counter)
        return 0
    with open(counter, "w") as fh:
        fh.write(str(n + 1))
    print(json.dumps({
        "decision": "block",
        "reason": f"lint-guard: {len(mine)} lint error(s) on lines you changed. Fix each one in place (never disable the rule), then finish:\n{describe(mine)}",
    }))
    return 0


def cmd_self_test():
    diff = "@@ -3,0 +4,2 @@\n+a\n+b\n@@ -10 +12 @@\n-x\n+y\n@@ -20,3 +21,0 @@\n"
    assert parse_hunks(diff) == {4, 5, 12}, parse_hunks(diff)
    findings = [{"file": "a.ts", "line": 4}, {"file": "a.ts", "line": 9}, {"file": "new.ts", "line": 1}]
    mine, inherited = split(findings, {"a.ts": {4, 5}, "new.ts": None})
    assert [f["line"] for f in mine] == [4, 1] and [f["line"] for f in inherited] == [9], (mine, inherited)
    print("lint-guard self-test: ok")
    return 0


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    cmd, rest = sys.argv[1], sys.argv[2:]
    if cmd == "check":
        return cmd_check(rest)
    if cmd == "stop-hook":
        return cmd_stop_hook()
    if cmd == "self-test":
        return cmd_self_test()
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
