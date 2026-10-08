#!/usr/bin/env python3
"""ship_all — run ./ship.sh in every repo that needs it, skip the rest, report what is left.

Run:  code/scripts/ship-all.sh [--dry-run] [--only a,b] [--skip a,b] [--days N] [--jobs N]

For every git repository directly under the code folder (the parent of matrx-ship):
  1. inspect it: branch, uncommitted files, commits ahead of / behind GitHub, local branches,
     extra worktrees, remote branches, open pull requests.
  2. SKIP it when there is nothing to sync: no uncommitted files, not ahead of or behind GitHub,
     and every @ai-matrx package at npm latest (its check:matrx-packages passes).
  3. otherwise run its ./ship.sh (sync with GitHub, then release) and keep the full output,
     then check the checkout now holds the origin/main seen in step 1: status NOT PULLED if not.
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

After every ship (step 3b), GitHub-side work is LANDED, not just reported (Arman, 2026-10-03:
"Why do we have any remote branches period?"): every open, non-draft pull request is merged
(merge commit, branch deleted); every remote branch with zero commits missing from origin/main is
deleted; a branch under deploy/ is a deploy pointer CI moves and is never touched. What could not
be landed (a PR GitHub cannot merge cleanly, a branch holding unmerged commits, a draft) is listed
under NEEDS LANDING for the running agent to merge by hand. @ai-matrx packages are measured again
after shipping; a folder still behind npm is a PROBLEM, not a footnote.
Local branches and worktrees are reported, never touched.
"""
import datetime
import fcntl
import json
import re
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

USAGE = """Usage: ship-all.sh [--dry-run] [--only REPOS] [--skip REPOS] [--days DAYS] [--jobs JOBS]

Run ./ship.sh in every eligible repository under the code directory.

Options:
  --dry-run          Report repositories that would ship without shipping them.
  --only REPOS       Comma-separated repository names to include.
  --skip REPOS       Comma-separated repository names to exclude.
  --days DAYS        Search this many days of conversation history (default: 3).
  --jobs JOBS        Ship at most this many repositories concurrently (default: 4).
  -h, --help         Show this help without inspecting, fetching, or shipping repositories.
"""


def parse_args(args):
    """Validate all CLI input before this process creates state or touches a repository."""
    if "--help" in args or "-h" in args:
        return None

    options = {"dry": False, "only": None, "skip": set(), "days": 3, "jobs": 4}
    seen = set()
    index = 0
    while index < len(args):
        arg = args[index]
        if arg == "--dry-run":
            if arg in seen:
                raise ValueError("--dry-run may only be passed once")
            seen.add(arg)
            options["dry"] = True
            index += 1
            continue
        if arg in ("--only", "--skip", "--days", "--jobs"):
            if arg in seen:
                raise ValueError("%s may only be passed once" % arg)
            seen.add(arg)
            if index + 1 >= len(args) or args[index + 1].startswith("-"):
                raise ValueError("%s requires a value" % arg)
            value = args[index + 1]
            if arg == "--only":
                names = [name.strip() for name in value.split(",")]
                if not all(names):
                    raise ValueError("--only must name at least one non-empty repository")
                options["only"] = set(names)
            elif arg == "--skip":
                names = [name.strip() for name in value.split(",")]
                if not all(names):
                    raise ValueError("--skip must name at least one non-empty repository")
                options["skip"] = set(names)
            else:
                try:
                    parsed = int(value)
                except ValueError:
                    raise ValueError("%s must be a positive integer" % arg)
                if parsed < 1:
                    raise ValueError("%s must be a positive integer" % arg)
                options["days" if arg == "--days" else "jobs"] = parsed
            index += 2
            continue
        raise ValueError("unknown argument: %s" % arg)
    return options


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
    _, ob, _ = git(repo, "rev-parse", "-q", "--verify", "origin/%s" % (info["branch"] or "main"))
    info["origin_before"] = ob.strip()
    _, heads, _ = git(repo, "for-each-ref", "refs/heads", "--format=%(refname:short)")
    info["local_branches"] = [h for h in lines(heads) if h != info["branch"]]
    _, wts, _ = git(repo, "worktree", "list", "--porcelain")
    info["extra_worktrees"] = [l.split(" ", 1)[1] for l in lines(wts) if l.startswith("worktree ")][1:]
    _, rbs, _ = git(repo, "for-each-ref", "refs/remotes/origin", "--format=%(refname:short)")
    info["remote_branches"] = [r for r in lines(rbs) if r not in ("origin/HEAD", "origin/main", "origin")]
    info["open_prs"] = open_prs(repo)
    info["stale_packages"] = stale_packages(repo)
    return info


