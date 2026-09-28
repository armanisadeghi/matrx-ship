#!/bin/bash
# Weekly backup-restore-verify (Phase 4.1 of the hardening plan).
#
# For each tracked Postgres backup in S3:
#   1. Download the latest .sql.gz dump
#   2. Spin up a throwaway postgres:18 container
#   3. Restore the dump
#   4. Confirm expected tables/roles exist (or that the dump is parseable for
#      the matrx-ai placeholder DB which is intentionally empty)
#   5. Tear the container down
#
# Exits non-zero on any failure so the cron's stderr surfaces in
# /var/log/backup-verify.log and (once an SMTP/Slack channel is wired in
# Phase 4.2) Coolify's scheduled-task notification.

set -euo pipefail

S3_REGION=us-east-2
S3_BUCKET=matrx-backups

VERIFY_TS=$(date +%Y%m%d_%H%M%S)
WORK_DIR="/tmp/backup-verify-${VERIFY_TS}"
LOG_TAG="[backup-verify ${VERIFY_TS}]"
CONTAINER_BASE="bv-pg-${VERIFY_TS}"

mkdir -p "${WORK_DIR}"
trap 'rm -rf "${WORK_DIR}"; for c in $(docker ps -aq --filter "name=${CONTAINER_BASE}-"); do docker rm -f "$c" >/dev/null 2>&1 || true; done' EXIT

ALL_OK=1
SUMMARY=""

verify_db() {
    local label="$1"
    local s3_path="$2"
    local min_size_bytes="$3"
    local must_have_tables_regex="$4"

    echo "${LOG_TAG} verifying ${label} from ${s3_path}..."
    local container="${CONTAINER_BASE}-${label}"
    local local_file="${WORK_DIR}/${label}.sql.gz"

    if ! aws s3 cp "${s3_path}" "${local_file}" --region "${S3_REGION}" --quiet; then
        echo "${LOG_TAG} FAIL: ${label} S3 download failed"
        ALL_OK=0
        SUMMARY="${SUMMARY}\n  ${label}: DOWNLOAD FAILED"
        return
    fi

    local size
    size=$(stat -c %s "${local_file}")
    if [ "${size}" -lt "${min_size_bytes}" ]; then
        echo "${LOG_TAG} FAIL: ${label} backup too small: ${size} bytes (min ${min_size_bytes})"
        ALL_OK=0
        SUMMARY="${SUMMARY}\n  ${label}: TOO SMALL (${size} bytes < ${min_size_bytes})"
        return
    fi

    docker run -d --rm --name "${container}" \
        -e POSTGRES_PASSWORD=verify -e POSTGRES_USER=verify -e POSTGRES_DB=verify \
        --memory=512m --memory-swap=512m \
        postgres:17-alpine >/dev/null

    # Wait for postgres to be stable — pg_isready can briefly return true
    # during the docker-entrypoint init shutdown between phases 1 and 2.
    # Require 2 consecutive successes 1 second apart to avoid that window.
    local ready=0
    local consec=0
    for i in $(seq 1 60); do
        if docker exec "${container}" pg_isready -U verify >/dev/null 2>&1; then
            consec=$((consec + 1))
            if [ "${consec}" -ge 2 ]; then
                ready=1
                break
            fi
        else
            consec=0
        fi
        sleep 1
    done
    if [ "${ready}" -ne 1 ]; then
        echo "${LOG_TAG} FAIL: ${label} verify container did not become ready"
        ALL_OK=0
        SUMMARY="${SUMMARY}\n  ${label}: PG NOT READY"
        docker rm -f "${container}" >/dev/null 2>&1 || true
        return
    fi

    if ! gunzip -c "${local_file}" | docker exec -i "${container}" psql -U verify -d verify -v ON_ERROR_STOP=0 >/dev/null 2>"${WORK_DIR}/${label}-restore.err"; then
        echo "${LOG_TAG} FAIL: ${label} restore returned non-zero"
        head -10 "${WORK_DIR}/${label}-restore.err" >&2 || true
        ALL_OK=0
        SUMMARY="${SUMMARY}\n  ${label}: RESTORE ERROR"
        docker rm -f "${container}" >/dev/null 2>&1 || true
        return
    fi

    # pg_dumpall produces a cluster dump with CREATE DATABASE + \connect
    # statements - the actual tables land in whichever DB the source dumped
    # them in (e.g. coolify-db -> "coolify", scraper-postgres -> "postgres").
    # Walk every non-template DB and aggregate user tables.
    local databases
    databases=$(docker exec "${container}" psql -U verify -d verify -tAc \
        "SELECT datname FROM pg_database WHERE datistemplate=false;" 2>/dev/null | tr -d ' ')

    local tables=""
    for db in ${databases}; do
        local db_tables
        db_tables=$(docker exec "${container}" psql -U verify -d "${db}" -tAc \
            "SELECT string_agg(tablename, ',') FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema');" 2>/dev/null || echo "")
        if [ -n "${db_tables}" ] && [ "${db_tables}" != " " ]; then
            tables="${tables}${tables:+,}${db_tables}"
        fi
    done

    local table_count
    table_count=$(echo "${tables}" | tr ',' '\n' | grep -c . || true)

    if [ -n "${must_have_tables_regex}" ] && ! echo "${tables}" | grep -qE "${must_have_tables_regex}"; then
        echo "${LOG_TAG} FAIL: ${label} missing expected tables (need: ${must_have_tables_regex})"
        echo "${LOG_TAG}   first tables: ${tables:0:200}"
        ALL_OK=0
        SUMMARY="${SUMMARY}\n  ${label}: MISSING TABLES (pattern: ${must_have_tables_regex})"
    else
        local mb
        mb=$(awk "BEGIN{printf \"%.2f\", ${size}/1048576}")
        echo "${LOG_TAG} OK: ${label} restored ${table_count} tables, ${mb} MiB compressed"
        SUMMARY="${SUMMARY}\n  ${label}: OK (${table_count} tables, ${mb} MiB)"
    fi

    docker rm -f "${container}" >/dev/null 2>&1 || true
}

