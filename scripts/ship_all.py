#!/usr/bin/env python3
"""ship_all — run ./ship.sh in every repo that needs it, skip the rest, report what is left.

Run:  code/scripts/ship-all.sh [--dry-run] [--only a,b] [--skip a,b] [--days N] [--jobs N]

For every git repository directly under the code folder (the parent of matrx-ship):
  1. inspect it: branch, uncommitted files, commits ahead of / behind GitHub, local branches,
     extra worktrees, remote branches, open pull requests.
  2. SKIP it when there is nothing to sync: no uncommitted files and not ahead of or behind GitHub.
  3. otherwise run its ./ship.sh (sync with GitHub, then release) and keep the full output.
  4. only AFTER every ship has finished: list what is open in each _conflicts/README.md and, in
     ONE pass over the transcripts, the conversations (Claude Code / Codex) that edited each held
     file. Nothing slow ever runs before or between releases.

Repos are checked in parallel and shipped in parallel (--jobs, default 4). Every ship prints a
START line, streams its output live prefixed with the repo name, and an END line with its time.

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
import threading
import time
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.realpath(__file__))   # real location, even when run through code/scripts/
CODE = os.path.dirname(os.path.dirname(HERE))          # .../code
OUT_ROOT = os.path.expanduser("~/.matrx/ship-all")
FIND_SESSIONS = os.path.join(HERE, "find-file-sessions.py")
# Never part of ship-all (Arman, 2026-09-24).
EXCLUDED = {"wordpress-infrastructure", "titanium-marketing-wordpress", "real-singles", "matrx-mobile", "ai-matrx-biz"}


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


def sessions_for_all(abs_paths, days):
    """{abs_path: [rows]} for every held file in every repo, in ONE pass over the transcripts."""
    if not abs_paths or not os.path.isfile(FIND_SESSIONS):
        return {}
    rc, out, err = run([sys.executable, FIND_SESSIONS, "--json", "--days", str(days)] + abs_paths,
                       CODE, timeout=600)
    try:
        return json.loads(out) if rc == 0 else {}
    except ValueError:
        return {}


PRINT = threading.Lock()


def say(msg):
    with PRINT:
        print(msg, flush=True)


def clock():
    return datetime.datetime.now().strftime("%H:%M:%S")


def fmt(sec):
    sec = int(sec)
    return "%dm%02ds" % (sec // 60, sec % 60) if sec >= 60 else "%ds" % sec


def ship(info, out_dir, stamp):
    """Run one repo's ./ship.sh. While it runs, one progress line; when it ends, its whole output
    is printed as ONE block (START, everything it printed, END) so nothing from another repo is
    mixed in. The full output is also in the log file."""
    name, repo = info["repo"], info["path"]
    log = os.path.join(out_dir, name + ".log")
    t0, started = time.time(), clock()
    say("… %-26s running (started %s)" % (name, started))
    lines = []
    with open(log, "w") as f:
        proc = subprocess.Popen(["bash", "./ship.sh", "ship-all %s" % stamp], cwd=repo,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, errors="replace", bufsize=1)
        for line in proc.stdout:
            f.write(line)
            f.flush()
            lines.append(line.rstrip("\n"))
        proc.wait()
    info["log"] = log
    info["ship_exit"] = proc.returncode
    info["seconds"] = round(time.time() - t0)
    summary = [l for l in lines if l.startswith("ship.sh: sync exit")]
    info["ship_summary"] = summary[-1] if summary else "(no summary line; see the log)"
    info["status"] = ("shipped" if proc.returncode == 0 and "sync exit 0" in info["ship_summary"]
                      else "shipped with problems")
    block = ["", "▶ START %s  %s  (%d uncommitted, %d ahead, %d behind)" % (
        name, started, info["dirty"], info["ahead"], info["behind"])]
    block += ["  " + l for l in lines]
    block.append("■ END   %s  %s  %s  took %s  (%s)  log: %s" % (
        name, clock(), info["status"], fmt(info["seconds"]),
        info["ship_summary"].replace("ship.sh: ", ""), log))
    say("\n".join(block))
    return info


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
    jobs = int(args[args.index("--jobs") + 1]) if "--jobs" in args else 4

    t_all = time.time()
    stamp = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    out_dir = os.path.join(OUT_ROOT, stamp)
    os.makedirs(out_dir, exist_ok=True)
    repos = [os.path.join(CODE, d) for d in sorted(os.listdir(CODE))
             if os.path.isdir(os.path.join(CODE, d, ".git")) and d not in EXCLUDED
             and not ((only and d not in only) or d in skip)]
    say("ship-all %s  (%s)%s" % (stamp, CODE, "  DRY RUN: nothing is shipped" if dry else ""))

    # ── 1. check every repo at once (fetch + read-only git) ──────────────────────────────
    t0 = time.time()
    say("▶ checking %d repos in parallel…" % len(repos))
    with ThreadPoolExecutor(max_workers=8) as pool:
        infos = list(pool.map(inspect, repos))
    to_ship = []
    for info in infos:
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
            to_ship.append(info)
        else:
            info["status"] = "to ship"
            to_ship.append(info)
    say("■ checked in %s: %d %s, %d skipped" % (fmt(time.time() - t0), len(to_ship), "would ship" if dry else "to ship",
                                                    len(infos) - len(to_ship)))

    # ── 2. ship, several at once ──────────────────────────────────────────────────────────
    if to_ship and not dry:
        t0 = time.time()
        say("▶ shipping %d repo(s), up to %d at a time…" % (len(to_ship), jobs))
        with ThreadPoolExecutor(max_workers=jobs) as pool:
            list(pool.map(lambda i: ship(i, out_dir, stamp), to_ship))
        say("■ all shipping finished in %s" % fmt(time.time() - t0))

    # ── 3. only now: what is open, and who edited each held file (one pass) ──────────────
    for info in infos:
        info["open_items"] = open_items(info["path"])
        info["held"] = held_files(info["path"])
    held_paths = [os.path.join(i["path"], h["file"]) for i in infos for h in i["held"]]
    if held_paths:
        t0 = time.time()
        say("▶ finding the conversations that edited %d held file(s)…" % len(held_paths))
        who = sessions_for_all(held_paths, days)
        for info in infos:
            for h in info["held"]:
                h["sessions"] = who.get(os.path.join(info["path"], h["file"]), [])
        say("■ found in %s" % fmt(time.time() - t0))

    say("")
    for info in infos:
        extras = []
        if info["open_items"]:
            extras.append("%d open item(s)" % len(info["open_items"]))
        for key, label in (("local_branches", "local branch"), ("extra_worktrees", "worktree"),
                           ("remote_branches", "remote branch")):
            if info[key]:
                extras.append("%d %s(es)" % (len(info[key]), label))
        if info["open_prs"]:
            extras.append("%d open PR(s)" % len(info["open_prs"]))
        took = fmt(info["seconds"]) if "seconds" in info else ""
        say("  %-28s %-24s %-7s before: uncommitted=%-4d ahead=%-3d behind=%-3d %s" % (
            info["repo"], info["status"], took, info["dirty"], info["ahead"], info["behind"], "  ".join(extras)))

    summary = {"stamp": stamp, "code_dir": CODE, "dry_run": dry, "seconds": round(time.time() - t_all),
               "repos": infos}
    for path in (os.path.join(out_dir, "summary.json"), os.path.join(OUT_ROOT, "latest.json")):
        with open(path, "w") as f:
            json.dump(summary, f, indent=2)

    open_repos = [r for r in infos if r["open_items"] or r["held"]]
    problems = [r for r in infos if r["status"] in ("shipped with problems", "could not reach GitHub")]
    say("")
    if open_repos:
        say("OPEN CONFLICT ITEMS")
        for r in open_repos:
            for item in r["open_items"]:
                say("  %s: %s" % (r["repo"], item))
            for h in r["held"]:
                edited = [s for s in h.get("sessions", []) if s["kind"] == "edited"][:3]
                who = ["%s %s %s (%s)" % (s["tool"], s["session"], s["last"], s.get("title", "")[:50]) for s in edited]
                say("    %s  edited by: %s" % (h["file"], "; ".join(who) or "no recent conversation found"))
    if problems:
        say("PROBLEMS")
        for r in problems:
            say("  %s: %s  %s" % (r["repo"], r["status"], r.get("log", r.get("fetch_error", ""))))
    say("done in %s. summary: %s" % (fmt(time.time() - t_all), os.path.join(out_dir, "summary.json")))
    sys.exit(1 if (open_repos or problems) else 0)


if __name__ == "__main__":
    main()