def stale_packages(repo):
    """Folders (root, one level down) whose check:matrx-packages fails: @ai-matrx behind npm latest.
    Such a repo ships even when git is in sync, so sync-main brings its packages to latest."""
    stale = []
    for manifest in [os.path.join(repo, "package.json")] + sorted(
            os.path.join(repo, d, "package.json") for d in os.listdir(repo)):
        if not os.path.isfile(manifest) or "node_modules" in manifest:
            continue
        try:
            with open(manifest) as f:
                scripts = json.load(f).get("scripts") or {}
        except (OSError, ValueError):
            continue
        if "sync:matrx-packages" not in scripts or "check:matrx-packages" not in scripts:
            continue
        folder = os.path.dirname(manifest)
        tool = "npm" if os.path.isfile(os.path.join(folder, "package-lock.json")) else "pnpm"
        rc, _, _ = run([tool, "run", "-s", "check:matrx-packages"], folder, timeout=120)
        if rc != 0:
            stale.append(os.path.relpath(folder, repo))
    return stale


PROTECTED_BRANCH_PREFIXES = ("deploy/",)   # pointers CI moves (matrx-sandbox deploy/hosted)


def land_github_work(info):
    """Merge open PRs and delete fully merged remote branches; record what still needs a hand."""
    repo = info["path"]
    info["landed"], info["needs_landing"] = [], []
    git(repo, "fetch", "-q", "--prune", "origin", timeout=90)
    for pr in info.get("open_prs") or []:
        rc, out, _ = run(["gh", "pr", "view", str(pr["number"]), "--json", "isDraft,state"], repo, timeout=60)
        try:
            view = json.loads(out) if rc == 0 else {}
        except ValueError:
            view = {}
        if view.get("state") != "OPEN":
            continue
        if view.get("isDraft"):
            info["needs_landing"].append("PR #%s is a draft: %s" % (pr["number"], pr["url"]))
            continue
        rc, out, err = run(["gh", "pr", "merge", str(pr["number"]), "--merge", "--delete-branch"], repo, timeout=120)
        if rc == 0:
            info["landed"].append("merged PR #%s (%s)" % (pr["number"], pr["title"][:60]))
        else:
            info["needs_landing"].append("PR #%s cannot merge cleanly (%s): %s" % (
                pr["number"], (err or out).strip().splitlines()[0][:120] if (err or out).strip() else "no reason", pr["url"]))
    git(repo, "fetch", "-q", "--prune", "origin", timeout=90)
    _, rbs, _ = git(repo, "for-each-ref", "refs/remotes/origin", "--format=%(refname:short)")
    for ref in lines(rbs):
        if ref in ("origin/HEAD", "origin/main", "origin"):
            continue
        name = ref[len("origin/"):]
        if name.startswith(PROTECTED_BRANCH_PREFIXES):
            continue
        rc, cnt, _ = git(repo, "rev-list", "--count", "origin/main..%s" % ref)
        missing = int(cnt.strip() or 0) if rc == 0 else -1
        if missing == 0:
            rc, _, err = git(repo, "push", "-q", "origin", "--delete", name, timeout=60)
            if rc == 0:
                info["landed"].append("deleted merged branch %s" % name)
            else:
                info["needs_landing"].append("branch %s is merged but could not be deleted: %s" % (name, err.strip()[:120]))
        else:
            info["needs_landing"].append("branch %s holds %s commit(s) not on main" % (name, missing))
    _, rbs, _ = git(repo, "for-each-ref", "refs/remotes/origin", "--format=%(refname:short)")
    info["remote_branches_after"] = [r for r in lines(rbs) if r not in ("origin/HEAD", "origin/main", "origin")]