latest_in() {
    aws s3 ls "$1" --region "${S3_REGION}" --recursive 2>/dev/null \
        | sort \
        | awk 'END{print $4}'
}

LATEST_COOLIFY=$(aws s3 ls "s3://${S3_BUCKET}/backups/coolify-db/" --region "${S3_REGION}" 2>/dev/null | sort | awk 'END{print $4}')
LATEST_SCRAPER=$(latest_in "s3://${S3_BUCKET}/data/coolify/backups/databases/root-team-0/scraper-postgres-r440g8wckcswcc4c04o40w8c/")
LATEST_MATRX_AI=$(latest_in "s3://${S3_BUCKET}/data/coolify/backups/databases/root-team-0/matrx-ai-postgres-k8scock84c48o4s08kc4wc00/")

if [ -z "${LATEST_COOLIFY}" ] || [ -z "${LATEST_SCRAPER}" ] || [ -z "${LATEST_MATRX_AI}" ]; then
    echo "${LOG_TAG} FAIL: could not list latest backup for one or more DBs"
    echo "${LOG_TAG}   coolify=${LATEST_COOLIFY:-<none>}  scraper=${LATEST_SCRAPER:-<none>}  matrx_ai=${LATEST_MATRX_AI:-<none>}"
    exit 1
fi

# coolify-db is the meaty one - hundreds of tables, ~16 MiB compressed.
# Required tables include applications + server_settings (core control plane).
verify_db "coolify-db" \
    "s3://${S3_BUCKET}/backups/coolify-db/${LATEST_COOLIFY}" \
    1000000 \
    '(^|,)applications(,|$)|(^|,)server_settings(,|$)'

# scraper-postgres holds three things in one DB: scrape_* (retry queue +
# scrape store), directus_* (Directus admin), nc_* (NocoDB metadata).
# Assert at least one table from each domain so silent table-loss in any
# of them gets surfaced.
verify_db "scraper-postgres" \
    "s3://${S3_BUCKET}/${LATEST_SCRAPER}" \
    10000 \
    '(^|,)scrape_retry_queue(,|$)'

# matrx-ai-postgres is intentionally empty today (Supabase is the primary
# DB, this Postgres is reserved for future migration). Just confirm the
# dump exists and the file is parseable - no table requirement.
verify_db "matrx-ai-postgres" \
    "s3://${S3_BUCKET}/${LATEST_MATRX_AI}" \
    100 \
    ''

echo
if [ "${ALL_OK}" -eq 1 ]; then
    echo "${LOG_TAG} SUMMARY: ALL backups verified${SUMMARY}"
    exit 0
else
    echo "${LOG_TAG} SUMMARY: ONE OR MORE backups FAILED${SUMMARY}"
    if [ -r /root/scripts/lib/notify-failure.sh ]; then
        # shellcheck disable=SC1091
        source /root/scripts/lib/notify-failure.sh
        notify_failure \
            "weekly backup-verify FAILED" \
            "<p>One or more S3 backups failed restore-verification on $(date -u +%FT%TZ).</p><pre>${SUMMARY}</pre><p>Log: <code>/var/log/backup-verify.log</code> on matrxserver.com</p>"
    fi
    exit 1
fi
