#!/bin/bash
# Source-able helper. Provides notify_failure() which posts a one-shot
# email via Resend when a system cron / script fails. Intended for things
# that live OUTSIDE Coolify's managed scheduled-task surface (the
# backup-verify cron, backup-coolify-db.sh, etc.) so they show up in
# admin@aimatrx.com alongside Coolify's own failure emails.
#
# Usage:
#   source /root/scripts/lib/notify-failure.sh
#   notify_failure "subject line" "body (html allowed)"
#
# Or wrap a whole command:
#   run_or_alert "tag" some-command --with --args
#
# Env vars (already set on this server):
#   RESEND_API_KEY  - Resend API key
#   ALERT_FROM      - From: address
#   ALERT_TO        - To: address
#
# Defaults below match the Phase 4.2 wiring; override per-script if you
# want to route different jobs to different inboxes later.

: "${RESEND_API_KEY:?RESEND_API_KEY must be set in the environment (no default — do not hardcode a live key here)}"
: "${ALERT_FROM:=AI Matrx Coolify <noreply@aimatrx.com>}"
# Comma-separated list of recipients. Override per-script by exporting
# ALERT_TO before sourcing.
: "${ALERT_TO:=admin@aimatrx.com,arman@armansadeghi.com}"

notify_failure() {
    local subject="$1"
    local body="$2"
    local hostname
    hostname=$(hostname)

    local payload
    payload=$(python3 -c '
import json, sys
recipients = [r.strip() for r in sys.argv[2].split(",") if r.strip()]
data = {
    "from": sys.argv[1],
    "to": recipients,
    "subject": sys.argv[3],
    "html": sys.argv[4],
}
print(json.dumps(data))
' "${ALERT_FROM}" "${ALERT_TO}" "[matrxserver/${hostname}] ${subject}" "${body}")

    curl -fsS -X POST https://api.resend.com/emails \
        -H "Authorization: Bearer ${RESEND_API_KEY}" \
        -H "Content-Type: application/json" \
        --max-time 10 \
        -d "${payload}" >/dev/null 2>&1 \
        && echo "[notify-failure] alert sent: ${subject}" \
        || echo "[notify-failure] FAILED to send alert: ${subject}" >&2
}

run_or_alert() {
    local tag="$1"; shift
    local logfile
    logfile=$(mktemp -t "alert-${tag}-XXXXXX.log")
    if "$@" >"${logfile}" 2>&1; then
        cat "${logfile}"
        rm -f "${logfile}"
        return 0
    fi
    local rc=$?
    cat "${logfile}"
    local tail_html
    tail_html=$(tail -n 50 "${logfile}" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g')
    notify_failure \
        "${tag} FAILED (exit ${rc})" \
        "<p><b>${tag}</b> exited with code <code>${rc}</code> on $(date -u +%FT%TZ).</p><p>Last 50 log lines:</p><pre>${tail_html}</pre>"
    rm -f "${logfile}"
    return "${rc}"
}