def open_prs(repo):
    rc, out, _ = run(["gh", "pr", "list", "--state", "open", "--json", "number,title,headRefName,url",
                      "--limit", "50"], repo, timeout=60)
    if rc != 0:
        return None          # gh missing or not a GitHub repo: unknown, not zero
    try:
        return json.loads(out)
    except ValueError:
        return None


def active_release_slot(info):
    """Fail closed before dispatching a second release for a busy provider lane."""
    name, repo = info["repo"], info["path"]
    if name in ("aidream", "matrx-local"):
        workflows = ("deploy.yml",) if name == "aidream" else ("off-host-release.yml", "release.yml")
        label = "AI Dream" if name == "aidream" else "Matrx Local"
        active = ("queued", "pending", "waiting", "in_progress", "requested", "action_required")
        for workflow in workflows:
            # One call per workflow (not one per status): six calls per lane per round used to
            # exhaust the GitHub API quota, and a rate-limit 403 then read as a busy slot.
            for attempt in range(3):
                rc, out, err = run(["gh", "run", "list", "--workflow", workflow, "--limit", "100",
                                    "--json", "status"], repo, timeout=45)
                if rc == 0 or "rate limit" not in err.lower() or attempt == 2:
                    break
                time.sleep(30)
            if rc != 0:
                return "%s release status could not be verified: %s" % (label, err.strip()[:200])
            try:
                runs = json.loads(out)
            except ValueError:
                return "%s release status was not valid JSON" % label
            if not isinstance(runs, list) or any(not isinstance(item, dict) for item in runs):
                return "%s release status had an unexpected shape" % label
            if any(item.get("status") in active for item in runs):
                return "%s has an active or queued release workflow" % label
    elif name == "matrx-frontend":
        for project in ("ai-matrx", "ai-matrx-manage", "ai-matrx-demos"):
            cursor, seen = None, set()
            for _ in range(100):
                cmd = ["vercel", "list", project, "--status", "BUILDING,QUEUED,INITIALIZING",
                       "--format=json"]
                if cursor is not None:
                    cmd += ["--next", str(cursor)]
                rc, out, err = run(cmd, repo, timeout=45)
                if rc != 0:
                    return "%s release status could not be verified: %s" % (project, err.strip()[:200])
                try:
                    listing = json.loads(out)
                except ValueError:
                    return "%s release status was not valid JSON" % project
                if not isinstance(listing, dict) or not isinstance(listing.get("deployments"), list):
                    return "%s release status had an unexpected shape" % project
                for deployment in listing["deployments"]:
                    if not isinstance(deployment, dict) or not isinstance(deployment.get("meta"), (dict, type(None))):
                        return "%s release status had an unexpected shape" % project
                    message = (deployment.get("meta") or {}).get("githubCommitMessage") or ""
                    if not isinstance(message, str):
                        return "%s release status had an unexpected shape" % project
                    if (deployment.get("state") in ("BUILDING", "QUEUED", "INITIALIZING")
                            and message.startswith(("release:", "release-all:", "release-admin:", "release-demos:"))):
                        return "%s has an active or queued release build" % project
                pagination = listing.get("pagination")
                if not isinstance(pagination, dict):
                    return "%s release status had an unexpected shape" % project
                cursor = pagination.get("next")
                if cursor is None:
                    break
                if not isinstance(cursor, int) or cursor in seen:
                    return "%s release status pagination could not be verified" % project
                seen.add(cursor)
            else:
                return "%s release status exceeded the safe page limit" % project
    return None


