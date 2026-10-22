#!/usr/bin/env python3
"""THE RELEASE PATH IS NEVER BLOCKED — the guard (Arman 2026-09-24 / 10-02 / 10-21).

"The release SCRIPT is never permitted to block anything." "Report warnings and errors and release."
2026-10-21: aidream's pre-push settings ratchet refused the release push and held 55 commits;
matrx-frontend's ship.sh said "release skipped" whenever its sync failed. No web release 14:52-20:41 PT.

What this proves, per repo, with a REAL git push into a throwaway bare remote:
  1. A PLANTED failing check in the repo's own pre-push hook still REFUSES an ordinary push (the
     check is armed; write-time and ordinary-push quality stay with the developer).
  2. The SAME push with MATRX_RELEASE_PATH=1 (what ship.sh / release.sh export) LANDS on the remote
     and prints the RELEASE WARNING banner (release-scream.py; mail disabled in the test).
  3. Wiring: each release-train ship.sh / scripts/release.sh exports MATRX_RELEASE_PATH=1 and no
     ship.sh skips its release when the sync fails.

Run:  python3 ~/code/matrx-ship/scripts/test_release_path_never_blocked.py
      RELEASE_GUARD_HOOK_REV=<rev> ... reads every hook at <rev> (fail-before proof).
Repos not checked out beside matrx-ship are skipped (named), never passed silently.
"""
import os
import shutil
import subprocess
import sys
import tempfile

CODE = os.path.expanduser(os.environ.get("MATRX_CODE_DIR", "~/code"))
REV = os.environ.get("RELEASE_GUARD_HOOK_REV", "")
FAIL_PY = "import sys\nprint('PLANTED FAILING CHECK')\nsys.exit(1)\n"
PASS_PY = "import sys\nsys.exit(0)\n"
FAIL_MJS = "console.error('PLANTED FAILING CHECK');\nprocess.exit(1);\n"

# repo -> (hook path in the repo, planted files {path: text}, file the pushed commit changes)
CASES = {
    "aidream": (".githooks/pre-push",
                {"scripts/check_hardcoded_settings.py": FAIL_PY,
                 "scripts/check_pushed_relative_imports.py": PASS_PY},
                "aidream/x.py"),
    "matrx-frontend": ("scripts/githooks/pre-push",
                       {"scripts/check-matrx-imports.mjs": FAIL_MJS},
                       "pnpm-lock.yaml"),
    "matrx-sandbox": (".githooks/pre-push",
                      {"orchestrator/tests/test_config_attestation_wiring.py": "def test_planted():\n    assert False, 'PLANTED FAILING CHECK'\n"},
                      "orchestrator/x.py"),
}
# Release-train and hooked repos whose ship.sh must export the flag and never skip the release.
SHIP_WIRING = ["aidream", "matrx-frontend", "matrx-sandbox", "matrx-local"]
RELEASE_WIRING = ["aidream", "matrx-frontend"]


def sh(args, cwd, env=None, check=True):
    r = subprocess.run(args, cwd=cwd, env=env, capture_output=True, text=True, timeout=600)
    if check and r.returncode != 0:
        raise AssertionError("%s failed (%d): %s" % (" ".join(args), r.returncode, r.stderr[-800:]))
    return r


def hook_text(repo, path):
    if REV:
        return sh(["git", "show", "%s:%s" % (REV, path)], os.path.join(CODE, repo)).stdout
    with open(os.path.join(CODE, repo, path)) as f:
        return f.read()


