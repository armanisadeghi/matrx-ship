#!/usr/bin/env bash
# Wrapper for deploy-coalescer.php -- see that file for what/why.
# The script lives on the host and is copied into the Coolify container per run,
# so a Coolify upgrade (which recreates the container) cannot wipe it.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$(docker inspect -f '{{.State.Running}}' coolify 2>/dev/null)" != "true" ]; then
    echo "$(date -Is) coolify container not running, skipping" >&2
    exit 0
fi

docker cp "${SCRIPT_DIR}/deploy-coalescer.php" coolify:/tmp/deploy-coalescer.php >/dev/null
out="$(docker exec -e "DRY_RUN=${DRY_RUN:-0}" coolify php /tmp/deploy-coalescer.php 2>&1)"

# Stay quiet on the common no-op so the cron log only shows real actions.
if ! grep -q 'nothing to coalesce' <<<"$out"; then
    echo "$(date -Is)"
    echo "$out"
fi
