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
      Proves the changed-line split, the hunk parser and the law-guard mapping can fail.

Linters: matrx-frontend -> its own eslint (errors only, severity 2); aidream *.py -> ruff.
Law guards (LAW_GUARDS): each repo's own `check:archived-items-law` / `check:canonical-pickers`
script, run when this change touched a file that guard scans; its `✗ file:line — reason` findings
go through the same changed-line split (a finding in a file this change did not touch is ignored
here — the release gates report it). A repo or file type with no linter is skipped, never failed.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

# LINT_GUARD_CODE_ROOT exists only so the planted-violation proof can run on a scratch clone.
CODE = os.environ.get("LINT_GUARD_CODE_ROOT") or os.path.expanduser("~/code")
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


# The repo-wide law guards, run like linters. (repo dir name, package dir inside it, check name,
# script relative to the package, regex over REPO-relative paths the guard scans, takes --files).
# A guard without --files runs whole-package (each measured < 15 s under load 200) and its findings
# are filtered to this change's files; matrx-frontend's two read 18k files, so they take --files.
LAW_GUARDS = (
    ("matrx-frontend", "", "archived-items-law", "scripts/check-archived-items-law.ts",
     r"^(app|components|features|hooks|lib|utils|providers)/.+\.tsx?$", True),
    ("matrx-frontend", "", "canonical-pickers", "scripts/check-canonical-pickers.ts",
     r"^(app|components|features|hooks|lib|utils)/.+\.tsx?$", True),
    ("matrx-extend", "", "archived-items-law", "scripts/check-archived-items-law.ts", r"^src/.+\.tsx?$", False),
    ("matrx-extend", "", "canonical-pickers", "scripts/check-canonical-pickers.ts", r"^src/.+\.tsx?$", False),
    ("matrx-vscode", "", "archived-items-law", "scripts/check-archived-items-law.ts", r"^src/.+\.tsx?$", False),
    ("matrx-vscode", "", "canonical-pickers", "scripts/check-canonical-pickers.ts",
     r"^(src|tests|certification|scripts)/.+\.(tsx?|jsx?|cjs|mjs)$", False),
    ("matrx-local", "desktop", "archived-items-law", "scripts/check-archived-items-law.mjs",
     r"^(desktop/src|app)/.+\.(tsx?|py)$", False),
    ("matrx-local", "desktop", "canonical-pickers", "scripts/check-canonical-pickers.mjs", r"^desktop/src/.+\.tsx?$", False),
    ("aidream", "apps/workflow-studio", "archived-items-law", "scripts/check-archived-items-law.mjs",
     r"^apps/workflow-studio/src/.+\.tsx?$", False),
    ("aidream", "apps/workflow-studio", "canonical-pickers", "scripts/check-canonical-pickers.mjs",
     r"^apps/workflow-studio/src/.+\.tsx?$", False),
    ("aidream", "apps/dashboard", "archived-items-law", "scripts/check-archived-items-law.mjs",
     r"^apps/dashboard/src/.+\.tsx?$", False),
    # THE CONTENT LANE AT WRITE TIME (Arman 2026-10-21): a whole-file copy of package source (app vs
    # package, or package vs another package) is screamed at the agent that writes it. The same lane
    # runs in check-package-twins as a report-only release advisory; here it reads only this change's files.
    ("matrx-frontend", "", "content-copy", "scripts/content-lane.mjs",
     r"^(app|components|features|hooks|lib|utils|providers|constants)/.+\.tsx?$", True),
    ("aidream", "apps/shared", "content-copy", "scripts/content-lane.mjs", r"^apps/shared/[^/]+/src/.+\.tsx?$", True),
)
LAW_HINT = {
    "archived-items-law": "every list over an archivable entity carries an archive control (ArchiveFilter / ArchivedDisclosure) — ../common-docs/policies/archived-items.md",
    "content-copy": "a file that is >=80% a copy of package source (or of another package) is debt: delete one side and import the other (scripts/content-lane.mjs; pairs already in scripts/package-twins.json contentCensus are existing debt)",
    "canonical-pickers": "agent/model choice renders only through the canonical picker (AgentListDropdown / AgentListInlinePicker / ModelListDropdown)",
}
LAW_TIMEOUT = 75

