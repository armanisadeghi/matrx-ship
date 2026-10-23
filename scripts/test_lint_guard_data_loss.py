#!/usr/bin/env python3
"""lint-guard's write-time DATA-LOSS guard, end to end on a scratch repo (2026-10-22, audit 57).

Planted: a 0-byte file, a 95%-shrunk file, a broken .py -> LOUD finding naming the file with sizes (check
--worktree, check --staged refusing the commit, the Stop hook for a file a Bash command wrote). A normal edit
-> nothing. Under MATRX_RELEASE_PATH=1 the staged check prints and exits 0 (never holds a release).

Run:  python3 ~/code/matrx-ship/scripts/test_lint_guard_data_loss.py
      LINT_GUARD_PATH=<old copy> ... proves the fail-before side.
"""
import json, os, shutil, subprocess, sys, tempfile, time, uuid

HERE = os.path.dirname(os.path.realpath(__file__))
GUARD = os.environ.get("LINT_GUARD_PATH") or os.path.join(HERE, "lint-guard.py")
ENV = {k: v for k, v in os.environ.items() if not k.startswith("GIT_") and k != "MATRX_RELEASE_PATH"}


def git(repo, *a):
    return subprocess.run(["git", "-C", repo, *a], check=True, capture_output=True, text=True, env=ENV).stdout


def guard(args, env=None, stdin=None):
    return subprocess.run([sys.executable, GUARD, *args], capture_output=True, text=True, input=stdin, env=dict(ENV, **(env or {})), timeout=120)


def main():
    root = os.path.realpath(tempfile.mkdtemp(prefix="lint-guard-loss-"))
    fails = []

    def expect(c, what, got=""):
        print(("ok   " if c else "FAIL ") + what)
        if not c:
            fails.append(f"{what}\n    got: {str(got)[:500]}")

    try:
        repo = os.path.join(root, "aidream")
        git(root, "init", "-q", "-b", "main", repo)
        git(repo, "config", "user.email", "t@t"); git(repo, "config", "user.name", "t")
        big = "".join(f"def f{i}():\n    return {i}\n" for i in range(60))
        for n in ("empty.py", "shrink.py", "broken.py", "normal.py", "data.txt"):
            open(os.path.join(repo, n), "w").write(big)
        git(repo, "add", "-A"); git(repo, "commit", "-q", "-m", "base")
        P = lambda n: os.path.join(repo, n)

        # 1. a normal edit: no finding.
        open(P("normal.py"), "w").write(big + "x = 1\n")
        r = guard(["check", "--repo", repo, "--worktree", "normal.py"])
        expect(r.returncode == 0 and "data-loss" not in r.stderr, "a normal edit is not flagged", r.stderr)

        # 2. the exact incident: open(p, "w") before the read.
        script = f'p={P("empty.py")!r}\nopen(p, "w").write(open(p).read().replace("zzz", "y"))\n'
        subprocess.run([sys.executable, "-c", script], capture_output=True)
        open(P("shrink.py"), "w").write("x = 1\n")
        open(P("broken.py"), "w").write(big + "def (:\n")
        r = guard(["check", "--repo", repo, "--worktree"])
        expect(r.returncode == 1 and "empty.py" in r.stderr and "0 BYTES" in r.stderr and "-> 0 bytes" in r.stderr, "0-byte file flagged with sizes", r.stderr)
        expect("shrink.py" in r.stderr and "SHRANK" in r.stderr, "95% shrink flagged", r.stderr)
        expect("broken.py" in r.stderr and "PARSES" in r.stderr, "unparseable .py flagged", r.stderr)
        expect("normal.py" not in r.stderr, "the normal edit stays quiet in the same run", r.stderr)

        # 3. pre-commit path: staged empty file refuses; the release path only prints.
        git(repo, "add", "empty.py")
        r = guard(["check", "--repo", repo, "--staged"])
        expect(r.returncode == 1 and "empty.py" in r.stderr, "staged 0-byte file refuses the commit", r.stderr)
        r = guard(["check", "--repo", repo, "--staged"], env={"MATRX_RELEASE_PATH": "1"})
        expect(r.returncode == 0 and "empty.py" in r.stderr, "release path: warns loudly, holds nothing", (r.returncode, r.stderr))
        r = guard(["check", "--repo", repo, "--staged"], env={"LINT_GUARD_ALLOW_SHRINK": "1"})
        expect(r.returncode == 0, "deliberate rewrite escape", r.stderr)

        # 4. Stop hook: a file a BASH command wrote blocks that agent's turn; another lane's does not.
        now = time.time()
        t = os.path.join(root, "t.jsonl")
        iso = lambda x: time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(x))
        with open(t, "w") as fh:
            fh.write(json.dumps({"timestamp": iso(now - 30), "message": {"content": [{"type": "tool_use", "name": "Bash",
                     "input": {"command": f"cd {repo} && sed -i '' 's/q/q/' empty.py"}}]}}) + "\n")
        os.utime(P("empty.py"), (now - 10, now - 10))
        r = guard(["stop-hook"], env={"LINT_GUARD_CODE_ROOT": root, "LINT_GUARD_STATE_DIR": os.path.join(root, "st")},
                  stdin=json.dumps({"session_id": "s-" + uuid.uuid4().hex, "transcript_path": t, "cwd": repo}))
        out = json.loads(r.stdout) if r.stdout.strip() else {}
        expect(out.get("decision") == "block" and "empty.py" in out.get("reason", "") and "data-loss" in out.get("reason", ""), "Stop hook blocks the agent that touched the emptied file", r.stdout)
        expect("shrink.py" not in out.get("reason", ""), "files this session never touched do not block it", out.get("reason"))
        expect("shrink.py" in json.dumps(out.get("systemMessage", "")) or "shrink.py" in r.stderr, "…but are shouted as a warning", (r.stdout, r.stderr))
    finally:
        shutil.rmtree(root, ignore_errors=True)
    if fails:
        print("\nlint-guard data-loss proof FAILED:\n" + "\n".join(fails))
        return 1
    print("lint-guard data-loss proof: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
