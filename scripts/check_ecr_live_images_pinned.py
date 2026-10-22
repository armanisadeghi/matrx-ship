#!/usr/bin/env python3
"""Fail when an image a live ECS task can run is missing, unpinned, or expirable by ECR lifecycle.

Incident 2026-10-21: the production Cloud Computer image matrx-cloud-computer:9adaa4b600 was expired by the
repository's keep-N rule because it never carried a `pinned-*` tag, so every Cloud Computer wake failed.

"Live" = every task definition that
  * an ECS service in any cluster references (primary and in-flight deployments),
  * a running or pending task in any cluster runs,
  * is the latest ACTIVE revision of a family that allocates tasks on demand (cloud computer, browser worker,
    including the per-user `...-cloud-computer-u-*` families).

For every ECR image those task definitions name (this account only) the guard requires:
  1. the image exists in ECR,
  2. it carries a tag starting `pinned-`,
  3. the repository's lifecycle policy, evaluated locally with ECR's rule semantics, would not expire it,
  4. with --preview, ECR's own lifecycle-policy preview does not list it either.

Usage:
  python3 scripts/check_ecr_live_images_pinned.py               # live check (matrx-admin identity)
  python3 scripts/check_ecr_live_images_pinned.py --preview     # + ECR lifecycle preview (slower)
  python3 scripts/check_ecr_live_images_pinned.py --extra-image matrx/aidream-server:<sha>   # planted live case
  python3 scripts/check_ecr_live_images_pinned.py --self-test   # planted fixtures must fail, clean must pass
Exit 0 = every live image safe, 1 = at least one finding, 2 = could not inspect.
"""
from __future__ import annotations

import argparse
import fnmatch
import json
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

REGION = "us-east-1"
ON_DEMAND_FAMILY_MARKERS = ("cloud-computer", "browser-worker")
PIN_PREFIX = "pinned-"
PER_PERSON_MARKER = "-cloud-computer-u-"
DORMANT: list[str] = []  # services at desired/running 0: not live, reported, not checked
STALE: list[str] = []  # per-person families re-registered from the base on their next wake


def aws(*args: str) -> dict:
    proc = subprocess.run(
        ["aws", *args, "--region", REGION, "--output", "json"], capture_output=True, text=True
    )
    if proc.returncode != 0:
        raise RuntimeError(f"aws {' '.join(args[:2])} failed: {proc.stderr.strip()}")
    return json.loads(proc.stdout or "{}")


@dataclass
class Image:
    digest: str
    tags: list[str]
    pushed_at: datetime


@dataclass
class LiveRef:
    repo: str
    ref: str  # tag or sha256 digest
    sources: set[str] = field(default_factory=set)


# ---------------------------------------------------------------- lifecycle evaluation (ECR semantics)

def _rule_matches(rule: dict, image: Image) -> bool:
    sel = rule["selection"]
    status = sel["tagStatus"]
    if status == "any":
        return True
    if status == "untagged":
        return not image.tags
    if not image.tags:
        return False
    prefixes = sel.get("tagPrefixList") or []
    patterns = sel.get("tagPatternList") or []
    if prefixes and not all(any(t.startswith(p) for t in image.tags) for p in prefixes):
        return False
    if patterns and not all(any(fnmatch.fnmatchcase(t, p) for t in image.tags) for p in patterns):
        return False
    return True


def expired_digests(policy: dict | None, images: list[Image], now: datetime) -> dict[str, str]:
    """Digest -> rule description for every image the policy would expire.

    ECR: rules apply in rulePriority order; an image that matches a rule's tag selection is claimed by it and
    never evaluated by a lower-priority rule. imageCountMoreThan keeps the N newest (by push time) of the
    images a rule claims; sinceImagePushed expires claimed images older than N days.
    """
    if not policy:
        return {}
    result: dict[str, str] = {}
    unclaimed = list(images)
    for rule in sorted(policy.get("rules", []), key=lambda r: r["rulePriority"]):
        claimed = [i for i in unclaimed if _rule_matches(rule, i)]
        unclaimed = [i for i in unclaimed if i not in claimed]
        sel = rule["selection"]
        label = f"rule {rule['rulePriority']} ({rule.get('description', '')})"
        if sel["countType"] == "imageCountMoreThan":
            for img in sorted(claimed, key=lambda i: i.pushed_at, reverse=True)[sel["countNumber"]:]:
                result[img.digest] = label
        elif sel["countType"] == "sinceImagePushed":
            unit = {"days": 1}.get(sel.get("countUnit", "days"), 1)
            cutoff = now - timedelta(days=sel["countNumber"] * unit)
            for img in claimed:
                if img.pushed_at < cutoff:
                    result[img.digest] = label
    return result