# THE HARD-CODED SETTINGS RATCHET AT WRITE TIME (Arman 2026-10-21: "scream at them at the time they write
# the code, not block the pathways that get the code out"). The same scan aidream's pre-commit and
# pre-push run (scripts/check_hardcoded_settings.py --changed-from/--target, changed files only) now
# runs on the files this session edited, and its findings go through the same changed-line split. On
# the release push it only reports (.githooks/pre-push, MATRX_RELEASE_PATH=1).
SETTINGS_SCANS = r"^(aidream|packages)/.+\.py$"
SETTINGS_FINDING = re.compile(r"^NEW\s+(\S+?\.py)::(\w+)::(\S+)\s+—\s+(.*)$")
# LOCKFILE DRIFT AT WRITE TIME (Arman 2026-10-21): a workspace package.json dependency edit without its
# pnpm-lock.yaml broke every npm publish (playground commits 0607580db8, 2548f21eb2). aidream's
# scripts/check_lockfile_specifiers.py compares the edited package.json to the lockfile on disk; findings
# carry the dependency's line so the changed-line split applies. Never on the release path.
LOCKFILE_FINDING = re.compile(r"^(\S+package\.json):(\d+)\s+lockfile-drift\s+(.*)$")
LAW_HINT["lockfile-drift"] = "pnpm install --lockfile-only, then stage pnpm-lock.yaml with the package.json (aidream scripts/check_lockfile_specifiers.py)"
LAW_HINT["hardcoded-settings"] = "behavioral settings live in platform.feature_knob rows, never in code or the environment (aidream scripts/check_hardcoded_settings.py)"


def linters_for(repo, rel):
    """Every checker that covers this repo-relative file: 'eslint', 'ruff', or 'law:<index>'."""
    name = os.path.basename(repo)
    out = []
    if name == "matrx-frontend" and rel.endswith(JS_EXT):
        out.append("eslint")
    if name == "aidream" and rel.endswith(".py"):
        out.append("ruff")
    if name == "aidream" and re.match(SETTINGS_SCANS, rel) and os.path.exists(os.path.join(repo, "scripts", "check_hardcoded_settings.py")):
        out.append("settings")
    if name == "aidream" and os.path.basename(rel) == "package.json" and os.path.exists(os.path.join(repo, "scripts", "check_lockfile_specifiers.py")):
        out.append("lockfile")
    for i, (gname, _pkg, _check, _script, scans, _files) in enumerate(LAW_GUARDS):
        if gname == name and re.match(scans, rel) and not re.search(r"\.(test|spec)\.[a-z]+$", rel):
            out.append(f"law:{i}")
    return out


def linter_for(repo, rel):
    return (linters_for(repo, rel) or [None])[0]


def run_tool(cmd, cwd, timeout):
    """A linter that is missing or slow is SKIPPED, loudly — it never refuses anyone's work."""
    try:
        return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        print(f"lint-guard: skipped {os.path.basename(cmd[0])} ({type(e).__name__}: {e}); nothing was checked.", file=sys.stderr)
        return None


def run_eslint(repo, rels):
    exe = os.path.join(repo, "node_modules", ".bin", "eslint")
    if not os.path.exists(exe):
        return []
    r = run_tool([exe, "--format", "json", "--no-warn-ignored", *rels], repo, 90)
    if r is None:
        return []
    try:
        data = json.loads(r.stdout or "[]")
    except json.JSONDecodeError:
        data = None
    if data is None or (not data and r.returncode not in (0, 1)):
        print(f"lint-guard: the linter failed (exit {r.returncode}): {(r.stderr or r.stdout).strip()[:200]}; nothing was checked.", file=sys.stderr)
        return []
    out = []
    for f in data:
        rel = os.path.relpath(f["filePath"], repo)
        for m in f.get("messages", []):
            if m.get("severity") == 2 and m.get("line"):
                out.append({"file": rel, "line": m["line"], "rule": m.get("ruleId") or "parse", "message": m.get("message", "")})
    return out


