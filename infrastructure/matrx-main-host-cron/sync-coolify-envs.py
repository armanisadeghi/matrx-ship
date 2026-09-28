#!/usr/bin/env python3
"""Mirror the live Coolify env of the two aidream API services into the local
.env files Arman reads, with an append-only changelog at the bottom of each.

    python3 /root/scripts/sync-coolify-envs.py            # sync both
    python3 /root/scripts/sync-coolify-envs.py --dry-run  # show diff, write nothing

Each file has two regions separated by the CHANGELOG marker:
  <KEY=VALUE lines, sorted>            <- overwritten every run from Coolify
  # ===== CHANGELOG (newest first) =====
  # 2026-07-08 14:03 UTC  +2 -0 ~1  added: FOO,BAR  changed: BAZ   <- appended
Only key NAMES appear in the changelog (never secret values). Old changelog
lines are preserved; delete any you no longer care about by hand.
"""
import json, re, sys, urllib.request
from datetime import datetime, timezone

TOKEN_FILE = "/root/.coolify-token"
MARKER = "# ===== CHANGELOG (newest first) ====="
# file -> Coolify application uuid
TARGETS = {
    "/root/projects/aidream/.env":     "j4sos40wkgk0cw8w00k8owcw",  # ai-dream-server (prod, main)
    "/root/projects/aidream/.env.dev": "w8k0wscowgwkc8kwswo48cgw",  # ai-dream-server-dev (dev)
}


def load_token():
    tok = url = None
    with open(TOKEN_FILE) as f:
        for line in f:
            m = re.match(r"\s*COOLIFY_TOKEN=['\"]?([^'\"\n]+)", line)
            if m:
                tok = m.group(1)
            m = re.match(r"\s*COOLIFY_API_URL=['\"]?([^'\"\n]+)", line)
            if m:
                url = m.group(1)
    if not tok or not url:
        sys.exit(f"could not parse COOLIFY_TOKEN / COOLIFY_API_URL from {TOKEN_FILE}")
    return tok, url.rstrip("/")


def fetch_envs(api_url, token, uuid):
    req = urllib.request.Request(
        f"{api_url}/applications/{uuid}/envs",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.load(r)
    # runtime (non-preview) values only; last write wins on duplicate keys
    out = {}
    for e in data:
        if e.get("is_preview"):
            continue
        out[e["key"]] = e.get("value") or ""
    return out


def parse_existing(path):
    """Return (dict of current KEY=VALUE, list of changelog comment lines)."""
    try:
        with open(path) as f:
            text = f.read()
    except FileNotFoundError:
        return {}, []
    env_part, _, log_part = text.partition(MARKER)
    kv = {}
    for line in env_part.splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, _, v = s.partition("=")
        kv[k.strip()] = v
    log_lines = [l for l in log_part.splitlines() if l.strip()]
    return kv, log_lines


def diff(old, new):
    added = sorted(k for k in new if k not in old)
    removed = sorted(k for k in old if k not in new)
    changed = sorted(k for k in new if k in old and old[k] != new[k])
    return added, removed, changed


def render(path, uuid, new_env, old_log, added, removed, changed, stamp):
    lines = [
        f"# Live Coolify env for application {uuid}",
        f"# Synced by sync-coolify-envs.py — do not hand-edit the env region; it is overwritten.",
        "",
    ]
    for k in sorted(new_env):
        lines.append(f"{k}={new_env[k]}")
    lines += ["", MARKER]
    if added or removed or changed:
        parts = [f"+{len(added)} -{len(removed)} ~{len(changed)}"]
        if added:
            parts.append("added: " + ",".join(added))
        if removed:
            parts.append("removed: " + ",".join(removed))
        if changed:
            parts.append("changed: " + ",".join(changed))
        lines.append(f"# {stamp}  " + "  ".join(parts))
    lines += old_log
    return "\n".join(lines) + "\n"


def main():
    dry = "--dry-run" in sys.argv
    token, api_url = load_token()
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    for path, uuid in TARGETS.items():
        new_env = fetch_envs(api_url, token, uuid)
        old_env, old_log = parse_existing(path)
        added, removed, changed = diff(old_env, new_env)
        summary = f"{path}: +{len(added)} -{len(removed)} ~{len(changed)}"
        if added:
            summary += f" | added {','.join(added)}"
        if removed:
            summary += f" | removed {','.join(removed)}"
        if changed:
            summary += f" | changed {','.join(changed)}"
        print(summary)
        if dry:
            continue
        with open(path, "w") as f:
            f.write(render(path, uuid, new_env, old_log, added, removed, changed, stamp))


if __name__ == "__main__":
    main()