# ── Is the last release LIVE? (a push is not a release; Arman 2026-10-07: seven ai-matrx
# releases in a row ERRORed on Vercel for 3h while every round reported "shipped") ──────
LIVE_CHECK_SH = r'''
set -u
source scripts/release-outcome.sh >/dev/null 2>&1 || exit 0
sha="$1"; msg="$2"
case "$msg" in release-all:*) t=all;; release-admin:*) t=admin;; release-demos:*) t=demos;; release-lab:*) t=lab;; *) t=main;; esac
for bt in $(release_outcome_targets "$t"); do
  release_outcome_would_build "$msg" "$bt" || continue
  pid=$(release_outcome_project_id "$bt"); IFS=$'\t' read -r st uid url < <(release_outcome_fetch "$pid" "$sha")
  served=""; [ "$st" = READY ] && served=$(release_outcome_serving "$(release_outcome_domain "$bt")" | head -1)
  printf '%s\t%s\t%s\t%s\t%s\n' "$(release_outcome_project_name "$bt")" "$st" "$uid" "$url" "$served"
done
'''


def release_liveness(info):
    """For repos that deploy through Vercel (scripts/release-outcome.sh): the state of the
    newest release commits on origin/main. Returns problem lines; [] when the newest release
    is live, or still building within 40 minutes of its push with nothing failed before it."""
    repo = info["path"]
    if not os.path.isfile(os.path.join(repo, "scripts", "release-outcome.sh")):
        return []
    rc, out, _err = git(repo, "log", "origin/main", "-200", "--format=%H%x09%ct%x09%s")
    rels = [l.split("\t", 2) for l in lines(out) if re.match(r"^release(-[a-z]+)?: ", l.split("\t", 2)[-1])][:3]
    if not rels:
        return []
    states = []
    for sha, ct, subj in rels:
        p = subprocess.run(["bash", "-c", LIVE_CHECK_SH, "x", sha, subj], cwd=repo, capture_output=True, text=True, timeout=180)
        rows = [r.split("\t") for r in lines(p.stdout)]
        states.append((sha, int(ct), subj.split(" - ")[0], rows))
    def live(rows):
        return rows and all(r[1] == "READY" and (r[4] == "" or r[4] == r[2]) for r in rows)
    def failed(rows):
        return any(r[1] in ("ERROR", "CANCELED") for r in rows)
    sha, ct, name, rows = states[0]
    age_min = (time.time() - ct) / 60
    if live(rows):
        return []
    if any(r[1] in ("NO_TOKEN", "UNREACHABLE") for r in rows):
        return ["%s: LAST RELEASE UNVERIFIED — no Vercel answer (%s)" % (name, ", ".join("%s %s" % (r[0], r[1]) for r in rows))]
    prior_failed = [s for s in states[1:] if failed(s[3])]
    if not failed(rows) and age_min < 40 and not prior_failed:
        return []
    out = []
    for s_sha, s_ct, s_name, s_rows in states:
        bad = ["%s %s %s" % (r[0], r[1] if not (r[1] == "READY" and r[4] and r[4] != r[2]) else "READY-NOT-SERVING", r[3]) for r in s_rows
               if not (r[1] == "READY" and (r[4] == "" or r[4] == r[2]))]
        if bad:
            out.append("%s (%s, %d min ago) NOT LIVE: %s" % (s_name, s_sha[:10], (time.time() - s_ct) / 60, "; ".join(bad)))
    return out


RELEASE_WORKFLOW = re.compile(r"release|publish|deploy|nominate", re.I)