def run_ruff(repo, rels):
    # --no-sync: `uv run` re-resolves/syncs the whole project env on every call (seconds when idle, minutes
    # under lock contention with other agents). Prefer the venv's own ruff; fall back to uv --no-sync.
    venv_ruff = os.path.join(repo, ".venv", "bin", "ruff")
    cmd = [venv_ruff] if os.path.exists(venv_ruff) else ["uv", "run", "--no-sync", "--quiet", "ruff"]
    r = run_tool([*cmd, "check", "--output-format", "json", *rels], repo, 60)
    if r is None:
        return []
    try:
        data = json.loads(r.stdout or "[]")
    except json.JSONDecodeError:
        data = None
    if data is None or (not data and r.returncode not in (0, 1)):
        print(f"lint-guard: the linter failed (exit {r.returncode}): {(r.stderr or r.stdout).strip()[:200]}; nothing was checked.", file=sys.stderr)
        return []
    return [
        {"file": os.path.relpath(d["filename"], repo), "line": d["location"]["row"], "rule": d.get("code") or "syntax", "message": d.get("message", "")}
        for d in data
    ]


# `  ✗ <file>[:<line>] — <reason>` — the one finding line every law guard prints.
LAW_FINDING = re.compile(r"^\s*\u2717 (.+?)(?::(\d+))? \u2014 (.*)$")


def parse_law_output(repo, pkg, check_name, returncode, text):
    """A guard's exit + output -> findings with REPO-relative paths, or None when the guard itself
    failed (crash, missing deps): that is reported and skipped, never counted as clean or dirty."""
    found = []
    for row in text.splitlines():
        m = LAW_FINDING.match(row)
        if not m:
            continue
        path = m.group(1).strip()
        cands = [os.path.normpath(os.path.join(pkg, path)), os.path.normpath(path)] if pkg else [os.path.normpath(path)]
        rel = next((c for c in cands if os.path.exists(os.path.join(repo, c))), cands[0])
        found.append({"file": rel, "line": int(m.group(2)) if m.group(2) else None, "rule": check_name, "message": m.group(3).strip()})
    if returncode == 0 and not found:
        return []
    if returncode == 1 and found:
        return found
    return None


def run_law(repo, idx, rels):
    _name, pkg, check_name, script, _scans, takes_files = LAW_GUARDS[idx]
    pkg_dir = os.path.join(repo, pkg) if pkg else repo
    if script.endswith(".ts"):
        exe = os.path.join(pkg_dir, "node_modules", ".bin", "tsx")
        if not os.path.exists(exe):
            print(f"lint-guard: skipped {check_name} in {os.path.basename(repo)}/{pkg} (no node_modules/.bin/tsx); nothing was checked.", file=sys.stderr)
            return []
        cmd = [exe, script]
    else:
        cmd = ["node", script]
    if takes_files:
        cmd += ["--files", *[os.path.relpath(os.path.join(repo, r), pkg_dir) for r in rels]]
    r = run_tool(cmd, pkg_dir, LAW_TIMEOUT)
    if r is None:
        return []
    found = parse_law_output(repo, pkg, check_name, r.returncode, (r.stderr or "") + "\n" + (r.stdout or ""))
    if found is None:
        tail = (r.stderr or r.stdout or "").strip().splitlines()[-3:]
        print(f"lint-guard: {check_name} failed (exit {r.returncode}): {' | '.join(tail)[:300]}; nothing was checked.", file=sys.stderr)
        return []
    wanted = set(rels)
    return [f for f in found if f["file"] in wanted]


