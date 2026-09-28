#!/usr/bin/env bash
#
# matrx-janitor — bounded, reporting replacement for Coolify's DockerCleanupJob.
#
# WHY THIS EXISTS
#   Coolify's DockerCleanupJob (app/Jobs/DockerCleanupJob.php) has $timeout=600 and
#   $tries=1. When it overruns it is SIGKILLed, which skips BOTH its finally{} (finished_at)
#   and its catch{} (DockerCleanupFailed notification) -- so it fails completely silently.
#   Successful runs here were already taking 3-8 min against that 600s ceiling, i.e. it was
#   a coin flip. It also runs `docker builder prune -af` (CleanupDocker.php:53), which nukes
#   100% of the build cache every night.
#
# THE TWO RULES
#   1. Old app IMAGES are the recurring trash (~110 GB across ~90 stale deploy tags). They
#      get collected first, every run, with a strict keep-N-plus-running policy.
#   2. Build CACHE is an ASSET, not trash. It is only ever CAPPED (LRU eviction down to a
#      reserved size), never `-af`-nuked. Deleting it during an outage just makes the next
#      build -- the one putting the fix live -- slower, which is precisely backwards.
#
# Every run reports to Supabase (public.infra_status + ops.app_log), so a failure or a
# silent death is visible in the app to every developer. See lib/infra-report.sh.
#
# Usage: matrx-janitor.sh [--dry-run] [--emergency]

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/infra-report.sh
. "${SCRIPT_DIR}/lib/infra-report.sh"

LOCK_FILE=/var/run/matrx-janitor.lock
COMPONENT=janitor
STALE_AFTER=5400          # cron is every 30 min; alarm if we miss ~3 runs

# Thresholds (disk % used)
DISK_WARN=70
DISK_EMERGENCY=85

# Retention
KEEP_NORMAL=2             # images to keep per app, on top of whatever is running
KEEP_EMERGENCY=1
CACHE_RESERVE_NORMAL=60GB # cap, not a nuke: LRU-evict build cache above this
CACHE_RESERVE_EMERGENCY=20GB

DRY_RUN=0
FORCE_EMERGENCY=0
for arg in "$@"; do
    case "$arg" in
        --dry-run)   DRY_RUN=1 ;;
        --emergency) FORCE_EMERGENCY=1 ;;
    esac
done

run() {
    if [ "$DRY_RUN" -eq 1 ]; then
        echo "  DRY-RUN: $*"
    else
        "$@" >/dev/null 2>&1
    fi
}

disk_pct() { df --output=pcent / | tail -1 | tr -dc '0-9'; }
disk_free_h() { df -h --output=avail / | tail -1 | tr -d ' '; }
# Total build cache bytes, per docker's own accounting.
cache_bytes() { docker system df --format '{{.Type}}\t{{.Size}}' 2>/dev/null | awk -F'\t' '/Build Cache/{print $2}'; }

ts() { date -u +%FT%TZ; }
say() { echo "[$(ts)] $*"; }

# ---------------------------------------------------------------------------
# Single-instance guard. Unlike Coolify's Redis lock we never wedge: flock is
# released when the process dies, however it dies.
# ---------------------------------------------------------------------------
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    say "another janitor run is in progress; exiting"
    exit 0
fi

START_EPOCH=$(date +%s)
DISK_BEFORE=$(disk_pct)
CACHE_BEFORE=$(cache_bytes)

# ---------------------------------------------------------------------------
# Failure reporting. Any unexpected exit still reports -- that is the whole point.
# ---------------------------------------------------------------------------
REMOVED_COUNT=0
FAILED=0
on_exit() {
    local rc=$?
    local elapsed=$(( $(date +%s) - START_EPOCH ))
    local disk_after; disk_after=$(disk_pct)

    if [ "$rc" -ne 0 ] || [ "$FAILED" -ne 0 ]; then
        infra_report "$COMPONENT" failed "$STALE_AFTER" \
            "Janitor run FAILED (rc=${rc}) after ${elapsed}s; disk ${disk_after}%" \
            "{\"rc\":${rc},\"elapsed_seconds\":${elapsed},\"disk_pct_before\":${DISK_BEFORE},\"disk_pct_after\":${disk_after},\"images_removed\":${REMOVED_COUNT},\"dry_run\":${DRY_RUN}}" \
            || echo "janitor: FAILED to report failure" >&2

        if [ -f "${SCRIPT_DIR}/lib/notify-failure.sh" ]; then
            # shellcheck disable=SC1091
            . "${SCRIPT_DIR}/lib/notify-failure.sh"
            notify_failure "matrx-janitor" \
                "<p>The Docker janitor failed (rc=${rc}) on $(hostname) at $(ts). Disk is at ${disk_after}%.</p><p>Log: <code>/var/log/matrx-janitor.log</code></p>" 2>/dev/null || true
        fi
    fi
}
trap on_exit EXIT

# ---------------------------------------------------------------------------
# Decide the aggression level from actual disk pressure.
# ---------------------------------------------------------------------------
if [ "$FORCE_EMERGENCY" -eq 1 ] || [ "$DISK_BEFORE" -ge "$DISK_EMERGENCY" ]; then
    MODE=emergency
    KEEP=$KEEP_EMERGENCY
    CACHE_RESERVE=$CACHE_RESERVE_EMERGENCY
else
    MODE=normal
    KEEP=$KEEP_NORMAL
    CACHE_RESERVE=$CACHE_RESERVE_NORMAL
fi

