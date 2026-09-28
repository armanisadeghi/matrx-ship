#!/usr/bin/env bash
#
# matrx-infra-watchdog — read-only. Runs every 5 minutes. Mutates nothing except in a
# genuine disk emergency, where it hands off to the janitor.
#
# This is the component that would have caught 2026-07-08. It watches the things that
# failed silently:
#
#   deploy_queue     -- depth, in-flight builds, and consecutive failures per app.
#                       (matrx-studio failed 12/12 today and nothing said a word.)
#   coolify_cleanup  -- Coolify's own DockerCleanupJob rows. A row stuck at status='running'
#                       IS the SIGKILL signature: the job's finally{} never ran. Coolify will
#                       never tell you; we do.
#   disk             -- pressure, with an emergency handoff to the janitor.
#
# Everything lands in Supabase (infra_status + app_log), where the app's alarm loop and the
# dashboard can see it. Staleness of OUR OWN row is judged app-side, so if this watchdog
# dies, that is itself an incident. Turtles all the way down, by design.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/infra-report.sh
. "${SCRIPT_DIR}/lib/infra-report.sh"

STALE_AFTER=1800          # cron every 5 min; alarm if we miss ~6 runs
CLEANUP_STALE_AFTER=93600 # Coolify cleanup is nightly; allow 26h before we call it stale
DISK_WARN=70
DISK_EMERGENCY=85
DISK_JANITOR_TRIGGER=80   # hand off to the janitor before we hit the wall

ts() { date -u +%FT%TZ; }
say() { echo "[$(ts)] $*"; }
disk_pct() { df --output=pcent / | tail -1 | tr -dc '0-9'; }
disk_free_h() { df -h --output=avail / | tail -1 | tr -d ' '; }
cdb() { docker exec -i coolify-db psql -U coolify -d coolify -tAc "$1" 2>/dev/null; }

# ---------------------------------------------------------------------------
# 1. DISK
# ---------------------------------------------------------------------------
DISK=$(disk_pct)
FREE=$(disk_free_h)

if   [ "$DISK" -ge "$DISK_EMERGENCY" ]; then DISK_STATE=critical
elif [ "$DISK" -ge "$DISK_WARN" ];      then DISK_STATE=warn
else                                         DISK_STATE=ok
fi

infra_report disk "$DISK_STATE" "$STALE_AFTER" \
    "Disk ${DISK}% used, ${FREE} free" \
    "{\"disk_pct\":${DISK},\"disk_free\":\"${FREE}\",\"warn_at\":${DISK_WARN},\"critical_at\":${DISK_EMERGENCY}}" >/dev/null || true

if [ "$DISK" -ge "$DISK_JANITOR_TRIGGER" ]; then
    say "disk at ${DISK}% -- triggering emergency janitor run"
    "${SCRIPT_DIR}/matrx-janitor.sh" --emergency >> /var/log/matrx-janitor.log 2>&1 &
fi

# ---------------------------------------------------------------------------
# 2. COOLIFY'S OWN CLEANUP JOB -- the silent killer.
#
# A row stuck at 'running' with no finished_at means the job was SIGKILLed at its 600s
# timeout, skipping both its finally{} and its catch{}. Four of these piled up Jul 8-11
# and produced no notification of any kind.
# ---------------------------------------------------------------------------
STUCK=$(cdb "SELECT count(*) FROM docker_cleanup_executions WHERE status='running' AND created_at < now() - interval '30 minutes'")
LAST_SUCCESS_AGE=$(cdb "SELECT COALESCE(EXTRACT(EPOCH FROM (now() - max(created_at)))::bigint, 999999) FROM docker_cleanup_executions WHERE status='success'")
LAST_STATUS=$(cdb "SELECT status FROM docker_cleanup_executions ORDER BY id DESC LIMIT 1")

STUCK=${STUCK:-0}
LAST_SUCCESS_AGE=${LAST_SUCCESS_AGE:-999999}