def run_settings(repo, rels):
    """aidream's settings ratchet over HEAD + these files as they are on disk (a scratch index, never
    the shared one). A name the finding cites is located on its first line in the file."""
    py = os.path.join(repo, ".venv", "bin", "python")
    py = py if os.path.exists(py) else sys.executable
    idx = os.path.join(os.environ.get("TMPDIR", "/tmp"), "lint-guard-settings-%d.idx" % os.getpid())
    env = dict(os.environ, GIT_INDEX_FILE=idx)
    try:
        if subprocess.run(["git", "read-tree", "HEAD"], cwd=repo, env=env, capture_output=True).returncode != 0:
            return []
        if subprocess.run(["git", "update-index", "--add", "--", *rels], cwd=repo, env=env, capture_output=True).returncode != 0:
            return []
        tree = subprocess.run(["git", "write-tree"], cwd=repo, env=env, capture_output=True, text=True).stdout.strip()
    finally:
        try:
            os.remove(idx)
        except OSError:
            pass
    target = subprocess.run(["git", "commit-tree", tree, "-p", "HEAD", "-m", "lint-guard settings scan"], cwd=repo,
                            capture_output=True, text=True).stdout.strip()
    if not target:
        return []
    r = run_tool([py, "scripts/check_hardcoded_settings.py", "--changed-from", "HEAD", "--target", target], repo, LAW_TIMEOUT)
    if r is None or r.returncode not in (0, 1) or "hard-coded settings (changed" not in (r.stdout or ""):
        if r is not None:
            print(f"lint-guard: hardcoded-settings failed (exit {r.returncode}); nothing was checked.", file=sys.stderr)
        return []
    wanted, found = set(rels), []
    for row in (r.stdout or "").splitlines():
        m = SETTINGS_FINDING.match(row.strip())
        if not m or m.group(1) not in wanted:
            continue
        needle = m.group(3).split(".")[-1]
        line = None
        try:
            with open(os.path.join(repo, m.group(1)), encoding="utf-8", errors="replace") as fh:
                line = next((i for i, t in enumerate(fh, 1) if needle in t), None)
        except OSError:
            pass
        found.append({"file": m.group(1), "line": line, "rule": "hardcoded-settings",
                      "message": f"{m.group(2)} {m.group(3)}: {m.group(4)}"})
    return found


def run_lockfile(repo, rels):
    r = run_tool([sys.executable, "scripts/check_lockfile_specifiers.py", "--worktree", "--repo", repo, *rels], repo, 30)
    found = []
    for row in (r.stdout if r is not None else "").splitlines():
        m = LOCKFILE_FINDING.match(row.strip())
        if m:
            found.append({"file": m.group(1), "line": int(m.group(2)), "rule": "lockfile-drift", "message": m.group(3)})
    return found


def lint(repo, rels):
    by = {}
    for rel in rels:
        if not os.path.exists(os.path.join(repo, rel)):
            continue
        for kind in linters_for(repo, rel):
            by.setdefault(kind, []).append(rel)
    jobs = []
    with ThreadPoolExecutor(max_workers=max(1, len(by))) as pool:
        for kind, files in by.items():
            if kind == "eslint":
                jobs.append(pool.submit(run_eslint, repo, files))
            elif kind == "ruff":
                jobs.append(pool.submit(run_ruff, repo, files))
            elif kind.startswith("law:"):
                jobs.append(pool.submit(run_law, repo, int(kind[4:]), files))
            elif kind == "settings":
                jobs.append(pool.submit(run_settings, repo, files))
            elif kind == "lockfile":
                jobs.append(pool.submit(run_lockfile, repo, files))
        found = []
        for j in jobs:
            found += j.result()
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


# git ends a ---/+++ path that contains a space with a TAB.
DIFF_FILE = re.compile(r'^\+\+\+ (?:b/(.*?)\t?|/dev/null)$')


def touched_lines(repo, rels):
    """{rel: set of changed line numbers | None (new file)} against HEAD, in the WORKTREE's line
    numbering (what the linter reads). Renames are detected (-M), so a moved file is not new."""
    out = {r: set() for r in rels}
    current = None
    for row in git(repo, "-c", "core.quotepath=off", "diff", "-M", "-U0", "--no-color", "HEAD").splitlines():
        m = DIFF_FILE.match(row)
        if m:
            current = m.group(1)
            continue
        if current in out:
            out[current] |= parse_hunks(row)
    untracked = set(git(repo, "ls-files", "-z", "--others", "--exclude-standard", "--", *rels).split("\0")) if rels else set()
    for r in rels:
        if r in untracked:
            out[r] = None  # new file: every line is this change's
    return out