say "janitor start: mode=${MODE} disk=${DISK_BEFORE}% cache=${CACHE_BEFORE} keep=${KEEP} reserve=${CACHE_RESERVE} dry_run=${DRY_RUN}"

# Never touch an image backing a running container, whatever the retention math says.
mapfile -t RUNNING_IMAGES < <(docker ps --format '{{.Image}}' 2>/dev/null | sort -u)
is_running_image() {
    local candidate="$1"
    for img in "${RUNNING_IMAGES[@]}"; do
        [ "$img" = "$candidate" ] && return 0
    done
    return 1
}

# App UUIDs are the image repository names Coolify builds into.
mapfile -t APP_UUIDS < <(docker exec -i coolify-db psql -U coolify -d coolify -tAc \
    "SELECT uuid FROM applications" 2>/dev/null)

if [ "${#APP_UUIDS[@]}" -eq 0 ]; then
    say "ERROR: could not read application uuids from coolify-db"
    FAILED=1
    exit 1
fi

# ---------------------------------------------------------------------------
# PHASE 1 -- app image retention. This is the ~110 GB.
# ---------------------------------------------------------------------------
say "phase 1: app image retention (keep ${KEEP} + running, per app)"
for uuid in "${APP_UUIDS[@]}"; do
    [ -n "$uuid" ] || continue

    # Newest first. Coolify tags as <uuid>:<commit> and <uuid>:<commit>-build.
    mapfile -t tags < <(docker images --filter "reference=${uuid}" \
        --format '{{.CreatedAt}}\t{{.Repository}}:{{.Tag}}' 2>/dev/null \
        | sort -r | cut -f2)

    [ "${#tags[@]}" -eq 0 ] && continue

    kept=0
    for tag in "${tags[@]}"; do
        if is_running_image "$tag"; then
            say "  keep (running):  $tag"
            continue
        fi
        if [ "$kept" -lt "$KEEP" ]; then
            kept=$((kept + 1))
            say "  keep (retain ${kept}/${KEEP}): $tag"
            continue
        fi
        say "  remove:          $tag"
        run docker rmi "$tag"
        REMOVED_COUNT=$((REMOVED_COUNT + 1))
    done
done
say "phase 1: removed ${REMOVED_COUNT} stale image tag(s)"

# ---------------------------------------------------------------------------
# PHASE 2 -- dangling images only. `-a` would take images we deliberately retain.
# ---------------------------------------------------------------------------
say "phase 2: dangling image prune"
run docker image prune -f

# ---------------------------------------------------------------------------
# PHASE 3 -- build cache: CAP, never nuke.
#
# Deferred while a build is in flight unless we are genuinely in trouble: evicting
# cache under a running build only slows down the deploy we are waiting on.
# ---------------------------------------------------------------------------
BUILDS_IN_FLIGHT=$(docker exec -i coolify-db psql -U coolify -d coolify -tAc \
    "SELECT count(*) FROM application_deployment_queues WHERE status='in_progress'" 2>/dev/null || echo 0)

if [ "${BUILDS_IN_FLIGHT:-0}" -gt 0 ] && [ "$MODE" = "normal" ]; then
    say "phase 3: SKIPPED -- ${BUILDS_IN_FLIGHT} build(s) in flight and disk is healthy (${DISK_BEFORE}%); not evicting cache under a running build"
else
    say "phase 3: capping build cache at ${CACHE_RESERVE} (LRU eviction; NOT a full prune)"
    run docker builder prune -f --reserved-space "$CACHE_RESERVE"
fi

# ---------------------------------------------------------------------------
# Report.
# ---------------------------------------------------------------------------
DISK_AFTER=$(disk_pct)
CACHE_AFTER=$(cache_bytes)
ELAPSED=$(( $(date +%s) - START_EPOCH ))

if [ "$DISK_AFTER" -ge "$DISK_EMERGENCY" ]; then
    STATE=critical
elif [ "$DISK_AFTER" -ge "$DISK_WARN" ]; then
    STATE=warn
else
    STATE=ok
fi

MSG="Cleaned ${REMOVED_COUNT} stale image(s) in ${ELAPSED}s. Disk ${DISK_BEFORE}% -> ${DISK_AFTER}% ($(disk_free_h) free). Build cache ${CACHE_BEFORE} -> ${CACHE_AFTER} (capped, not purged)."
DETAIL=$(cat <<EOF
{"mode":"${MODE}","elapsed_seconds":${ELAPSED},"disk_pct_before":${DISK_BEFORE},"disk_pct_after":${DISK_AFTER},"disk_free":"$(disk_free_h)","images_removed":${REMOVED_COUNT},"cache_before":"${CACHE_BEFORE}","cache_after":"${CACHE_AFTER}","cache_reserve":"${CACHE_RESERVE}","keep_per_app":${KEEP},"builds_in_flight":${BUILDS_IN_FLIGHT:-0},"dry_run":${DRY_RUN}}
EOF
)

say "$MSG"

if [ "$DRY_RUN" -eq 0 ]; then
    infra_report "$COMPONENT" "$STATE" "$STALE_AFTER" "$MSG" "$DETAIL" || { say "WARN: could not report to Supabase"; }
    infra_report disk "$STATE" "$STALE_AFTER" \
        "Disk ${DISK_AFTER}% used, $(disk_free_h) free" \
        "{\"disk_pct\":${DISK_AFTER},\"disk_free\":\"$(disk_free_h)\",\"warn_at\":${DISK_WARN},\"critical_at\":${DISK_EMERGENCY}}" || true
else
    say "DRY-RUN: would report state=${STATE}"
fi

say "janitor done"
exit 0
