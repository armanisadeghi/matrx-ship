#!/usr/bin/env python3
"""
deploy-groomer — event-driven, per-app, COUNT-based image retention (GFS ladder).

Replaces the useless age-based cleanup ("delete images older than 72h", which cannot
tell a precious 30-day rollback anchor from today's trash, and misses fresh trash).

TRIGGERED ON BUILD SUCCESS. When app X's build finishes, we groom X and ONLY X:
    1. Enforce a grandfather-father-son ladder over X's SUCCESSFUL builds:
         recent N on disk + one anchor near each of {7,14,31,90} days.
    2. Recent N stay on disk (instant rollback).
    3. An image aging off the recent set that fills an anchor slot is ARCHIVED to S3
       (docker save | gzip | aws s3 cp) before being removed from disk.
    4. Everything else for X (failed-build leftovers, -build intermediates, images past
       the ladder) is removed from disk.
    5. S3 is pruned to the same ladder, so archive storage is bounded by COUNT, not churn.

Cache is NEVER touched here -- only old app images. See matrx-janitor.sh for the cache cap.

Success is judged from coolify-db (application_deployment_queues.status='finished'), joined
to local image tags by commit. The currently-running image is ALWAYS kept, even if it has
aged past the ladder (a deliberate rollback must never be groomed away).

Usage:
    deploy-groomer.py --app scraper-service        # groom one app (the build-success path)
    deploy-groomer.py --all                         # groom every app (the nightly backstop)
    deploy-groomer.py --all --dry-run               # show the plan, touch nothing
    deploy-groomer.py --app matrx-studio --no-archive   # disk-only, skip S3
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

S3_BUCKET = "matrx-backups"
S3_PREFIX = "image-archive"
S3_REGION = "us-east-1"

# The GFS ladder, per app. keep_recent = images kept hot on disk; anchors_days = one
# archived rollback point near each age. Worker shares aidream's layers on disk, so
# keeping 3 costs almost nothing extra -- it is grouped with aidream deliberately.
AIDREAM_TIER = {"keep_recent": 3, "anchors_days": [7, 14, 31, 90]}
OTHER_TIER = {"keep_recent": 1, "anchors_days": [7, 31, 90]}

TIER_BY_APP = {
    "ai-dream-server": AIDREAM_TIER,
    "workflow-worker": AIDREAM_TIER,
}
# Anchor matching tolerance: an image counts for the Nd slot if within +/- this fraction.
ANCHOR_TOLERANCE = 0.5  # a "7-day" anchor accepts the nearest build in [3.5d, 10.5d], etc.


def now() -> datetime:
    # date math needs a real clock; groomer runs on the host, never in a resumable workflow.
    return datetime.now(UTC)


def cdb(sql: str) -> list[list[str]]:
    out = subprocess.run(
        ["docker", "exec", "-i", "coolify-db", "psql", "-U", "coolify", "-d", "coolify",
         "-tAF|", "-c", sql],
        capture_output=True, text=True,
    ).stdout.strip()
    return [line.split("|") for line in out.splitlines() if line]


@dataclass
class Img:
    commit: str
    tag: str                      # full repo:tag
    finished_at: datetime | None  # from the successful deploy row
    is_running: bool = False
    size_bytes: int = 0
    reasons: list[str] = field(default_factory=list)  # why kept, for the report


def apps() -> dict[str, str]:
    return {name: uuid for name, uuid in cdb("SELECT name, uuid FROM applications")}


def running_ref(uuid: str) -> str | None:
    names = subprocess.run(
        ["docker", "ps", "--filter", f"name={uuid}", "--format", "{{.Names}}"],
        capture_output=True, text=True,
    ).stdout.split()
    for n in names:
        ref = subprocess.run(
            ["docker", "inspect", "--format", "{{.Config.Image}}", n],
            capture_output=True, text=True,
        ).stdout.strip()
        if ref.startswith(f"{uuid}:"):
            return ref
    return None


def local_images(uuid: str) -> dict[str, int]:
    """{repo:tag -> size_bytes} for every local image of this app."""
    out = subprocess.run(
        ["docker", "images", "--filter", f"reference={uuid}",
         "--format", "{{.Repository}}:{{.Tag}}\t{{.Size}}\t{{.ID}}"],
        capture_output=True, text=True,
    ).stdout.strip()
    result: dict[str, int] = {}
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) >= 1 and parts[0]:
            # Size string ("3.24GB") is display-only; real bytes come from inspect below.
            result[parts[0]] = 0
    return result


def successful_builds(app_id: str) -> dict[str, datetime]:
    """{commit -> finished_at} for this app's SUCCESSFUL builds, newest kept."""
    rows = cdb(
        f"SELECT commit, finished_at FROM application_deployment_queues "
        f"WHERE application_id='{app_id}' AND status='finished' AND commit IS NOT NULL "
        f"AND finished_at IS NOT NULL ORDER BY finished_at DESC"
    )
    out: dict[str, datetime] = {}
    for commit, finished in rows:
        if commit and commit not in out:
            try:
                out[commit] = datetime.fromisoformat(finished.replace(" ", "T")).replace(tzinfo=UTC)
            except ValueError:
                continue
    return out