def changed_files(repo, staged):
    if staged:
        return [f for f in git(repo, "diff", "--cached", "-z", "--name-only", "-M", "--diff-filter=ACMR").split("\0") if f]
    tracked = git(repo, "diff", "-z", "--name-only", "-M", "--diff-filter=ACMR", "HEAD").split("\0")
    return [f for f in tracked + git(repo, "ls-files", "-z", "--others", "--exclude-standard").split("\0") if f]


def split(findings, touched, written=None, texts=None):
    """touched: {rel: set|None}; None = whole file is new. -> (mine, inherited).

    written/texts (Stop hook only): {rel: text this session's edit tools wrote}, {rel: current
    lines}. In a shared checkout the diff against HEAD also holds OTHER lanes' uncommitted lines;
    a changed line is this session's only if its text is in what this session wrote."""
    mine, inherited = [], []
    for f in findings:
        lines = touched.get(f["file"], set())
        # A file-level finding (no line) is this change's only when this change created the file.
        ours = lines is None or (f["line"] is not None and f["line"] in lines)
        if ours and f["line"] is not None and written is not None and f["file"] in written:
            body = (texts.get(f["file"]) or [])
            line_text = body[f["line"] - 1].strip() if 0 < f["line"] <= len(body) else ""
            ours = bool(line_text) and line_text in written[f["file"]]
        (mine if ours else inherited).append(f)
    return mine, inherited


# ---------------------------------------------------------------- inherited -> its author

_BLAME_CACHE = {}


def blame(repo, rel, line):
    """(sha, committer-time) of a line. One `git blame` per FILE, not per finding: a file with 900
    inherited errors used to cost 900 blames (minutes) on every commit that touched it."""
    key = (repo, rel)
    if key not in _BLAME_CACHE:
        table, sha, times = {}, None, {}
        for row in git(repo, "blame", "--porcelain", "HEAD", "--", rel).splitlines():
            m = re.match(r"^([0-9a-f]{40}) \d+ (\d+)", row)
            if m:
                sha = m.group(1)
                table[int(m.group(2))] = sha
            elif row.startswith("committer-time ") and sha:
                times[sha] = int(row.split()[1])
        _BLAME_CACHE[key] = (table, times)
    table, times = _BLAME_CACHE[key]
    sha = table.get(line)
    return (sha, times.get(sha, 0)) if sha else None


def session_of_commit(repo, sha):
    body = git(repo, "show", "-s", "--format=%B", sha)
    m = re.search(r"^Agent-Session:\s*(\S+)\s+(\S+)", body, re.M)
    return (m.group(1), m.group(2)) if m else None


def session_by_edit_time(repo, rel, when):
    """No trailer: the conversation that edited the file in the 30 minutes before the commit.
    Nothing in that window -> nobody is mailed (a wrong recipient is worse than none)."""
    try:  # bounded: a transcript scan under load took 45 s, past the Stop hook's whole budget
        r = subprocess.run(
            [sys.executable, os.path.join(SCRIPTS, "find-file-sessions.py"), "--days", str(BLAME_WINDOW_DAYS + 1), "--json", os.path.join(repo, rel)],
            capture_output=True, text=True, timeout=NOTIFY_BUDGET_SECONDS,
        )
    except subprocess.TimeoutExpired:
        print(f"lint-guard: finding who wrote {rel} took over {NOTIFY_BUDGET_SECONDS}s; not mailed this run.", file=sys.stderr)
        return None
    try:
        rows = next(iter(json.loads(r.stdout or "{}").values()), [])
    except (json.JSONDecodeError, StopIteration):
        return None
    best = None
    for row in rows:
        if row.get("kind") != "edited" or not row.get("last"):
            continue
        t = time.mktime(time.strptime(row["last"], "%Y-%m-%d %H:%M"))
        if when - 1800 <= t <= when + 120 and (best is None or t > best[0]):
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


