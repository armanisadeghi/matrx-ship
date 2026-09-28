#!/usr/bin/env python3
"""
deploy-reconciler — decide which apps ACTUALLY need rebuilding, from real git history.

WHY NOT JUST USE COOLIFY watch_paths?
    Coolify matches watch_paths against the GitHub push payload's commits[].modified array
    (app/Http/Controllers/Webhook/Github.php:50-53). GitHub OMITS that array on force-pushes
    and on pushes with >20 commits -- in which case changed_files is empty, nothing matches,
    and the deploy is silently SKIPPED. Worse, a FAILED build is never retried until some
    future commit happens to touch that path again. That is exactly why the 2026-05-02
    GHA paths-filter pipeline was reverted on 2026-05-10, and why Arman was reduced to
    committing fake change-files to force a rebuild.

THE FIX -- compare STATE, not EVENTS:
    For each app we ask one question:

        Does the image that is LIVE RIGHT NOW already contain the latest commit that
        touched this app's paths?

        git merge-base --is-ancestor <last_commit_touching_app_paths> <live_commit>

    If yes -> nothing to do. If no -> deploy.

    This is level-triggered, not edge-triggered, so it is immune to every failure mode above:
      - webhook never arrived / payload had no commits[]  -> still detected next tick
      - build failed                                      -> live commit is unchanged, so it
                                                             stays out-of-date and RETRIES
      - force-push / rebase                               -> compares real ancestry
      - 10 pushes in a row                                -> converges to ONE build

    ai-dream-server is deliberately NOT managed here. Its remaining Coolify deployment serves
    the temporary streaming plane. The API, worker, dashboard, and Studio are owned by ECS and
    must never be rebuilt from this host.

MODES
    --shadow  (default) report only. Writes nothing, deploys nothing. Use this to prove the
              reconciler agrees with reality before it takes over.
    --apply   actually POST to the Coolify deploy API for apps that are out of date.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field

REPO = "/root/projects/aidream"
BRANCH = "origin/main"
COOLIFY_TOKEN_FILE = "/root/.coolify-token"


@dataclass
class App:
    name: str
    uuid: str
    # Paths whose changes REQUIRE a rebuild of this app.
    paths: list[str]
    # Paths to subtract (used by the catch-all apps that build from the repo root).
    exclude: list[str] = field(default_factory=list)


# The dependency map. Deliberately conservative: when unsure, rebuild.
APPS = [
    App(
        name="scraper-service",
        uuid="yowos4cggg88kw0wwokw0s08",
        paths=[
            "packages/matrx-scraper/",
            "packages/matrx-utils/",
            "packages/matrx-connect/",
            "pyproject.toml",
            "uv.lock",
        ],
    ),
]


def git(*args: str) -> str:
    return subprocess.run(
        ["git", "-C", REPO, *args],
        capture_output=True, text=True, check=True,
    ).stdout.strip()


def live_commit(uuid: str) -> str | None:
    """The commit of the image actually running right now -- ground truth, not intent.

    Coolify tags images as <app-uuid>:<commit-sha>, so the running container's image tag
    IS the deployed commit. We read the container, not the deployment queue, because a
    queue row can say 'finished' for a build whose container later died and rolled back.
    """
    names = subprocess.run(
        ["docker", "ps", "--filter", f"name={uuid}", "--format", "{{.Names}}"],
        capture_output=True, text=True,
    ).stdout.split()

    for name in names:
        # .Config.Image is the reference the container was STARTED from, and it survives
        # the tag being deleted underneath it. `docker ps --format {{.Image}}` does not:
        # it degrades to a bare image ID once the tag is gone (which our own image
        # retention does routinely). Coolify reads it the same way -- CleanupDocker.php:151.
        ref = subprocess.run(
            ["docker", "inspect", "--format", "{{.Config.Image}}", name],
            capture_output=True, text=True,
        ).stdout.strip()
        repo, _, tag = ref.rpartition(":")
        if repo == uuid and len(tag) >= 7:
            return tag
    return None


def last_commit_touching(app: App) -> str | None:
    """The newest commit on the branch that changed anything this app is built from."""
    pathspec: list[str] = list(app.paths)
    pathspec += [f":(exclude){p}" for p in app.exclude]
    out = git("log", "-1", "--format=%H", BRANCH, "--", *pathspec)
    return out or None


def is_ancestor(ancestor: str, descendant: str) -> bool:
    rc = subprocess.run(
        ["git", "-C", REPO, "merge-base", "--is-ancestor", ancestor, descendant],
        capture_output=True,
    ).returncode
    return rc == 0


def coolify_deploy(uuid: str) -> tuple[bool, str]:
    env: dict[str, str] = {}
    with open(COOLIFY_TOKEN_FILE) as fh:
        for line in fh:
            line = line.strip()
            if line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip().strip("'\"")

    url = f"{env['COOLIFY_API_URL']}/deploy?uuid={uuid}"
    req = urllib.request.Request(
        url, method="GET",
        headers={"Authorization": f"Bearer {env['COOLIFY_TOKEN']}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return True, resp.read().decode()[:200]
    except urllib.error.HTTPError as exc:
        return False, f"HTTP {exc.code}: {exc.read().decode()[:200]}"
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)


def main() -> int:
    ap = argparse.ArgumentParser()
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--shadow", action="store_true", default=True)
    mode.add_argument("--apply", action="store_true")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--quiet", action="store_true",
                    help="shadow/cron: print nothing when every app is already up to date")
    args = ap.parse_args()
    apply = args.apply

    # Read-only: updates remote-tracking refs, never touches the working tree.
    subprocess.run(["git", "-C", REPO, "fetch", "--quiet", "origin", "main"], check=False)
    head = git("rev-parse", BRANCH)

    results = []
    for app in APPS:
        live = live_commit(app.uuid)
        needed = last_commit_touching(app)

        if needed is None:
            verdict, reason = "up-to-date", "no commit has ever touched this app's paths"
        elif live is None:
            verdict, reason = "DEPLOY", "no running container -- app is down"
        elif live == needed:
            verdict, reason = "up-to-date", f"live == required ({live[:8]})"
        elif is_ancestor(needed, live):
            verdict, reason = (
                "up-to-date",
                f"live {live[:8]} already contains {needed[:8]}",
            )
        else:
            verdict, reason = (
                "DEPLOY",
                f"live {live[:8]} is missing {needed[:8]} "
                f"({git('log', '-1', '--format=%s', needed)[:60]!r})",
            )

        results.append(
            {
                "app": app.name,
                "uuid": app.uuid,
                "live_commit": live,
                "required_commit": needed,
                "verdict": verdict,
                "reason": reason,
            }
        )

    stale = [r for r in results if r["verdict"] == "DEPLOY"]

    if args.quiet and not stale and not args.json:
        # Shadow cron: silence the steady state so the log shows only real divergences.
        return 0

    if args.quiet and stale and not apply and not args.json:
        from datetime import datetime, timezone
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        print(f"[{stamp}] SHADOW: reconciler would deploy "
              f"{', '.join(r['app'] for r in stale)} (branch @ {head[:8]})")
        for r in stale:
            print(f"    {r['app']}: {r['reason']}")
        return 0

    if args.json:
        print(json.dumps({"head": head, "results": results}, indent=2))
    else:
        print(f"branch {BRANCH} @ {head[:8]}   mode={'APPLY' if apply else 'SHADOW (read-only)'}")
        print(f"{'app':<18} {'live':<10} {'required':<10} verdict")
        print("-" * 78)
        for r in results:
            live = (r["live_commit"] or "none")[:8]
            req = (r["required_commit"] or "none")[:8]
            print(f"{r['app']:<18} {live:<10} {req:<10} {r['verdict']}  -- {r['reason']}")
        print()
        if not stale:
            print("All managed apps are up to date. No builds needed.")
            print("(Under the CURRENT setup, a push right now would rebuild all of them anyway.)")
        else:
            print(f"{len(stale)} app(s) need a build: {', '.join(r['app'] for r in stale)}")

    if apply:
        for r in stale:
            ok, detail = coolify_deploy(r["uuid"])
            print(f"  deploy {r['app']}: {'queued' if ok else 'FAILED'} -- {detail}")
    elif stale:
        print("\nSHADOW MODE: nothing was deployed. Re-run with --apply to act.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