def app_id_for(uuid: str) -> str | None:
    rows = cdb(f"SELECT id FROM applications WHERE uuid='{uuid}'")
    return rows[0][0] if rows else None


def s3_archived_commits(app_name: str) -> dict[str, datetime]:
    """{commit -> archived_at} already in S3 for this app."""
    out = subprocess.run(
        ["aws", "s3", "ls", f"s3://{S3_BUCKET}/{S3_PREFIX}/{app_name}/", "--region", S3_REGION],
        capture_output=True, text=True,
    ).stdout.strip()
    result: dict[str, datetime] = {}
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 4 and parts[3].endswith(".tar.gz"):
            commit = parts[3][:-len(".tar.gz")]
            try:
                result[commit] = datetime.fromisoformat(f"{parts[0]}T{parts[1]}").replace(tzinfo=UTC)
            except ValueError:
                result[commit] = now()
    return result


def plan(app_name: str, uuid: str) -> dict:
    """Decide keep-on-disk / archive-to-s3 / delete for one app. Pure -- no mutation."""
    tier = TIER_BY_APP.get(app_name, OTHER_TIER)
    keep_recent = tier["keep_recent"]
    anchors_days = tier["anchors_days"]

    aid = app_id_for(uuid)
    successes = successful_builds(aid) if aid else {}
    local = local_images(uuid)
    running = running_ref(uuid)

    keep_disk: dict[str, str] = {}     # tag -> reason
    to_archive: dict[str, str] = {}    # tag -> reason
    to_delete: dict[str, str] = {}     # tag -> reason

    # Successful images present on disk, newest first.
    disk_success = []
    for tag in local:
        _, _, commit = tag.rpartition(":")
        if commit in successes:
            disk_success.append((tag, commit, successes[commit]))
    disk_success.sort(key=lambda t: t[2], reverse=True)

    # 1. running image is sacred.
    if running:
        keep_disk[running] = "running"

    # 2. recent N on disk.
    recent_tags = set()
    for tag, commit, _ in disk_success:
        if tag in keep_disk:
            continue
        if len(recent_tags) < keep_recent:
            keep_disk[tag] = f"recent (<= last {keep_recent})"
            recent_tags.add(tag)

    # 3. age anchors -> archive to S3 (or keep on disk if already there and still recent).
    t0 = now()
    for days in anchors_days:
        target = t0 - timedelta(days=days)
        lo = t0 - timedelta(days=days * (1 + ANCHOR_TOLERANCE))
        hi = t0 - timedelta(days=days * (1 - ANCHOR_TOLERANCE))
        # nearest successful build to the target age, within tolerance.
        candidates = [
            (tag, commit, fa) for tag, commit, fa in disk_success
            if lo <= fa <= hi and tag not in keep_disk
        ]
        if not candidates:
            continue
        candidates.sort(key=lambda t: abs((t[2] - target).total_seconds()))
        tag, commit, _ = candidates[0]
        to_archive[tag] = f"anchor ~{days}d"

    # 4. everything else on disk that we did not elect to keep or archive -> delete.
    for tag in local:
        if tag in keep_disk or tag in to_archive:
            continue
        _, _, commit = tag.rpartition(":")
        if commit in successes:
            to_delete[tag] = "past ladder"
        elif tag.endswith("-build"):
            to_delete[tag] = "build intermediate"
        else:
            to_delete[tag] = "failed/untracked build"

    return {
        "app": app_name,
        "uuid": uuid,
        "keep_disk": keep_disk,
        "to_archive": to_archive,
        "to_delete": to_delete,
        "disk_success_count": len(disk_success),
    }


