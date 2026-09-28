#!/usr/bin/env bash
#
# deploy-groomer-watch — the EVENT-DRIVEN trigger for deploy-groomer.py.
#
# Runs every minute. For each app, if a build has SUCCEEDED since we last groomed it,
# groom that app (and only that app). This realizes "after a successful build, run the
# grooming algorithm for that one" without a global clock: the groom is keyed to the
# build-finished event, per app.
#
# The nightly `deploy-groomer.py --all` remains as a backstop for apps that rarely build.

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR=/var/lib/matrx-groomer
GROOMER="${SCRIPT_DIR}/deploy-groomer.py"
LOCK=/var/run/matrx-groomer-watch.lock

mkdir -p "$STATE_DIR"

exec 9>"$LOCK"
flock -n 9 || { echo "$(date -u +%FT%TZ) groom-watch: already running"; exit 0; }

cdb() { docker exec -i coolify-db psql -U coolify -d coolify -tAF'|' -c "$1" 2>/dev/null; }

# name|latest_finished_at for every app that has ever had a successful build.
while IFS='|' read -r name finished; do
    [ -n "$name" ] || continue
    wm_file="${STATE_DIR}/$(echo "$name" | tr -c 'a-zA-Z0-9_-' '_').watermark"
    last="$(cat "$wm_file" 2>/dev/null || echo '')"

    if [ "$finished" != "$last" ]; then
        echo "$(date -u +%FT%TZ) groom-watch: ${name} built at ${finished} (was ${last:-never}) -> grooming"
        # Disk-only here keeps the per-build path fast; a 3 GB save+gzip+upload must never
        # run inside the every-minute cron. The nightly `--all` run owns S3 archival.
        if /usr/bin/python3 "$GROOMER" --app "$name" --no-archive 2>&1; then
            echo "$finished" > "$wm_file"
        else
            echo "$(date -u +%FT%TZ) groom-watch: groom FAILED for ${name}; leaving watermark to retry"
        fi
    fi
done < <(cdb "
    SELECT a.name, max(q.finished_at)
    FROM applications a
    JOIN application_deployment_queues q
      ON q.application_id = a.id::text
    WHERE q.status='finished' AND q.finished_at IS NOT NULL
    GROUP BY a.name
")