def write(root, rel, text, mode=None):
    p = os.path.join(root, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w") as f:
        f.write(text)
    if mode:
        os.chmod(p, mode)


def check_hook(repo):
    hook, plants, changed = CASES[repo]
    tmp = tempfile.mkdtemp(prefix="release-guard-%s-" % repo)
    try:
        remote, work = os.path.join(tmp, "origin.git"), os.path.join(tmp, "work")
        sh(["git", "init", "-q", "--bare", "-b", "main", remote], tmp)
        sh(["git", "init", "-q", "-b", "main", work], tmp)
        for k, v in (("user.email", "guard@test"), ("user.name", "guard"), ("core.hooksPath", os.path.dirname(hook))):
            sh(["git", "config", k, v], work)
        sh(["git", "remote", "add", "origin", remote], work)
        write(work, hook, hook_text(repo, hook), 0o755)
        for rel, text in plants.items():
            write(work, rel, text)
        write(work, changed, "first\n")
        sh(["git", "add", "-A"], work)
        sh(["git", "commit", "-q", "--no-verify", "-m", "base"], work)
        sh(["git", "push", "-q", "--no-verify", "origin", "HEAD:refs/heads/main"], work)
        write(work, changed, "second\n")
        sh(["git", "commit", "-q", "--no-verify", "-am", "change"], work)
        head = sh(["git", "rev-parse", "HEAD"], work).stdout.strip()
        env = {k: v for k, v in os.environ.items() if k not in ("MATRX_RELEASE_PATH", "MATRX_LOCK_IMPORTS_CHECKED")}
        env["MATRX_RELEASE_SCREAM_NO_MAIL"] = "1"
        plain = sh(["git", "push", "origin", "HEAD:refs/heads/main"], work, env, check=False)
        remote_tip = sh(["git", "rev-parse", "main"], remote).stdout.strip()
        assert plain.returncode != 0 and remote_tip != head, (
            "%s: the planted failing check did NOT refuse an ordinary push (the check is not armed):\n%s"
            % (repo, plain.stderr[-600:]))
        rel_env = dict(env, MATRX_RELEASE_PATH="1")
        rel = sh(["git", "push", "origin", "HEAD:refs/heads/main"], work, rel_env, check=False)
        remote_tip = sh(["git", "rev-parse", "main"], remote).stdout.strip()
        assert rel.returncode == 0 and remote_tip == head, (
            "%s: a failing check BLOCKED the release-path push (MATRX_RELEASE_PATH=1):\n%s" % (repo, rel.stderr[-900:]))
        assert "RELEASE WARNING" in rel.stderr, "%s: the release-path push did not scream:\n%s" % (repo, rel.stderr[-600:])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def read(repo, rel):
    try:
        if REV:
            return sh(["git", "show", "%s:%s" % (REV, rel)], os.path.join(CODE, repo)).stdout
        with open(os.path.join(CODE, repo, rel)) as f:
            return f.read()
    except (OSError, AssertionError):
        return None


def check_wiring():
    bad = []
    for repo in SHIP_WIRING:
        text = read(repo, "ship.sh")
        if text is None:
            print("SKIP wiring %s (not checked out)" % repo)
            continue
        if "export MATRX_RELEASE_PATH=1" not in text:
            bad.append("%s/ship.sh does not export MATRX_RELEASE_PATH=1" % repo)
        code = "\n".join(l for l in text.splitlines() if not l.lstrip().startswith("#"))
        if "release skipped" in code or "was not dispatched" in code:
            bad.append("%s/ship.sh still skips the release when its sync fails" % repo)
    for repo in RELEASE_WIRING:
        text = read(repo, "scripts/release.sh")
        if text is not None and "export MATRX_RELEASE_PATH=1" not in text:
            bad.append("%s/scripts/release.sh does not export MATRX_RELEASE_PATH=1" % repo)
    assert not bad, "\n".join(bad)


def main():
    failures = []
    for repo in CASES:
        if not os.path.isdir(os.path.join(CODE, repo, ".git")):
            print("SKIP %s (not checked out)" % repo)
            continue
        try:
            check_hook(repo)
            print("ok   %s: failing pre-push check refuses an ordinary push, reports and lets the release push land" % repo)
        except AssertionError as e:
            failures.append(str(e))
            print("FAIL %s" % str(e).splitlines()[0])
    try:
        check_wiring()
        print("ok   wiring: ship.sh / release.sh export MATRX_RELEASE_PATH=1; no ship.sh skips its release")
    except AssertionError as e:
        failures.append(str(e))
        print("FAIL wiring:\n" + str(e))
    if failures:
        print("\n".join(["", "THE RELEASE PATH CAN BE BLOCKED:"] + failures))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
