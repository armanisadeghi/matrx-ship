#!/bin/bash
# One-shot: register the weekly backup-restore-verify cron and ensure the
# log file exists with sane permissions. Idempotent - safe to re-run.

set -euo pipefail

SCRIPT=/root/scripts/backup-verify.sh
LOG=/var/log/backup-verify.log
CRON_LINE="15 4 * * 0 ${SCRIPT} >> ${LOG} 2>&1"
CRON_TAG="# matrx-backup-verify"

[ -x "${SCRIPT}" ] || { echo "missing or non-executable: ${SCRIPT}" >&2; exit 1; }

touch "${LOG}"
chmod 640 "${LOG}"

current=$(crontab -l 2>/dev/null || true)

if echo "${current}" | grep -qF "${CRON_TAG}"; then
    echo "cron already installed; refreshing"
    new=$(echo "${current}" | grep -vF "${CRON_TAG}" | grep -vF "${SCRIPT}" || true)
else
    echo "installing cron"
    new="${current}"
fi

{
    echo "${new}"
    echo "${CRON_TAG}"
    echo "${CRON_LINE}"
} | grep -v '^$' | crontab -

echo "active cron entries:"
crontab -l | grep -E "(backup-verify|matrx-backup-verify)" || true

echo
echo "Verify cron will run every Sunday at 04:15 UTC."
echo "Log: ${LOG}"
echo "Manual run: ${SCRIPT}"