# Mailing an inherited error's author is a courtesy, never a gate: it gets a time budget so a commit
# is not held hostage by a file that carries hundreds of old errors.
NOTIFY_BUDGET_SECONDS = 8


def notify_inherited(repo, inherited, me):
    if not inherited:
        return []
    sent = load_sent()
    by_session = {}
    who_cache = {}
    deadline = time.time() + NOTIFY_BUDGET_SECONDS
    for f in inherited:
        if time.time() > deadline:
            print(f"lint-guard: notify budget ({NOTIFY_BUDGET_SECONDS}s) spent; remaining inherited errors are not mailed this run.", file=sys.stderr)
            break
        b = blame(repo, f["file"], f["line"]) if f["line"] else None
        if not b or set(b[0]) == {"0"}:
            continue  # uncommitted: someone's live edit; their own Stop hook owns it
        sha, when = b
        if time.time() - when > BLAME_WINDOW_DAYS * 86400:
            continue
        key = hashlib.sha1(f"{sha}|{f['file']}|{f['rule']}|{f['message']}".encode()).hexdigest()
        if key in sent:
            continue
        ck = (sha, f["file"])
        if ck not in who_cache:
            who_cache[ck] = session_of_commit(repo, sha) or session_by_edit_time(repo, f["file"], when)
        who = who_cache[ck]
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
        r = subprocess.run([sys.executable, os.path.join(SCRIPTS, "board.py"), "post", f"{tool} {session}", text, "--urgent", "--from", "lint-guard"], capture_output=True, text=True)
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
    rows = [f"  {f['file']}{':' + str(f['line']) if f['line'] else ''}  {f['rule']}  {f['message'].splitlines()[0][:300] if f['message'] else ''}" for f in mine]
    rules = sorted({f["rule"] for f in mine if f["rule"] in LAW_HINT})
    rows += [f"  ({r}: {LAW_HINT[r]})" for r in rules]
    return "\n".join(rows)


def check(repo, rels, staged, me, written=None):
    rels = rels or changed_files(repo, staged)
    rels = [r for r in rels if linters_for(repo, r)]
    if not rels:
        return [], []
    touched = touched_lines(repo, rels)
    texts = {}
    if written is not None:
        for r in rels:
            try:
                with open(os.path.join(repo, r), encoding="utf-8", errors="replace") as fh:
                    texts[r] = fh.read().splitlines()
            except OSError:
                pass
    mine, inherited = split(lint(repo, rels), touched, written, texts)
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
    """{path: text this session's edit tools wrote into it}."""
    files = {}
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
                path = inp.get("file_path") if name in EDIT_TOOLS else inp.get("relative_path") if SERENA_EDIT.match(name) else None
                if not path:
                    continue
                pieces = [inp.get(k) for k in ("new_string", "content", "body", "new_source", "repl")]
                pieces += [e.get("new_string") for e in inp.get("edits") or [] if isinstance(e, dict)]
                files[path] = files.get(path, "") + "\n" + "\n".join(p for p in pieces if isinstance(p, str))
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
    written_by_path = edited_files(transcript)
    written = {}
    for p, text in written_by_path.items():
        full = p if os.path.isabs(p) else os.path.join(cwd, p)
        repo = repo_root(full) if os.path.exists(full) else None
        if not repo or not full.startswith(CODE):
            continue
        rel = os.path.relpath(full, repo)
        if linters_for(repo, rel):
            by_repo.setdefault(repo, []).append(rel)
            written.setdefault(repo, {})[rel] = text
    mine = []
    for repo, rels in by_repo.items():
        # Only files still carrying uncommitted changes: committed work already passed pre-commit.
        dirty = set(changed_files(repo, False))
        rels = [r for r in rels if r in dirty]
        if rels:
            found, _ = check(repo, rels, False, session, written.get(repo, {}))
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


