#!/usr/bin/env python3
"""ship_all — run ./ship.sh in every repo that needs it, skip the rest, report what is left.

Run:  matrx-ship/scripts/ship-all.sh [--dry-run] [--only a,b] [--skip a,b] [--days N]

For every git repository directly under the code folder (the parent of matrx-ship):
  1. inspect it: branch, uncommitted files, commits ahead of / behind GitHub, local branches,
     extra worktrees, remote branches, open pull requests.
  2. SKIP it when there is nothing to sync: no uncommitted files and not ahead of or behind GitHub.
  3. otherwise run its ./ship.sh (sync with GitHub, then release) and keep the full output.
  4. list what is open in its _conflicts/README.md afterwards, plus, for every held file, the
     conversations (Claude Code / Codex) that edited that file recently.

Output
  - one line per repo on the terminal, then a list of everything still open
  - ~/.matrx/ship-all/<stamp>/summary.json  and  ~/.matrx/ship-all/latest.json  (same content)
  - ~/.matrx/ship-all/<stamp>/<repo>.log     the full ./ship.sh output for every repo that ran
Exit 0 when every shipped repo finished and nothing is open; 1 otherwise.

Branches, worktrees and pull requests are reported, never touched: ./ship.sh syncs main only.
"""
import datetime
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.realpath(__file__))   # real location, even when run through code/scripts/
CODE = os.path.dirname(os.path.dirname(HERE))          # .../code
OUT_ROOT = os.path.expanduser("~/.matrx/ship-all")
FIND_SESSIONS = os.path.join(HERE, "find-file-sessions.py")


def run(cmd, cwd, timeout=120):
    try:
        r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout, r.stderr
    except subprocess.TimeoutExpired:
        return 124, "", "timed out"


def git(repo, *args, timeout=120):
    return run(["git", *args], repo, timeout)


def lines(text):
    return [l for l in text.splitlines() if l.strip()]


def inspect(repo):
    info = {"repo": os.path.basename(repo), "path": repo}
    _, br, _ = git(repo, "symbolic-ref", "-q", "--short", "HEAD")
    info["branch"] = br.strip()
    info["has_ship"] = os.path.isfile(os.path.join(repo, "ship.sh"))
    rc, _, err = git(repo, "fetch", "-q", "--prune", "origin", timeout=90)
    info["fetch_ok"] = rc == 0
    if rc != 0:
        info["fetch_error"] = err.strip()[:300]
    _, st, _ = git(repo, "status", "--porcelain")
    info["dirty"] = len(lines(st))
    rc, ab, _ = git(repo, "rev-list", "--left-right", "--count", "HEAD...origin/%s" % (info["branch"] or "main"))
    a, b = (ab.split() + ["0", "0"])[:2] if rc == 0 else ("0", "0")
    info["ahead"], info["behind"] = int(a), int(b)
    _, heads, _ = git(repo, "for-each-ref", "refs/heads", "--format=%(refname:short)")
    info["local_branches"] = [h for h in lines(heads) if h != info["branch"]]
    _, wts, _ = git(repo, "worktree", "list", "--porcelain")
    info["extra_worktrees"] = [l.split(" ", 1)[1] for l in lines(wts) if l.startswith("worktree ")][1:]
    _, rbs, _ = git(repo, "for-each-ref", "refs/remotes/origin", "--format=%(refname:short)")
    info["remote_branches"] = [r for r in lines(rbs) if r not in ("origin/HEAD", "origin/main", "origin")]
    info["open_prs"] = open_prs(repo)
    return info


def open_prs(repo):
    rc, out, _ = run(["gh", "pr", "list", "--state", "open", "--json", "number,title,headRefName,url",
                      "--limit", "50"], repo, timeout=60)
    if rc != 0:
        return None          # gh missing or not a GitHub repo: unknown, not zero
    try:
        return json.loads(out)
    except ValueError:
        return None


def open_items(repo):
    checker = os.path.join(repo, "scripts", "check-conflict-markers.py")
    if not os.path.isfile(checker):
        return []
    _, out, _ = run([sys.executable, checker], repo)
    return [l for l in lines(out) if not l.startswith("clean:") and "item(s) need attention" not in l]


def held_files(repo):
    root = os.path.join(repo, "_conflicts")
    found = []
    for d, _, files in os.walk(root):
        for f in files:
            if f.endswith(".held"):
                held = os.path.relpath(os.path.join(d, f), repo)
                parts = held.split(os.sep)
                original = os.sep.join(parts[2:])[: -len(".held")]      # _conflicts/<stamp>/<path>.held
                found.append({"held": held, "file": original})
    return found