def evaluate(live: list[LiveRef], repos: dict[str, tuple[dict | None, list[Image]]], now: datetime,
             previews: dict[str, set[str]] | None = None) -> list[str]:
    findings: list[str] = []
    for ref in sorted(live, key=lambda r: (r.repo, r.ref)):
        where = f"{ref.repo}:{ref.ref[:24]} (used by {', '.join(sorted(ref.sources))})"
        if ref.repo not in repos:
            findings.append(f"MISSING REPOSITORY {where}")
            continue
        policy, images = repos[ref.repo]
        img = next((i for i in images if ref.ref == i.digest or ref.ref in i.tags), None)
        if img is None:
            findings.append(f"MISSING IMAGE {where}: no such tag/digest in ECR - tasks cannot start")
            continue
        if not any(t.startswith(PIN_PREFIX) for t in img.tags):
            findings.append(f"UNPINNED {where}: tags {img.tags} carry no {PIN_PREFIX}* tag")
        expiring = expired_digests(policy, images, now)
        if img.digest in expiring:
            findings.append(f"EXPIRABLE {where}: lifecycle {expiring[img.digest]} selects it")
        pin_rule = next((r for r in (policy or {}).get("rules", [])
                         if PIN_PREFIX in (r["selection"].get("tagPrefixList") or [])), None)
        pinned = sum(1 for i in images if any(t.startswith(PIN_PREFIX) for t in i.tags))
        if pin_rule and pin_rule["selection"]["countType"] == "imageCountMoreThan" \
                and pinned >= pin_rule["selection"]["countNumber"] * 0.9:
            findings.append(f"PIN HEADROOM {ref.repo}: {pinned} pinned images vs keep-{pin_rule['selection']['countNumber']}"
                            " - the oldest pins (base images builds COPY from) are about to expire")
        if previews is not None and img.digest in previews.get(ref.repo, set()):
            findings.append(f"EXPIRABLE (ECR preview) {where}")
    return findings


# ---------------------------------------------------------------- live inventory

def _chunks(items: list[str], n: int):
    for i in range(0, len(items), n):
        yield items[i:i + n]


