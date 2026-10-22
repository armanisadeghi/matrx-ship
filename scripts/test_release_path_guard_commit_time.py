#!/usr/bin/env python3
"""The release-path guard at COMMIT time (2026-10-22): `test_release_path_never_blocked.py --static --staged`.

On a scratch repo named like a real one, staging real-looking hook / ship.sh edits:
  1. a pre-push hook that ADDS an unexplained `exit 1` refuses the commit;
  2. the same exit inside a refuse() that checks MATRX_RELEASE_PATH first passes;
  3. `# release-path-ok: network` passes; an off-list reason (`lint`) refuses;
  4. an old unexplained exit on a line this commit does not touch never refuses (diff-scoped);
  5. a staged ship.sh that stops exporting MATRX_RELEASE_PATH=1 refuses (wiring);
  6. with MATRX_RELEASE_PATH=1 (the release path itself) it is a no-op;
  7. the REAL pre-commit hooks of aidream and matrx-frontend run it when such a file is staged
     (each hook copied into the scratch repo; skipped, named, when not checked out).

Run:  python3 ~/code/matrx-ship/scripts/test_release_path_guard_commit_time.py
      RELEASE_GUARD_PATH=<old copy> ... runs the same proof against another guard (fail-before).
"""
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.realpath(__file__))
GUARD = os.environ.get("RELEASE_GUARD_PATH") or os.path.join(HERE, "test_release_path_never_blocked.py")
CODE = os.path.expanduser(os.environ.get("MATRX_CODE_DIR", "~/code"))

HOOK_BASE = """#!/bin/sh
root=$(git rev-parse --show-toplevel) || exit 1
echo "old refusal"
exit 1
"""
REFUSE_GATED = """refuse() {
    if [ "${MATRX_RELEASE_PATH:-0}" = "1" ]; then
        python3 "$HOME/code/matrx-ship/scripts/release-scream.py" --repo x --check "$1" || true
        return 0
    fi
    echo "PUSH REFUSED: $1" >&2
    exit 1
}
"""
SHIP_OK = "#!/bin/sh\nexport MATRX_RELEASE_PATH=1\npython3 scripts/sync-main.py\n"


# Run from a pre-commit hook, git exports GIT_INDEX_FILE / GIT_DIR for the OUTER repo; a scratch-repo
# `git add` that inherits them writes into the outer commit's index (2026-10-22: it did). Never inherit them.
CLEAN_ENV = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}


def run(args, cwd, env=None, check=True):
    r = subprocess.run(args, cwd=cwd, env=env if env is not None else CLEAN_ENV, capture_output=True, text=True, timeout=300)
    if check and r.returncode != 0:
        raise AssertionError("%s: %s" % (" ".join(args), r.stderr[-400:]))
    return r


def main():
    tmp = os.path.realpath(tempfile.mkdtemp(prefix="release-guard-commit-"))
    failures = []

    def expect(cond, what, got=""):
        print(("ok   " if cond else "FAIL ") + what)
        if not cond:
            failures.append("%s\n    got: %s" % (what, str(got)[-500:]))

    def scratch(name, hooks_dir):
        repo = os.path.join(tmp, name)
        run(["git", "init", "-q", "-b", "main", repo], tmp)
        for k, v in (("user.email", "g@t"), ("user.name", "g")):
            run(["git", "config", k, v], repo)
        os.makedirs(os.path.join(repo, hooks_dir))
        write(repo, hooks_dir + "/pre-push", HOOK_BASE)
        write(repo, "ship.sh", SHIP_OK)
        run(["git", "add", "-A"], repo)
        run(["git", "commit", "-q", "--no-verify", "-m", "base"], repo)
        return repo

    def write(repo, rel, text):
        p = os.path.join(repo, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w") as f:
            f.write(text)

    env = {k: v for k, v in CLEAN_ENV.items() if k != "MATRX_RELEASE_PATH"}

    def guard(repo, extra_env=None):
        r = run([sys.executable, GUARD, "--static", "--staged", "--repo", repo], repo, dict(env, **(extra_env or {})), check=False)
        return r.returncode, r.stdout + r.stderr

    def stage(repo, rel, text):
        run(["git", "reset", "-q"], repo)
        run(["git", "checkout", "-q", "--", "."], repo)
        write(repo, rel, text)
        run(["git", "add", "--", rel], repo)

    try:
        repo = scratch("aidream", ".githooks")
        stage(repo, ".githooks/pre-push", HOOK_BASE + 'if true; then\n    echo "lint failed"\n    exit 1\nfi\n')
        rc, out = guard(repo)
        expect(rc == 1 and "pre-push:7" in out, "a pre-push hook that adds an unexplained exit 1 refuses the commit", out)

        stage(repo, ".githooks/pre-push", HOOK_BASE + REFUSE_GATED)
        rc, out = guard(repo)
        expect(rc == 0, "the same exit inside a refuse() gated on MATRX_RELEASE_PATH passes", out)

        stage(repo, ".githooks/pre-push", HOOK_BASE + "git fetch -q origin || exit 1  # release-path-ok: network\n")
        rc, out = guard(repo)
        expect(rc == 0, "`release-path-ok: network` passes", out)
        stage(repo, ".githooks/pre-push", HOOK_BASE + 'echo "eslint said no"\nexit 1  # release-path-ok: lint\n')
        rc, out = guard(repo)
        expect(rc == 1, "an off-list reason (`release-path-ok: lint`) refuses", out)

        stage(repo, ".githooks/pre-push", HOOK_BASE + "echo unrelated new line\n")
        rc, out = guard(repo)
        expect(rc == 0, "an old unexplained exit on a line this commit does not touch never refuses", out)

        stage(repo, "ship.sh", "#!/bin/sh\npython3 scripts/sync-main.py\n")
        rc, out = guard(repo)
        expect(rc == 1 and "MATRX_RELEASE_PATH=1" in out, "a staged ship.sh that stops exporting MATRX_RELEASE_PATH=1 refuses", out)

        stage(repo, ".githooks/pre-push", HOOK_BASE + 'echo "lint failed"\nexit 1\n')
        rc, out = guard(repo, {"MATRX_RELEASE_PATH": "1"})
        expect(rc == 0, "on the release path (MATRX_RELEASE_PATH=1) the commit-time guard is a no-op", out)

        # 7. the real pre-commit hooks wire it in.
        for name, hooks_dir in (("aidream", ".githooks"), ("matrx-frontend", "scripts/githooks")):
            real = os.path.join(CODE, name, hooks_dir, "pre-commit")
            if not os.path.isfile(real):
                print("SKIP %s pre-commit (not checked out)" % name)
                continue
            hrepo = repo if name == "aidream" else scratch(name, hooks_dir)
            shutil.copy(real, os.path.join(hrepo, hooks_dir, "pre-commit"))
            os.chmod(os.path.join(hrepo, hooks_dir, "pre-commit"), 0o755)
            run(["git", "config", "core.hooksPath", hooks_dir], hrepo)
            stage(hrepo, hooks_dir + "/pre-push", HOOK_BASE + 'echo "lint failed"\nexit 1\n')
            r = run(["git", "commit", "-q", "-m", "plant"], hrepo, env, check=False)
            expect(r.returncode != 0 and "RELEASE PATH CAN BE BLOCKED" in r.stderr,
                   "%s's real pre-commit refuses a staged pre-push that adds an unexplained exit" % name, r.stderr)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    if failures:
        print("\nrelease-path commit-time proof FAILED:\n" + "\n".join(failures))
        return 1
    print("release-path commit-time proof: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