def sessions_for(repo, path, days):
    if not os.path.isfile(FIND_SESSIONS):
        return []
    rc, out, _ = run([sys.executable, FIND_SESSIONS, "--json", "--days", str(days),
                      os.path.join(repo, path)], repo, timeout=300)
    try:
        return json.loads(out) if rc == 0 else []
    except ValueError:
        return []


def main():
    args = sys.argv[1:]
    dry = "--dry-run" in args
    def listarg(name):
        if name in args:
            i = args.index(name)
            return set(x for x in args[i + 1].split(",") if x)
        return None
    only, skip = listarg("--only"), listarg("--skip") or set()
    days = int(args[args.index("--days") + 1]) if "--days" in args else 3

    stamp = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    out_dir = os.path.join(OUT_ROOT, stamp)
    os.makedirs(out_dir, exist_ok=True)
    repos = sorted(os.path.join(CODE, d) for d in os.listdir(CODE)
                   if os.path.isdir(os.path.join(CODE, d, ".git")))
    results = []
    print("ship-all %s  (%s)%s" % (stamp, CODE, "  DRY RUN: nothing is shipped" if dry else ""))
    for repo in repos:
        name = os.path.basename(repo)
        if (only and name not in only) or name in skip:
            continue
        info = inspect(repo)
        needs = info["dirty"] > 0 or info["ahead"] > 0 or info["behind"] > 0
        if not info["has_ship"]:
            info["status"] = "no ship.sh"
        elif info["branch"] != "main":
            info["status"] = "not on main (on %s)" % (info["branch"] or "detached HEAD")
        elif not info["fetch_ok"]:
            info["status"] = "could not reach GitHub"
        elif not needs:
            info["status"] = "skipped (in sync)"
        elif dry:
            info["status"] = "would ship"
        else:
            log = os.path.join(out_dir, name + ".log")
            with open(log, "w") as f:
                r = subprocess.run(["bash", "./ship.sh", "ship-all %s" % stamp], cwd=repo,
                                   stdout=f, stderr=subprocess.STDOUT)
            info["log"] = log
            info["ship_exit"] = r.returncode
            tail = open(log, errors="replace").read().splitlines()
            summary = [l for l in tail if l.startswith("ship.sh: sync exit")]
            info["ship_summary"] = summary[-1] if summary else "(no summary line; see the log)"
            info["status"] = "shipped" if r.returncode == 0 and "sync exit 0" in info["ship_summary"] else "shipped with problems"
        info["open_items"] = open_items(repo)
        info["held"] = held_files(repo)
        for h in info["held"]:
            h["sessions"] = sessions_for(repo, h["file"], days)
        results.append(info)
        extras = []
        if info["open_items"]:
            extras.append("%d open item(s)" % len(info["open_items"]))
        for key, label in (("local_branches", "local branch"), ("extra_worktrees", "worktree"),
                           ("remote_branches", "remote branch")):
            if info[key]:
                extras.append("%d %s(es)" % (len(info[key]), label))
        if info["open_prs"]:
            extras.append("%d open PR(s)" % len(info["open_prs"]))
        print("  %-28s %-24s dirty=%-4d ahead=%-3d behind=%-3d %s" % (
            name, info["status"], info["dirty"], info["ahead"], info["behind"], "  ".join(extras)))

    summary = {"stamp": stamp, "code_dir": CODE, "dry_run": dry, "repos": results}
    for path in (os.path.join(out_dir, "summary.json"), os.path.join(OUT_ROOT, "latest.json")):
        with open(path, "w") as f:
            json.dump(summary, f, indent=2)

    open_repos = [r for r in results if r["open_items"] or r["held"]]
    problems = [r for r in results if r["status"] in ("shipped with problems", "could not reach GitHub")]
    print("")
    if open_repos:
        print("OPEN CONFLICT ITEMS")
        for r in open_repos:
            for item in r["open_items"]:
                print("  %s: %s" % (r["repo"], item))
            for h in r["held"]:
                who = ["%s %s (%s) %s" % (s["tool"], s["session"], s["last"], s.get("title", "")[:60])
                       for s in h["sessions"][:3]]
                print("    %s  edited by: %s" % (h["file"], "; ".join(who) or "no recent conversation found"))
    if problems:
        print("PROBLEMS")
        for r in problems:
            print("  %s: %s  %s" % (r["repo"], r["status"], r.get("log", r.get("fetch_error", ""))))
    print("summary: %s" % os.path.join(out_dir, "summary.json"))
    sys.exit(1 if (open_repos or problems) else 0)


if __name__ == "__main__":
    main()
