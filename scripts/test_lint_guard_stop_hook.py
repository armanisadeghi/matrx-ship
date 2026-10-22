#!/usr/bin/env python3
"""lint-guard's Stop hook, end to end, on a scratch repo (adversarial review 2026-10-22).

Proves, through the real `lint-guard.py stop-hook` command with a stand-in ruff:
  1. a file this session changed through BASH (sed -i / heredoc) is checked and blocks the turn;
  2. a file another lane changed, which this session only read or touched before that change, is NOT;
  3. an Edit-tool file still blocks (regression);
  4. past MAX_BLOCKS the turn ends with the findings in a VISIBLE systemMessage, never quietly;
  5. a crashed scanner prints a visible "lint-guard scanner ruff crashed" line;
  6. a read-only command with a redirect to ANOTHER path (`rg x a.py > /tmp/o`) never attributes a.py, while
     `cat x | tee a.py` and `cp x a.py` do;
  7. the second Stop of a session parses no transcript bytes and relints no unchanged file (and reports the
     same findings); an appended call parses only the new bytes and only the changed file is relinted.

Run:  python3 ~/code/matrx-ship/scripts/test_lint_guard_stop_hook.py
      LINT_GUARD_PATH=<old copy> ... runs the same proof against another lint-guard (fail-before).
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import uuid

HERE = os.path.dirname(os.path.realpath(__file__))
GUARD = os.environ.get("LINT_GUARD_PATH") or os.path.join(HERE, "lint-guard.py")

FAKE_RUFF = r'''#!/usr/bin/env python3
import json, os, sys
if os.environ.get("FAKE_RUFF_CRASH"):
    print("Traceback: planted ruff crash", file=sys.stderr)
    sys.exit(2)
out = []
for f in [a for a in sys.argv[1:] if a.endswith(".py")]:
    for i, line in enumerate(open(f), 1):
        if "BAD" in line:
            out.append({"filename": os.path.abspath(f), "location": {"row": i}, "code": "F821", "message": "planted"})
print(json.dumps(out))
sys.exit(1 if out else 0)
'''


# Never inherit an outer hook's GIT_INDEX_FILE / GIT_DIR into the scratch repo's git calls.
CLEAN_ENV = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}


def git(repo, *args):
    subprocess.run(["git", "-C", repo, *args], check=True, capture_output=True, env=CLEAN_ENV)


def iso(t):
    return time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(t))


def transcript(path, calls):
    with open(path, "w") as fh:
        for when, name, inp in calls:
            fh.write(json.dumps({"timestamp": iso(when), "message": {"content": [
                {"type": "tool_use", "name": name, "input": inp}]}}) + "\n")


def hook(root, state, session, tpath, cwd, extra_env=None):
    env = dict(CLEAN_ENV, LINT_GUARD_CODE_ROOT=root, LINT_GUARD_STATE_DIR=state, LINT_GUARD_DRY="1", **(extra_env or {}))
    r = subprocess.run([sys.executable, GUARD, "stop-hook"], input=json.dumps(
        {"session_id": session, "transcript_path": tpath, "cwd": cwd}), capture_output=True, text=True, env=env, timeout=120)
    try:
        return json.loads(r.stdout) if r.stdout.strip() else {}
    except json.JSONDecodeError:
        return {"_raw": r.stdout}


def main():
    root = os.path.realpath(tempfile.mkdtemp(prefix="lint-guard-stop-"))
    failures = []

    def expect(cond, what, got):
        print(("ok   " if cond else "FAIL ") + what)
        if not cond:
            failures.append("%s\n    got: %s" % (what, json.dumps(got)[:600]))

    try:
        state = os.path.join(root, "state")
        repo = os.path.join(root, "aidream")
        os.makedirs(os.path.join(repo, ".venv", "bin"))
        ruff = os.path.join(repo, ".venv", "bin", "ruff")
        with open(ruff, "w") as fh:
            fh.write(FAKE_RUFF)
        os.chmod(ruff, 0o755)
        git(root, "init", "-q", "-b", "main", repo)
        for k, v in (("user.email", "t@t"), ("user.name", "t")):
            git(repo, "config", k, v)
        with open(os.path.join(repo, ".gitignore"), "w") as fh:
            fh.write(".venv/\n")
        for name in ("bash_edit.py", "other_lane.py", "read_only.py", "edit_tool.py", "redir_only.py", "tee_target.py", "cp_target.py", "cp_src.py"):
            with open(os.path.join(repo, name), "w") as fh:
                fh.write("x = 1\ny = 2\n")
        git(repo, "add", "-A")
        git(repo, "commit", "-q", "-m", "base")
        now = time.time()

        def dirty(name, ago):
            p = os.path.join(repo, name)
            with open(p, "w") as fh:
                fh.write("x = 1\ny = BAD\n")
            os.utime(p, (now - ago, now - ago))
            return p

        # 1. this session's sed -i at now-30 s; the file changed afterwards.
        dirty("bash_edit.py", 20)
        # 2a. another lane changed other_lane.py an hour BEFORE this session's (writing) command named it.
        dirty("other_lane.py", 3600)
        # 2b. another lane changed read_only.py after this session only READ it.
        dirty("read_only.py", 10)
        calls = [
            (now - 30, "Bash", {"command": "cd %s && sed -i '' 's/2/BAD/' bash_edit.py" % repo}),
            (now - 25, "Bash", {"command": "sed -i '' 's/q/q/' %s/other_lane.py" % repo}),
            (now - 40, "Bash", {"command": "cat %s/read_only.py | head -5" % repo}),
        ]
        t1 = os.path.join(root, "t1.jsonl")
        transcript(t1, calls)
        out = hook(root, state, "s1-" + uuid.uuid4().hex, t1, repo)
        reason = out.get("reason", "")
        expect(out.get("decision") == "block" and "bash_edit.py:2" in reason,
               "a file this session changed through Bash (sed -i) blocks the turn", out)
        expect("other_lane.py" not in reason and "read_only.py" not in reason,
               "another lane's files (changed before this session's command, or only read) are never flagged", out)

        # 3. Edit tool regression: a fresh session that only Edits edit_tool.py.
        p = dirty("edit_tool.py", 1)
        t3 = os.path.join(root, "t3.jsonl")
        transcript(t3, [(now - 5, "Edit", {"file_path": p, "old_string": "y = 2", "new_string": "y = BAD"})])
        out = hook(root, state, "s3-" + uuid.uuid4().hex, t3, repo)
        expect(out.get("decision") == "block" and "edit_tool.py:2" in out.get("reason", "")
               and "bash_edit.py" not in out.get("reason", ""), "an Edit-tool file still blocks, and only its own", out)

        # 4. past MAX_BLOCKS: the 4th Stop is allowed, with the findings SHOWN.
        s4 = "s4-" + uuid.uuid4().hex
        outs = [hook(root, state, s4, t3, repo) for _ in range(4)]
        last = outs[-1]
        expect([o.get("decision") for o in outs[:3]] == ["block"] * 3 and last.get("decision") != "block"
               and "edit_tool.py:2" in last.get("systemMessage", ""),
               "past MAX_BLOCKS the findings are printed as a visible systemMessage", last)

        # 5. a crashed scanner is SEEN.
        out = hook(root, state, "s5-" + uuid.uuid4().hex, t3, repo, {"FAKE_RUFF_CRASH": "1"})
        expect("lint-guard scanner ruff crashed" in out.get("systemMessage", ""),
               "a crashed scanner prints a visible 'lint-guard scanner ruff crashed' line", out)

        # 6. redirect elsewhere never attributes the inputs; tee / cp targets do.
        dirty("redir_only.py", 10)
        dirty("tee_target.py", 5)
        dirty("cp_target.py", 5)
        t6 = os.path.join(root, "t6.jsonl")
        transcript(t6, [
            (now - 60, "Bash", {"command": "cd %s && rg x redir_only.py > /tmp/lint-guard-test-out" % repo}),
            (now - 59, "Bash", {"command": "rg x %s/redir_only.py 2>&1 | head > /tmp/lint-guard-test-out" % repo}),
            (now - 58, "Bash", {"command": "cat cp_src.py | tee %s/tee_target.py" % repo}),
            (now - 57, "Bash", {"command": "cd %s && cp cp_src.py cp_target.py" % repo}),
        ])
        out = hook(root, state, "s6-" + uuid.uuid4().hex, t6, repo)
        reason = out.get("reason", "")
        expect("redir_only.py" not in reason, "a redirect to another path does not make its inputs edited", out)
        expect("tee_target.py:2" in reason and "cp_target.py:2" in reason,
               "tee FILE and cp x FILE still attribute their targets", out)

        # 7. cached second pass.
        stats = os.path.join(root, "stats.json")
        s7 = "s7-" + uuid.uuid4().hex
        t7 = os.path.join(root, "t7.jsonl")
        transcript(t7, [(now - 30, "Bash", {"command": "cd %s && sed -i '' 's/2/BAD/' bash_edit.py" % repo}),
                        (now - 29, "Bash", {"command": "cd %s && sed -i '' 's/2/BAD/' tee_target.py" % repo})])
        env = {"LINT_GUARD_STATS": stats}
        first = hook(root, state, s7, t7, repo, env)
        st1 = json.load(open(stats)) if os.path.exists(stats) else {}
        second = hook(root, state, s7, t7, repo, env)
        st2 = json.load(open(stats)) if os.path.exists(stats) else {}
        expect(st1.get("files_linted") == 2 and st1.get("bytes_parsed", 0) > 0, "first pass parses the transcript and lints both files", st1)
        expect(st2.get("bytes_parsed") == 0 and st2.get("files_linted") == 0,
               "second pass with nothing changed parses 0 bytes and relints 0 files", st2)
        expect(first.get("decision") == "block" and second.get("decision") == "block"
               and "bash_edit.py:2" in second.get("reason", "") and "tee_target.py:2" in second.get("reason", ""),
               "the cached pass reports the same findings", second)
        with open(t7, "a") as fh:
            fh.write(json.dumps({"timestamp": iso(now - 20), "message": {"content": [
                {"type": "tool_use", "name": "Bash", "input": {"command": "cd %s && echo 'z = BAD' >> bash_edit.py" % repo}}]}}) + "\n")
        with open(os.path.join(repo, "bash_edit.py"), "a") as fh:
            fh.write("z = BAD\n")
        third = hook(root, state, s7, t7, repo, env)
        st3 = json.load(open(stats)) if os.path.exists(stats) else {}
        expect(0 < st3.get("bytes_parsed", 0) < st1.get("bytes_parsed", 0) * 2 and st3.get("files_linted") == 1
               and "bash_edit.py:3" in third.get("reason", ""),
               "an appended call parses only the new bytes and relints only the changed file", [st3, third])
    finally:
        shutil.rmtree(root, ignore_errors=True)
    if failures:
        print("\nlint-guard stop-hook proof FAILED:\n" + "\n".join(failures))
        return 1
    print("lint-guard stop-hook proof: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
