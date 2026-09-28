#!/bin/bash
set -euo pipefail

BACKUP_DIR="/data/coolify/backups/coolify-db"
S3_BUCKET="matrx-backups"
S3_PREFIX="backups/coolify-db"
RETENTION_LOCAL=3
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="coolify-db_${TIMESTAMP}.sql.gz"
S3_UPLOAD_OK=1

# Failure notifier (Phase 4.2). Sourced lazily so this script still
# functions if the lib is missing or unreadable.
notify_if_failed() {
    local subject="$1"
    local body="$2"
    if [ -r /root/scripts/lib/notify-failure.sh ]; then
        # shellcheck disable=SC1091
        source /root/scripts/lib/notify-failure.sh
        notify_failure "${subject}" "${body}"
    fi
}

trap 'rc=$?; if [ "$rc" -ne 0 ]; then notify_if_failed "coolify-db backup FAILED (exit $rc)" "<p>backup-coolify-db.sh exited with <code>$rc</code> at $(date -u +%FT%TZ).</p><p>See <code>/var/log/coolify-backup.log</code> on matrxserver.com.</p>"; fi' EXIT

mkdir -p "$BACKUP_DIR"

docker exec coolify-db pg_dumpall -U coolify | gzip > "${BACKUP_DIR}/${FILENAME}"

if command -v aws &>/dev/null; then
    if aws s3 cp "${BACKUP_DIR}/${FILENAME}" \
        "s3://${S3_BUCKET}/${S3_PREFIX}/${FILENAME}" \
        --storage-class STANDARD_IA \
        --region us-east-2 2>/dev/null; then
        echo "[$(date)] Uploaded ${FILENAME} to S3"
    else
        echo "[$(date)] S3 upload failed for ${FILENAME}"
        S3_UPLOAD_OK=0
        notify_if_failed \
            "coolify-db S3 upload FAILED" \
            "<p>Local dump <code>${FILENAME}</code> succeeded but S3 upload to <code>s3://${S3_BUCKET}/${S3_PREFIX}/</code> failed at $(date -u +%FT%TZ). The dump is still on disk under <code>${BACKUP_DIR}</code>.</p>"
    fi
fi

cd "$BACKUP_DIR"
ls -t coolify-db_*.sql.gz 2>/dev/null | tail -n +$((RETENTION_LOCAL + 1)) | xargs -r rm -f

echo "[$(date)] Backup completed: ${FILENAME} ($(du -h "${BACKUP_DIR}/${FILENAME}" | cut -f1)) s3_upload=$([ $S3_UPLOAD_OK -eq 1 ] && echo ok || echo failed)"