def law_self_test():
    """The law-guard mapping: which files wake which guard, how its output maps to repo paths, and
    that a finding blocks only on a line this change touched. Every assert fails if that breaks."""
    import tempfile
    idx = {(g[0] if not g[1] else f"{g[0]}/{g[1]}", g[2]): f"law:{i}" for i, g in enumerate(LAW_GUARDS)}
    fe = "/x/matrx-frontend"
    assert linters_for(fe, "features/a/List.tsx") == ["eslint", idx["matrx-frontend", "archived-items-law"], idx["matrx-frontend", "canonical-pickers"], idx["matrx-frontend", "content-copy"]], linters_for(fe, "features/a/List.tsx")
    assert linters_for(fe, "providers/P.tsx") == ["eslint", idx["matrx-frontend", "archived-items-law"], idx["matrx-frontend", "content-copy"]], linters_for(fe, "providers/P.tsx")
    assert linters_for(fe, "scripts/x.ts") == ["eslint"] and linters_for(fe, "features/a/x.test.tsx") == ["eslint"]
    assert idx["matrx-frontend", "content-copy"] in linters_for(fe, "features/a/List.tsx") and idx["matrx-frontend", "content-copy"] in linters_for(fe, "constants/k.ts")
    assert idx["matrx-frontend", "content-copy"] not in linters_for(fe, "features/a/x.test.tsx") and idx["matrx-frontend", "content-copy"] not in linters_for(fe, "scripts/x.ts")
    assert linters_for("/x/aidream", "apps/shared/kit/src/a/B.tsx") == [idx["aidream/apps/shared", "content-copy"]], linters_for("/x/aidream", "apps/shared/kit/src/a/B.tsx")
    assert idx["aidream/apps/shared", "content-copy"] not in linters_for("/x/aidream", "apps/shared/kit/src/a/B.test.tsx")
    assert linters_for("/x/aidream", "apps/dashboard/src/T.tsx") == [idx["aidream/apps/dashboard", "archived-items-law"]]
    assert linters_for("/x/aidream", "apps/workflow-studio/src/W.tsx") == [idx["aidream/apps/workflow-studio", "archived-items-law"], idx["aidream/apps/workflow-studio", "canonical-pickers"]]
    m = SETTINGS_FINDING.match("NEW  aidream/services/x.py::constant::RETRY_SECONDS  — added by this change; move it")
    assert m and m.group(1) == "aidream/services/x.py" and m.group(3) == "RETRY_SECONDS", "settings finding parse"
    assert linters_for("/x/aidream", "x/y.py") == ["ruff"] and linters_for("/x/matrx-local", "app/r.py") == [idx["matrx-local/desktop", "archived-items-law"]]
    for repo in ("matrx-extend", "matrx-vscode"):
        assert len(linters_for(f"/x/{repo}", "src/a.tsx")) == 2, repo
    with tempfile.TemporaryDirectory() as root:
        repo = os.path.join(root, "matrx-local")
        for rel in ("desktop/src/a.tsx", "app/b.py"):
            os.makedirs(os.path.dirname(os.path.join(repo, rel)), exist_ok=True)
            open(os.path.join(repo, rel), "w").close()
        out = ("\n\U0001f6a8 ARCHIVED-ITEMS LAW VIOLATIONS\n\n  \u2717 src/a.tsx:12 \u2014 list read of `x` has no control\n"
               "  \u2717 app/b.py:3 \u2014 py read\n  \u2717 src/a.tsx \u2014 file-level\n\nEvery list over ...\n")
        got = parse_law_output(repo, "desktop", "archived-items-law", 1, out)
        assert [(f["file"], f["line"], f["rule"]) for f in got] == [
            ("desktop/src/a.tsx", 12, "archived-items-law"), ("app/b.py", 3, "archived-items-law"), ("desktop/src/a.tsx", None, "archived-items-law")], got
        assert parse_law_output(repo, "desktop", "c", 0, "\u2705 holds") == []
        assert parse_law_output(repo, "desktop", "c", 1, "TypeError: boom") is None  # crashed guard
        assert parse_law_output(repo, "desktop", "c", 2, out) is None
        # a no-line finding blocks only in a file this change created
        mine, inh = split(got, {"desktop/src/a.tsx": {12}, "app/b.py": {9}})
        assert [(f["file"], f["line"]) for f in mine] == [("desktop/src/a.tsx", 12)] and len(inh) == 2, (mine, inh)
        mine, _ = split(got, {"desktop/src/a.tsx": None})
        assert [f["line"] for f in mine] == [12, None], mine
        # run_law end to end through a stand-in guard: --files carries package-relative paths, a
        # finding outside this change's files is dropped, a crash is skipped (never clean/dirty).
        fake = os.path.join(repo, "desktop", "scripts", "g.mjs")
        os.makedirs(os.path.dirname(fake))
        with open(fake, "w") as fh:
            fh.write("const a=process.argv.slice(process.argv.indexOf('--files')+1);"
                     "if(process.env.LG_CRASH){throw new Error('boom')}"
                     "for(const f of [...a,'src/other.tsx'])console.error(`  \u2717 ${f}:7 \u2014 planted`);process.exit(1);")
        saved = LAW_GUARDS
        globals()["LAW_GUARDS"] = (("matrx-local", "desktop", "archived-items-law", "scripts/g.mjs", r"^desktop/src/", True),)
        try:
            got = run_law(repo, 0, ["desktop/src/a.tsx"])
            assert [(f["file"], f["line"]) for f in got] == [("desktop/src/a.tsx", 7)], got
            got = lint(repo, ["desktop/src/a.tsx"])  # the dispatcher wakes the guard
            assert [(f["file"], f["line"], f["rule"]) for f in got] == [("desktop/src/a.tsx", 7, "archived-items-law")], got
            os.environ["LG_CRASH"] = "1"
            assert run_law(repo, 0, ["desktop/src/a.tsx"]) == []
        finally:
            os.environ.pop("LG_CRASH", None)
            globals()["LAW_GUARDS"] = saved
        assert "archived-items-law: every list" in describe([{"file": "f.tsx", "line": 3, "rule": "archived-items-law", "message": "m"}])