def live_task_definitions() -> dict[str, set[str]]:
    defs: dict[str, set[str]] = {}
    for cluster in aws("ecs", "list-clusters")["clusterArns"]:
        cname = cluster.rsplit("/", 1)[-1]
        services = aws("ecs", "list-services", "--cluster", cluster).get("serviceArns", [])
        for batch in _chunks(services, 10):
            for svc in aws("ecs", "describe-services", "--cluster", cluster, "--services", *batch)["services"]:
                if not (svc.get("desiredCount") or svc.get("runningCount") or svc.get("pendingCount")):
                    DORMANT.append(f"{cname}/{svc['serviceName']} ({svc['taskDefinition'].rsplit('/', 1)[-1]})")
                    continue
                for dep in svc.get("deployments", []) or [{"taskDefinition": svc["taskDefinition"]}]:
                    defs.setdefault(dep["taskDefinition"], set()).add(f"service {cname}/{svc['serviceName']}")
        for status in ("RUNNING", "PENDING"):
            tasks = aws("ecs", "list-tasks", "--cluster", cluster, "--desired-status", status).get("taskArns", [])
            for batch in _chunks(tasks, 100):
                for task in aws("ecs", "describe-tasks", "--cluster", cluster, "--tasks", *batch)["tasks"]:
                    defs.setdefault(task["taskDefinitionArn"], set()).add(f"running task in {cname}")
    families = aws("ecs", "list-task-definition-families", "--status", "ACTIVE")["families"]
    latest = {}
    for fam in families:
        if any(m in fam for m in ON_DEMAND_FAMILY_MARKERS):
            latest[fam] = aws("ecs", "describe-task-definition", "--task-definition", fam, "--include", "TAGS")
    bases = {d["taskDefinition"]["taskDefinitionArn"] for f, d in latest.items() if PER_PERSON_MARKER not in f}
    for fam, desc in latest.items():
        arn = desc["taskDefinition"]["taskDefinitionArn"]
        tags = {t["key"]: t["value"] for t in desc.get("tags", [])}
        # A person's own family is reused on wake only while it was built from the CURRENT base revision
        # (aidream cloud_computer._task_definition_for); a stale one is re-registered from the base first.
        if PER_PERSON_MARKER in fam and tags.get("cloud-computer-base") not in bases:
            STALE.append(f"{fam.rsplit('-u-', 1)[-1][:8]}… ({arn.rsplit('/', 1)[-1].split(':')[-1]})")
            continue
        defs.setdefault(arn, set()).add(f"latest revision of {fam}")
    return defs


def live_refs(account: str) -> list[LiveRef]:
    registry = f"{account}.dkr.ecr.{REGION}.amazonaws.com/"
    refs: dict[tuple[str, str], LiveRef] = {}
    for arn, sources in live_task_definitions().items():
        td = aws("ecs", "describe-task-definition", "--task-definition", arn)["taskDefinition"]
        label = arn.rsplit("/", 1)[-1]
        for c in td["containerDefinitions"]:
            image = c["image"]
            if not image.startswith(registry):
                continue
            path = image[len(registry):]
            repo, ref = path.split("@", 1) if "@" in path else path.rsplit(":", 1) if ":" in path else (path, "latest")
            r = refs.setdefault((repo, ref), LiveRef(repo, ref))
            r.sources.update(f"{label} <- {s}" for s in sources)
    return list(refs.values())


def repo_state(repo: str) -> tuple[dict | None, list[Image]]:
    try:
        policy = json.loads(aws("ecr", "get-lifecycle-policy", "--repository-name", repo)["lifecyclePolicyText"])
    except RuntimeError as exc:
        if "LifecyclePolicyNotFoundException" not in str(exc):
            raise
        policy = None
    images = [
        Image(d["imageDigest"], d.get("imageTags", []), datetime.fromisoformat(str(d["imagePushedAt"])))
        for d in aws("ecr", "describe-images", "--repository-name", repo)["imageDetails"]
    ]
    return policy, images


def preview_expirations(repo: str) -> set[str]:
    try:
        aws("ecr", "start-lifecycle-policy-preview", "--repository-name", repo)
    except RuntimeError as exc:
        if "LifecyclePolicyNotFoundException" in str(exc):
            return set()
        if "LifecyclePolicyPreviewInProgressException" not in str(exc):
            raise
    for _ in range(90):
        out = aws("ecr", "get-lifecycle-policy-preview", "--repository-name", repo)
        if out.get("status") == "COMPLETE":
            return {r["imageDigest"] for r in out.get("previewResults", [])}
        if out.get("status") in ("FAILED", "EXPIRED"):
            raise RuntimeError(f"lifecycle preview for {repo} ended {out.get('status')}")
        time.sleep(5)
    raise RuntimeError(f"lifecycle preview for {repo} did not complete")


# ---------------------------------------------------------------- self-test (planted cases)