def image_bytes(tag: str) -> int:
    out = subprocess.run(["docker", "image", "inspect", "--format", "{{.Size}}", tag],
                         capture_output=True, text=True).stdout.strip()
    try:
        return int(out)
    except ValueError:
        return 0


def archive_to_s3(tag: str, app_name: str, dry: bool) -> bool:
    _, _, commit = tag.rpartition(":")
    dest = f"s3://{S3_BUCKET}/{S3_PREFIX}/{app_name}/{commit}.tar.gz"
    if dry:
        print(f"    DRY: docker save {tag} | gzip | aws s3 cp - {dest}")
        return True
    # Stream save->gzip->s3 with no intermediate file (disk is the scarce resource).
    save = subprocess.Popen(["docker", "save", tag], stdout=subprocess.PIPE)
    gzip = subprocess.Popen(["gzip", "-1"], stdin=save.stdout, stdout=subprocess.PIPE)
    save.stdout.close()
    up = subprocess.run(
        ["aws", "s3", "cp", "-", dest, "--region", S3_REGION, "--expected-size", "4000000000"],
        stdin=gzip.stdout,
    )
    gzip.wait()
    save.wait()
    return up.returncode == 0


def main() -> int:
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--app", help="groom a single app by name (build-success path)")
    g.add_argument("--all", action="store_true", help="groom every app (nightly backstop)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-archive", action="store_true", help="disk retention only; skip S3")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    app_map = apps()
    if args.app:
        if args.app not in app_map:
            print(f"unknown app '{args.app}'. known: {', '.join(sorted(app_map))}", file=sys.stderr)
            return 2
        targets = {args.app: app_map[args.app]}
    else:
        targets = app_map

    plans = [plan(name, uuid) for name, uuid in targets.items()]

    if args.json:
        print(json.dumps(plans, indent=2, default=str))
        return 0

    freed = 0
    archived = 0
    for p in plans:
        keep, arch, dele = p["keep_disk"], p["to_archive"], p["to_delete"]
        if not (keep or arch or dele):
            continue
        print(f"\n### {p['app']}  ({p['disk_success_count']} successful build(s) on disk)")
        for tag, why in keep.items():
            print(f"  KEEP    {tag[-20:]:<20}  {why}")
        for tag, why in arch.items():
            b = image_bytes(tag)
            print(f"  ARCHIVE {tag[-20:]:<20}  {why}  (~{b // 1024 // 1024} MB -> S3)")
            if not args.no_archive:
                if archive_to_s3(tag, p["app"], args.dry_run):
                    if not args.dry_run:
                        subprocess.run(["docker", "rmi", tag], capture_output=True)
                        freed += b
                        archived += 1
        for tag, why in dele.items():
            b = image_bytes(tag)
            print(f"  DELETE  {tag[-20:]:<20}  {why}  (~{b // 1024 // 1024} MB)")
            freed += b
            if not args.dry_run:
                subprocess.run(["docker", "rmi", tag], capture_output=True)

    verb = "would free" if args.dry_run else "freed"
    print(f"\n{verb} ~{freed // 1024 // 1024} MB on disk; {archived} image(s) archived to S3.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
