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

  4. Generic (2026-10-22, less brittle than the fixed lists): every non-zero exit (`exit N`, `sys.exit(N)`,
     `raise SystemExit(N)`, `process.exit(N)`) in a release-path file — ship.sh, scripts/release.sh,
     scripts/sync-main.py, a pre-push hook — must carry an allowlisted reason: it sits in a function that
     checks MATRX_RELEASE_PATH first (the hooks' refuse()), it is a git/cd plumbing failure, its own line or
     the 3 above name a build / network / lock / in-progress / usage / conflict failure, or it carries
     `release-path-ok: <reason>` with a reason from RELEASE_OK_REASONS. At commit time (--staged) only the
     lines that commit ADDS are judged and an unexplained one refuses the commit; the full run lists the
     existing ones as review items and never fails on them (a scream at the writer, not a new block).

Run:  python3 ~/code/matrx-ship/scripts/test_release_path_never_blocked.py
      RELEASE_GUARD_HOOK_REV=<rev> ... reads every hook at <rev> (fail-before proof).
      ... --static                        the file checks only (no pushes; seconds), every repo.
      ... --static --staged --repo <repo> [files]
                                          COMMIT TIME (each repo's pre-commit, when a git hook, ship.sh,
                                          release.sh or sync-main.py is staged): the static and wiring checks
                                          that name these files, plus the generic exit check on the lines this
                                          commit adds, read from the index. Exit 1 = refuse the commit. Never on
                                          the release path: MATRX_RELEASE_PATH=1 makes it a no-op.
Repos not checked out beside matrx-ship are skipped (named), never passed silently.
"""
import os
import re
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


# (repo, file, text that must NOT appear in code lines, text that MUST appear) — gates that used to stop a release.
STATIC = [
    ("matrx-frontend", "package.json", None, "process.env.VERCEL || process.env.CI || process.env.MATRX_RELEASE_PATH"),
    ("matrx-frontend", "scripts/release.sh", 'fail "pnpm-lock.yaml in the release tree has @ai-matrx twins', "RELEASED ANYWAY"),
    ("matrx-desktop", "scripts/dist-mac.sh", "packaged-app smoke failed on the signed build; nothing published", 'scream "packaged-app smoke failed'),
    ("matrx-desktop", "scripts/local-release-gate.sh", None, 'BUILD_STEPS=("build")'),
    ("aidream", ".github/actions/npm-publish-one/action.yml", "nothing newer on main will release it.\"\n        exit 1", "PUBLISHED ANYWAY"),
    ("aidream", "scripts/npm-release-plan.mjs", "process.exitCode = 3", "const gateReported = new Map(blocked)"),
    ("aidream", ".github/workflows/publish-npm-package.yml", "npm publish BLOCKED::${b.dir}: ${b.reason}`);\n          '\n          exit 1", "PUBLISHED ANYWAY"),
    ("matrx-extend", "release.sh", 'hard_stop "mandatory checks failed for $NEW_TAG', "report_check_failure()"),
    ("matrx-extend", "release.sh", None, 'scream_release "$name" "$name failed (exit $rc)'),
    ("matrx-extend", "scripts/test-release-ship-path.sh", 'touch "$SANDBOX/fail-tests"', "a lint failure is reported and the release is pushed"),
]


def check_static():
    bad = []
    for repo, rel, forbidden, required in STATIC:
        text = read(repo, rel)
        if text is None:
            print("SKIP static %s/%s (not checked out)" % (repo, rel))
            continue
        if forbidden and forbidden in text:
            bad.append("%s/%s still stops the release: %r" % (repo, rel, forbidden[:70]))
        if required and required not in text:
            bad.append("%s/%s lacks its report-only path: %r" % (repo, rel, required[:70]))
    assert not bad, "\n".join(bad)


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


# ---------------------------------------------------------------- generic: every exit needs a reason

RELEASE_OK_REASONS = ("build", "network", "lock", "in-progress", "usage", "git", "conflict", "not-release-path")
RELEASE_PATH_FILE = re.compile(r"^(ship\.sh|scripts/release\.sh|scripts/sync-main\.py|\.githooks/pre-push|scripts/githooks/pre-push)$")
COMMIT_TIME_FILE = re.compile(r"^(ship\.sh|scripts/release\.sh|scripts/sync-main\.py|\.githooks/[^/]+|scripts/githooks/[^/]+)$")
NONZERO_EXIT = re.compile(r"(?:^|[\s;&|{(])(?:exit\s+[1-9]\d*\b(?!\s*\))|exit\s+\$\?|(?:sys\.)?exit\(\s*[1-9]\d*\s*\)"
                          r"|raise\s+SystemExit\(\s*[1-9]|process\.exit\(\s*[1-9]|process\.exitCode\s*=\s*[1-9])")
MARKER = re.compile(r"release-path-ok:\s*([a-z-]+)")
REASON_TEXT = re.compile(r"(?<![A-Za-z])(build|compil\w*|network|unreachable|timed?[ -]?out|lock\w*|in progress|EX_TEMPFAIL|usage"
                         r"|not a git|conflict\w*|offline)(?![A-Za-z])", re.I)
PLUMBING = re.compile(r"(^|[\s;(])(git\s|cd\s|GIT_INDEX_FILE=|mkdir\s|mktemp)[^#]*\|\|\s*(exit|return)\b")
FUNC_START = re.compile(r"^\s*(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\)\s*\{|^\s*def\s+\w+\(|^\s*(?:async\s+)?function\s+\w+\(")


def exit_reason(lines, i):
    """Why the non-zero exit on lines[i] may stand on the release path, or None (unexplained)."""
    window = lines[max(0, i - 3):i + 1]
    for row in window:
        m = MARKER.search(row)
        if m:
            return m.group(1) if m.group(1) in RELEASE_OK_REASONS else None
    j = i
    while j >= 0 and i - j < 80 and not FUNC_START.search(lines[j]):
        j -= 1
    if j >= 0 and FUNC_START.search(lines[j]) and "MATRX_RELEASE_PATH" in "\n".join(lines[j:i]):
        return "not-release-path"
    # an `if MATRX_RELEASE_PATH ...; then ... exit 0; fi` just above: the release path already left
    for k in range(i - 1, max(-1, i - 16), -1):
        if "MATRX_RELEASE_PATH" in lines[k]:
            if any(re.search(r"\b(exit|return)\s+0\b", r) for r in lines[k:i]):
                return "not-release-path"
            break
    if PLUMBING.search(lines[i]):
        return "git"
    if re.search(r"exit\s*\(?\s*75\b", lines[i]):
        return "in-progress"  # EX_TEMPFAIL: another release holds the slot; the next run ships
    if any(REASON_TEXT.search(row) for row in window):
        return "named"
    return None


def unexplained_exits(text, only_lines=None):
    """[(line number, line)] of non-zero exits without a reason; only_lines limits it to those numbers."""
    lines = text.splitlines()
    out = []
    for i, row in enumerate(lines):
        code = row.split("#", 1)[0] if not row.lstrip().startswith(("//", "*")) else ""
        if not NONZERO_EXIT.search(code):
            continue
        if only_lines is not None and i + 1 not in only_lines:
            continue
        if exit_reason(lines, i) is None:
            out.append((i + 1, row.strip()))
    return out


def added_lines(repo_dir, rel):
    """New-side line numbers the staged change adds to rel (all of them for a new file)."""
    r = subprocess.run(["git", "diff", "--cached", "-U0", "--no-color", "--", rel], cwd=repo_dir, capture_output=True, text=True)
    nums = set()
    for row in r.stdout.splitlines():
        m = re.match(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@", row)
        if m:
            start, count = int(m.group(1)), int(m.group(2) if m.group(2) is not None else 1)
            nums.update(range(start, start + count))
    return nums


def check_generic(report_only=True):
    """Full run: every release-path file of every repo; unexplained exits are review items (printed)."""
    items = []
    for repo in sorted(set(SHIP_WIRING) | set(RELEASE_WIRING) | set(CASES) | {"matrx-ship"}):
        for rel in ("ship.sh", "scripts/release.sh", "scripts/sync-main.py", ".githooks/pre-push", "scripts/githooks/pre-push"):
            text = read(repo, rel)
            if text is None:
                continue
            items += ["%s/%s:%d  %s" % (repo, rel, n, row[:110]) for n, row in unexplained_exits(text)]
    return items


def staged_static(repo_dir, files):
    """Commit-time: the checks that name these files, read from the index. -> list of findings."""
    repo = os.path.basename(os.path.realpath(repo_dir))
    if not files:
        r = subprocess.run(["git", "diff", "--cached", "--name-only", "--diff-filter=AMR"], cwd=repo_dir, capture_output=True, text=True)
        files = [f for f in r.stdout.splitlines() if COMMIT_TIME_FILE.match(f)]
    bad = []

    def blob(rel):
        r = subprocess.run(["git", "show", ":%s" % rel], cwd=repo_dir, capture_output=True, text=True)
        return r.stdout if r.returncode == 0 else None

    for rel in files:
        text = blob(rel)
        if text is None:
            continue
        for srepo, srel, forbidden, required in STATIC:
            if srepo == repo and srel == rel:
                if forbidden and forbidden in text:
                    bad.append("%s/%s still stops the release: %r" % (repo, rel, forbidden[:70]))
                if required and required not in text:
                    bad.append("%s/%s lacks its report-only path: %r" % (repo, rel, required[:70]))
        code = "\n".join(l for l in text.splitlines() if not l.lstrip().startswith("#"))
        if rel == "ship.sh" and repo in SHIP_WIRING:
            if "export MATRX_RELEASE_PATH=1" not in text:
                bad.append("%s/ship.sh does not export MATRX_RELEASE_PATH=1" % repo)
            if "release skipped" in code or "was not dispatched" in code:
                bad.append("%s/ship.sh skips the release when its sync fails" % repo)
        if rel == "scripts/release.sh" and repo in RELEASE_WIRING and "export MATRX_RELEASE_PATH=1" not in text:
            bad.append("%s/scripts/release.sh does not export MATRX_RELEASE_PATH=1" % repo)
        if RELEASE_PATH_FILE.match(rel):
            for n, row in unexplained_exits(text, added_lines(repo_dir, rel)):
                bad.append("%s/%s:%d adds a non-zero exit with no allowlisted reason: %s\n"
                           "      the release path never blocks — scream (release-scream.py) and go on, or gate it on "
                           "MATRX_RELEASE_PATH, or mark a real build/network/lock failure `# release-path-ok: <%s>`"
                           % (repo, rel, n, row[:100], "|".join(RELEASE_OK_REASONS)))
    return bad


def cmd_static(argv):
    staged = "--staged" in argv
    repo_dir, files, i = None, [], 0
    while i < len(argv):
        if argv[i] == "--repo":
            repo_dir, i = argv[i + 1], i + 2
            continue
        if not argv[i].startswith("--"):
            files.append(argv[i])
        i += 1
    if staged:
        if os.environ.get("MATRX_RELEASE_PATH") == "1":
            return 0  # commit time only: never on the release path
        try:
            bad = staged_static(repo_dir or os.getcwd(), files)
        except Exception as e:  # the guard's own bug never refuses anyone's commit; it says so
            print("release-path guard: internal failure (%s: %s); nothing was checked." % (type(e).__name__, e), file=sys.stderr)
            return 0
        if bad:
            print("RELEASE PATH CAN BE BLOCKED by this commit:\n  " + "\n  ".join(bad), file=sys.stderr)
            return 1
        return 0
    failures = []
    for name, fn in (("wiring", check_wiring), ("static", check_static)):
        try:
            fn()
            print("ok   %s" % name)
        except AssertionError as e:
            failures.append(str(e))
            print("FAIL %s:\n%s" % (name, e))
    review = check_generic()
    print("review: %d non-zero exit(s) on release-path files carry no allowlisted reason (not a failure; new ones refuse "
          "at commit time)%s" % (len(review), (":\n  " + "\n  ".join(review)) if review else ""))
    return 1 if failures else 0


def main():
    if "--static" in sys.argv[1:]:
        return cmd_static([a for a in sys.argv[1:] if a != "--static"])
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
    try:
        check_static()
        print("ok   static: twins, desktop smoke/gate, npm sibling hold, gate verdicts and extend's release checks are report-only")
    except AssertionError as e:
        failures.append(str(e))
        print("FAIL static:\n" + str(e))
    review = check_generic()
    print("review: %d non-zero exit(s) on release-path files carry no allowlisted reason (not a failure; new ones refuse "
          "at commit time)%s" % (len(review), (":\n  " + "\n  ".join(review)) if review else ""))
    if failures:
        print("\n".join(["", "THE RELEASE PATH CAN BE BLOCKED:"] + failures))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