def self_test() -> int:
    now = datetime(2026, 10, 21, tzinfo=timezone.utc)
    policy = {"rules": [
        {"rulePriority": 1, "selection": {"tagStatus": "tagged", "tagPrefixList": ["pinned-"], "countType": "imageCountMoreThan", "countNumber": 100}, "action": {"type": "expire"}},
        {"rulePriority": 4, "selection": {"tagStatus": "untagged", "countType": "sinceImagePushed", "countUnit": "days", "countNumber": 1}, "action": {"type": "expire"}},
        {"rulePriority": 5, "selection": {"tagStatus": "tagged", "tagPatternList": ["*"], "countType": "imageCountMoreThan", "countNumber": 2}, "action": {"type": "expire"}},
    ]}

    def img(n: int, *tags: str) -> Image:
        return Image(f"sha256:{n:064x}", list(tags), now - timedelta(days=n))

    # Newest first: 3 tagged releases newer than the live one, so keep-2 selects the live one.
    images = [img(1, "a1"), img(2, "a2"), img(3, "a3"), img(10, "live", "pinned-x-live"), img(11, "old-live")]
    repos = {"r": (policy, images)}
    cases = {
        "clean pinned live image": ([LiveRef("r", "live", {"t"})], []),
        "planted unpinned + expirable (the 2026-10-21 incident)": ([LiveRef("r", "old-live", {"t"})], ["UNPINNED", "EXPIRABLE"]),
        "planted missing image": ([LiveRef("r", "gone", {"t"})], ["MISSING IMAGE"]),
        "planted unpinned but still inside keep-N": ([LiveRef("r", "a1", {"t"})], ["UNPINNED"]),
    }
    # A policy where keep-N outranks the pin rule must fail even for a pinned image.
    bad_policy = {"rules": [dict(policy["rules"][2], rulePriority=1), dict(policy["rules"][0], rulePriority=2)]}
    cases_bad = {"planted keep-N ranked above pin rule": ([LiveRef("b", "live", {"t"})], ["EXPIRABLE"])}
    # 95 pins against keep-100: the next few releases would expire the oldest pins (the base image builds COPY).
    full = [img(20 + n, f"pinned-x-{n}") for n in range(95)]
    cases_bad["planted pin headroom exhausted"] = ([LiveRef("f", "pinned-x-0", {"t"})], ["PIN HEADROOM"])
    ok = True
    for name, (live, want) in list(cases.items()) + list(cases_bad.items()):
        found = evaluate(live, {**repos, "b": (bad_policy, images), "f": (policy, full)}, now)
        kinds = [f.split(" r:")[0].split(" b:")[0].split(" f:")[0] for f in found]
        passed = sorted(kinds) == sorted(want)
        ok &= passed
        print(f"{'PASS' if passed else 'FAIL'}  {name}: {found or 'no findings'}")
    print("self-test", "passed" if ok else "FAILED")
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--preview", action="store_true", help="also run ECR's lifecycle-policy preview per repository")
    ap.add_argument("--extra-image", action="append", default=[], help="repo:tag to check as if live (planted case)")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()
    if args.self_test:
        return self_test()
    try:
        account = aws("sts", "get-caller-identity")["Account"]
        live = live_refs(account)
        for extra in args.extra_image:
            repo, ref = extra.rsplit(":", 1)
            live.append(LiveRef(repo, ref, {"--extra-image"}))
        repos: dict[str, tuple[dict | None, list[Image]]] = {}
        for repo in sorted({r.repo for r in live}):
            try:
                repos[repo] = repo_state(repo)
            except RuntimeError as exc:
                if "RepositoryNotFoundException" not in str(exc):
                    raise
        previews = {repo: preview_expirations(repo) for repo in repos} if args.preview else None
    except RuntimeError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    now = datetime.now(timezone.utc)
    for r in sorted(live, key=lambda r: (r.repo, r.ref)):
        print(f"live  {r.repo}:{r.ref[:40]}  <- {len(r.sources)} use(s)")
    for d in DORMANT:
        print(f"skip  dormant service {d}")
    for st in STALE:
        print(f"skip  stale per-person Cloud Computer family {st}: re-registered from the base on next wake")
    findings = sorted(set(evaluate(live, repos, now, previews)))
    for f in findings:
        print(f"FAIL  {f}")
    print(f"{len(live)} live image(s) in {len(repos)} repositor(ies); {len(findings)} finding(s)"
          + ("; ECR preview checked" if args.preview else ""))
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