# Coolify's own DockerCleanupJob is intentionally neutered (force off + threshold 100,
# 2026-07-14) -- matrx-janitor is the cleanup authority now. So "no recent success" is
# EXPECTED, not a fault. We only alarm on NEW stuck 'running' rows, which would mean
# someone re-enabled the job and it is SIGKILL-timing-out again (the original silent bug).
if [ "$STUCK" -gt 0 ]; then
    CLEANUP_STATE=failed
    CLEANUP_MSG="Coolify DockerCleanupJob has ${STUCK} run(s) stuck at status='running' (SIGKILLed at 600s). It was disabled 2026-07-14 in favour of matrx-janitor -- if this is >0, it was re-enabled and is failing silently again."
else
    CLEANUP_STATE=ok
    CLEANUP_MSG="Coolify DockerCleanupJob disabled (matrx-janitor owns cleanup); no stuck rows."
fi

infra_report coolify_cleanup "$CLEANUP_STATE" "$CLEANUP_STALE_AFTER" "$CLEANUP_MSG" \
    "{\"stuck_running_rows\":${STUCK},\"last_success_age_hours\":$((LAST_SUCCESS_AGE / 3600)),\"last_run_status\":\"${LAST_STATUS:-unknown}\"}" >/dev/null || true

# ---------------------------------------------------------------------------
# 3. DEPLOY QUEUE
# ---------------------------------------------------------------------------
QUEUED=$(cdb "SELECT count(*) FROM application_deployment_queues WHERE status='queued'")
IN_PROGRESS=$(cdb "SELECT count(*) FROM application_deployment_queues WHERE status='in_progress'")
QUEUE_LIMIT=$(cdb "SELECT COALESCE(max(deployment_queue_limit), 25) FROM server_settings")
STALE_BUILD=$(cdb "SELECT count(*) FROM application_deployment_queues WHERE status='in_progress' AND created_at < now() - interval '45 minutes'")

# Coolify-owned production apps whose most recent finished build failed -- i.e. CI is broken
# for that app. AI Dream API/worker/dashboard/Studio are ECS-owned; the Coolify AI Dream app
# remains only for the temporary streaming plane.
BROKEN=$(cdb "
SELECT COALESCE(string_agg(application_name, ','), '')
FROM (
    SELECT DISTINCT ON (application_id) application_name, status
    FROM application_deployment_queues
    WHERE status IN ('finished','failed')
      AND application_name IN ('ai-dream-server','scraper-service')
    ORDER BY application_id, id DESC
) t
WHERE status = 'failed'")

QUEUED=${QUEUED:-0}; IN_PROGRESS=${IN_PROGRESS:-0}; STALE_BUILD=${STALE_BUILD:-0}
QUEUE_LIMIT=${QUEUE_LIMIT:-25}

if [ "$STALE_BUILD" -gt 0 ]; then
    Q_STATE=critical
    Q_MSG="${STALE_BUILD} build(s) wedged in_progress for >45min. Queue: ${QUEUED} waiting."
elif [ "$QUEUED" -ge "$QUEUE_LIMIT" ]; then
    Q_STATE=critical
    Q_MSG="Deploy queue is FULL (${QUEUED}/${QUEUE_LIMIT}). New pushes are being rejected with HTTP 429."
elif [ "$QUEUED" -gt 8 ]; then
    Q_STATE=warn
    Q_MSG="Deploy queue backing up: ${QUEUED} queued, ${IN_PROGRESS} building."
elif [ -n "$BROKEN" ]; then
    Q_STATE=warn
    Q_MSG="Last build FAILED for: ${BROKEN}. (${QUEUED} queued, ${IN_PROGRESS} building.)"
else
    Q_STATE=ok
    Q_MSG="Deploy queue healthy: ${QUEUED} queued, ${IN_PROGRESS} building."
fi

infra_report deploy_queue "$Q_STATE" "$STALE_AFTER" "$Q_MSG" \
    "{\"queued\":${QUEUED},\"in_progress\":${IN_PROGRESS},\"queue_limit\":${QUEUE_LIMIT},\"wedged_builds\":${STALE_BUILD},\"apps_with_failing_build\":\"${BROKEN}\"}" >/dev/null || true

say "watchdog: disk=${DISK}%/${DISK_STATE} cleanup=${CLEANUP_STATE} queue=${Q_STATE} (${QUEUED} queued, ${IN_PROGRESS} building) broken=[${BROKEN}]"
exit 0