def failed_release_workflows(info):
    """Every release/publish/deploy GitHub workflow whose NEWEST finished run failed (a later
    success clears it; cancelled/skipped runs are superseded, not verdicts)."""
    repo = info["path"]
    if not os.path.isdir(os.path.join(repo, ".github", "workflows")):
        return []
    rc, out, err = run(["gh", "run", "list", "--limit", "40", "--json",
                        "databaseId,workflowName,conclusion,status,url,createdAt,displayTitle"], repo, 60)
    if rc != 0:
        return ["release workflows UNVERIFIED — gh could not answer: %s" % (err.strip().splitlines() or ["?"])[-1][:160]]
    seen, bad = set(), []
    for r in json.loads(out or "[]"):
        name = r.get("workflowName") or ""
        if not RELEASE_WORKFLOW.search(name) or name in seen or r.get("status") != "completed":
            continue
        if r.get("conclusion") in ("cancelled", "skipped", "neutral"):
            continue
        seen.add(name)
        if r.get("conclusion") != "success":
            bad.append("workflow '%s' %s (%s) %s — gh run view %s --log-failed" % (
                name, r.get("conclusion"), r.get("createdAt", "")[:16], r.get("url", ""), r.get("databaseId")))
    return bad


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
    """Serialize check-and-dispatch across concurrent ship-all processes per repo."""
    lock_dir = os.path.join(OUT_ROOT, "locks")
    os.makedirs(lock_dir, exist_ok=True)
    with open(os.path.join(lock_dir, info["repo"] + ".lock"), "a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        return _ship_locked(info, out_dir, stamp)


def _ship_locked(info, out_dir, stamp):
    """Run one repo's ./ship.sh. While it runs, one progress line; when it ends, its whole output
    is printed as ONE block (START, everything it printed, END) so nothing from another repo is
    mixed in. The full output is also in the log file."""
    name, repo = info["repo"], info["path"]
    slot_blocker = active_release_slot(info)
    if slot_blocker:
        info["status"] = "RELEASE SLOT BUSY"
        info["release_slot_blocker"] = slot_blocker
        info["seconds"] = 0
        say("■ HOLD  %s  %s — no second release dispatched" % (name, slot_blocker))
        return info
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
    release_slot_busy = proc.returncode == 75 or any("RELEASE SLOT BUSY" in line for line in lines)
    hosted_release_dispatched = (proc.returncode == 0 and "sync exit 0" in info["ship_summary"]
                                 and any("dispatch-off-host-release: hosted release requested" in line
                                         for line in lines))
    info["status"] = ("RELEASE SLOT BUSY" if release_slot_busy
                      else "release dispatched" if hosted_release_dispatched
                      else "shipped" if proc.returncode == 0 and "sync exit 0" in info["ship_summary"]
                      else "shipped with problems")
    # Whatever ship.sh says, the checkout must now hold everything GitHub had when we checked.
    # matrx-extend's ship.sh once pulled only after a successful release and sat 21 commits behind.
    if info["origin_before"] and git(repo, "merge-base", "--is-ancestor", info["origin_before"], "HEAD")[0] != 0:
        _, n, _ = git(repo, "rev-list", "--count", "HEAD..%s" % info["origin_before"])
        info["not_pulled"] = int(n.strip() or 0)
        info["status"] = "NOT PULLED"
    block = ["", "▶ START %s  %s  (%d uncommitted, %d ahead, %d behind)" % (
        name, started, info["dirty"], info["ahead"], info["behind"])]
    block += ["  " + l for l in lines]
    if info.get("not_pulled"):
        block.append("  ✗ ship-all: this checkout is still missing %d commit(s) GitHub's main had "
                     "before the ship; its ship.sh did not pull them." % info["not_pulled"])
    block.append("■ END   %s  %s  %s  took %s  (%s)  log: %s" % (
        name, clock(), info["status"], fmt(info["seconds"]),
        info["ship_summary"].replace("ship.sh: ", ""), log))
    say("\n".join(block))
    return info


def main(args=None):
    args = sys.argv[1:] if args is None else args
    try:
        options = parse_args(args)
    except ValueError as error:
        say("error: %s" % error)
        say(USAGE.rstrip())
        return 2
    if options is None:
        say(USAGE.rstrip())
        return 0

    dry = options["dry"]
    only, skip = options["only"], options["skip"]
    days, jobs = options["days"], options["jobs"]

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
        needs = info["dirty"] > 0 or info["ahead"] > 0 or info["behind"] > 0 or bool(info["stale_packages"])
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

    # ── 3b. land GitHub-side work and re-measure packages (the "after" truth) ─────────────
    if not dry:
        t0 = time.time()
        say("▶ landing open PRs / merged branches and re-checking packages…")
        def after(info):
            if info["fetch_ok"] and info["branch"] == "main":
                land_github_work(info)
            info["stale_packages_after"] = stale_packages(info["path"]) if info["stale_packages"] else []
        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(after, infos))
        say("■ landed in %s" % fmt(time.time() - t0))
    for info in infos:
        try:
            info["not_live"] = (release_liveness(info) + failed_release_workflows(info)) if info["fetch_ok"] else []
        except Exception as error:  # never let the check vanish silently
            info["not_live"] = ["release liveness check crashed: %s" % error]

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
        if "remote_branches_after" in info:
            info["remote_branches_before"], info["remote_branches"] = info["remote_branches"], info["remote_branches_after"]
        for key, label in (("local_branches", "local branch"), ("extra_worktrees", "worktree"),
                           ("remote_branches", "remote branch")):
            if info[key]:
                extras.append("%d %s(es)" % (len(info[key]), label))
        if info["open_prs"]:
            extras.append("%d open PR(s)" % len(info["open_prs"]))
        if info.get("landed"):
            extras.append("landed: %d" % len(info["landed"]))
        if info.get("stale_packages_after"):
            extras.append("@ai-matrx packages STILL behind npm in %s" % ", ".join(info["stale_packages_after"]))
        elif info["stale_packages"] and not dry:
            extras.append("@ai-matrx packages caught up")
        elif info["stale_packages"]:
            extras.append("@ai-matrx packages behind npm in %s" % ", ".join(info["stale_packages"]))
        took = fmt(info["seconds"]) if "seconds" in info else ""
        say("  %-28s %-24s %-7s before: uncommitted=%-4d ahead=%-3d behind=%-3d %s" % (
            info["repo"], info["status"], took, info["dirty"], info["ahead"], info["behind"], "  ".join(extras)))

    summary = {"stamp": stamp, "code_dir": CODE, "dry_run": dry, "seconds": round(time.time() - t_all),
               "repos": infos}
    for path in (os.path.join(out_dir, "summary.json"), os.path.join(OUT_ROOT, "latest.json")):
        with open(path, "w") as f:
            json.dump(summary, f, indent=2)

    open_repos = [r for r in infos if r["open_items"] or r["held"]]
    problems = [r for r in infos if r["status"] in ("shipped with problems", "could not reach GitHub", "NOT PULLED", "RELEASE SLOT BUSY")]
    stale_after = [r for r in infos if r.get("stale_packages_after")]
    landing = [r for r in infos if r.get("needs_landing")]
    not_live = [r for r in infos if r.get("not_live")]
    say("")
    if not_live:
        say("RELEASES NOT LIVE — EVERYTHING ELSE STOPS: read the failing build log, fix the cause, ship, watch the new build until it is live")
        for r in not_live:
            for line in r["not_live"]:
                say("  %s: %s" % (r["repo"], line))
    for r in infos:
        for line in r.get("landed", []):
            say("  LANDED  %s: %s" % (r["repo"], line))
    if landing:
        say("NEEDS LANDING (merge by hand into main, then delete the branch)")
        for r in landing:
            for line in r["needs_landing"]:
                say("  %s: %s" % (r["repo"], line))
    if stale_after:
        say("PACKAGES STILL BEHIND NPM (pnpm update -r \"@ai-matrx/*\" --latest in that folder, adopt Consumer actions, ship)")
        for r in stale_after:
            say("  %s: %s" % (r["repo"], ", ".join(r["stale_packages_after"])))
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
            say("  %s: %s  %s" % (r["repo"], r["status"], r.get("release_slot_blocker", r.get("log", r.get("fetch_error", "")))))
    say("done in %s. summary: %s" % (fmt(time.time() - t_all), os.path.join(out_dir, "summary.json")))
    return 1 if (open_repos or problems or landing or stale_after or not_live) else 0


if __name__ == "__main__":
    raise SystemExit(main())