def cmd_self_test():
    diff = "@@ -3,0 +4,2 @@\n+a\n+b\n@@ -10 +12 @@\n-x\n+y\n@@ -20,3 +21,0 @@\n"
    assert parse_hunks(diff) == {4, 5, 12}, parse_hunks(diff)
    findings = [{"file": "a.ts", "line": 4}, {"file": "a.ts", "line": 9}, {"file": "new.ts", "line": 1}]
    mine, inherited = split(findings, {"a.ts": {4, 5}, "new.ts": None})
    assert [f["line"] for f in mine] == [4, 1] and [f["line"] for f in inherited] == [9], (mine, inherited)
    # another lane's uncommitted line in the same file is never this session's
    mine, inherited = split([{"file": "p.tsx", "line": 3}, {"file": "p.tsx", "line": 1}], {"p.tsx": {1, 3}},
                            {"p.tsx": "\nconst mine = 1;"}, {"p.tsx": ["const mine = 1;", "x", "BAD otherlane"]})
    assert [f["line"] for f in mine] == [1] and [f["line"] for f in inherited] == [3], (mine, inherited)
    m = LOCKFILE_FINDING.match("apps/shared/a/package.json:7  lockfile-drift  dependencies 'x' is not in apps/pnpm-lock.yaml; fix")
    assert m and m.group(2) == "7" and "x" in m.group(3), "lockfile finding parse"
    assert linters_for("/x/aidream", "apps/shared/a/package.json") == [] or "lockfile" in linters_for("/x/aidream", "apps/shared/a/package.json")
    law_self_test()
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
        try:
            return cmd_self_test()
        except AssertionError as e:  # a self-test failure is a red, never the guard's "nothing checked" pass
            import traceback
            traceback.print_exc()
            print(f"lint-guard self-test: FAILED {e}", file=sys.stderr)
            return 1
    print(__doc__)
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except BaseException as e:  # a broken guard never refuses anyone's work; it says so
        print(f"lint-guard: internal failure ({type(e).__name__}: {e}); nothing was checked.", file=sys.stderr)
        sys.exit(0)
