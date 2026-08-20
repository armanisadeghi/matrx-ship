#!/usr/bin/env bash
set -euo pipefail

RUNNER_ROOT="/mnt/matrx-supabase-migration"
SOURCE_WORKDIR="$RUNNER_ROOT/source-link"
SOURCE_ENV_FILE="/etc/aidream/app.env"
ARTIFACT_BUCKET="matrx-supabase-migration-artifacts-872515272894"
KMS_ALIAS="alias/matrx-supabase-migration-artifacts"
SUPABASE="$RUNNER_ROOT/supabase"
PG_IMAGE="public.ecr.aws/supabase/postgres:17.6.1.113"

run_id="${1:-}"
if [[ ! "$run_id" =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; then
  echo "usage: $0 YYYYMMDDTHHMMSSZ" >&2
  exit 2
fi

read_env_value() {
  local key="$1" value
  value=$(sed -n "s/^${key}=//p" "$SOURCE_ENV_FILE" | tail -1)
  value=${value%\"}; value=${value#\"}; value=${value%\'}; value=${value#\'}
  test -n "$value"
  printf '%s' "$value"
}

export SUPABASE_DB_PASSWORD
SUPABASE_DB_PASSWORD=$(read_env_value SUPABASE_MATRIX_PASSWORD)
# Use Supabase's session pooler for the long-running dump. The direct endpoint
# repeatedly closed multi-gigabyte COPY streams; port 5432 is session mode
# (the application's port 6543 is transaction mode and is not suitable here).
export PGHOST PGPORT=5432 PGDATABASE=postgres PGUSER PGPASSWORD="$SUPABASE_DB_PASSWORD"
PGHOST=$(read_env_value SUPABASE_MATRIX_HOST)
PGUSER=$(read_env_value SUPABASE_MATRIX_USER)
export PGCONNECT_TIMEOUT=30 PGKEEPALIVES=1 PGKEEPALIVES_IDLE=30 PGKEEPALIVES_INTERVAL=10 PGKEEPALIVES_COUNT=6

pg_container() {
  docker run --rm \
    -v "$RUNNER_ROOT:$RUNNER_ROOT" \
    -e PGHOST -e PGPORT -e PGDATABASE -e PGUSER -e PGPASSWORD \
    -e PGCONNECT_TIMEOUT -e PGKEEPALIVES -e PGKEEPALIVES_IDLE \
    -e PGKEEPALIVES_INTERVAL -e PGKEEPALIVES_COUNT \
    "$PG_IMAGE" "$@"
}

source_mode=$(pg_container psql -X -Atqc "select current_setting('default_transaction_read_only');")
test "$source_mode" = off

out="$RUNNER_ROOT/cutovers/$run_id"
test ! -e "$out"
install -d -m 700 "$out"
start_epoch=$(date +%s)

"$SUPABASE" db dump --workdir "$SOURCE_WORKDIR" --file "$out/roles.sql" --role-only
"$SUPABASE" db dump --workdir "$SOURCE_WORKDIR" --file "$out/schema.sql"

# Use one parallel directory-format pg_dump. Its synchronized snapshot keeps
# the whole database consistent while worker connections keep the 30 GB copy
# below the managed connection lifetime.
pg_container psql -X -Atqc \
  "select n.nspname from pg_namespace n where exists (select 1 from pg_tables t where t.schemaname=n.nspname) and n.nspname not in ('information_schema','pg_catalog','pg_toast','cron','net','extensions','realtime','supabase_functions','supabase_migrations','pgsodium') and n.nspname not like 'pg_temp_%' and n.nspname not like 'pg_toast_temp_%' order by n.nspname" \
  >"$out/data-schemas.txt"

schema_args=()
while IFS= read -r schema; do
  test -n "$schema"
  schema_args+=(--schema "$schema")
done <"$out/data-schemas.txt"

pg_container pg_dump \
  --format=directory --jobs=8 --file="$out/data.dump" \
  --data-only --quote-all-identifiers --role postgres \
  --exclude-table auth.schema_migrations \
  --exclude-table storage.migrations \
  --exclude-table supabase_functions.migrations \
  --exclude-table storage.buckets_vectors \
  --exclude-table storage.vector_indexes \
  "${schema_args[@]}"

pg_container psql -X -v ON_ERROR_STOP=1 -c \
  "copy (select jobid,schedule,command,database,username,active,jobname from cron.job order by jobid) to stdout with csv header" \
  >"$out/cron-jobs.csv"

prefix="s3://$ARTIFACT_BUCKET/rehearsals/2026-08-18/source-txzxabzwovsujtloxrus"
for name in restore-compat.sql pre-data-compat.sql post-data-compat.sql; do
  aws s3 cp "$prefix/$name" "$out/$name" --no-progress >/dev/null
done

tar -C "$out" -cf - data.dump | zstd -3 -T0 --no-progress -o "$out/data.dump.tar.zst"
chmod 600 "$out"/*.sql "$out"/*.txt "$out"/*.csv "$out"/*.zst

source_counts=$(pg_container psql -X -Atqc \
  "select count(*) from auth.users; select count(*) from public._schema_migrations; select pg_database_size(current_database()); select count(*) from vault.secrets; select count(*) from vault.decrypted_secrets where decrypted_secret is not null;")

{
  printf 'format_version=1\nrun_id=%s\nsource_project_ref=txzxabzwovsujtloxrus\nsource_region=us-west-1\n' "$run_id"
  printf 'source_counts=%s\n' "$(tr '\n' ',' <<<"$source_counts" | sed 's/,$//')"
  printf 'excluded_data=storage.buckets_vectors,storage.vector_indexes,cron.job,cron.job_run_details,net.http_request_queue,net._http_response\n'
  for file in roles.sql schema.sql data.dump.tar.zst data-schemas.txt cron-jobs.csv restore-compat.sql pre-data-compat.sql post-data-compat.sql; do
    printf '%s.bytes=%s\n' "$file" "$(stat -c %s "$out/$file")"
    printf '%s.sha256=%s\n' "$file" "$(sha256sum "$out/$file" | awk '{print $1}')"
  done
} >"$out/manifest.txt"
chmod 600 "$out/manifest.txt"

destination="s3://$ARTIFACT_BUCKET/cutovers/2026-08-19/$run_id"
for name in roles.sql schema.sql data.dump.tar.zst data-schemas.txt cron-jobs.csv restore-compat.sql pre-data-compat.sql post-data-compat.sql manifest.txt; do
  file="$out/$name"
  aws s3 cp "$file" "$destination/$(basename "$file")" \
    --sse aws:kms --sse-kms-key-id "$KMS_ALIAS" --no-progress >/dev/null
done

end_epoch=$(date +%s)
printf 'FINAL_EXPORT=passed run_id=%s duration_seconds=%s archive_bytes=%s\n' \
  "$run_id" "$((end_epoch-start_epoch))" "$(stat -c %s "$out/data.dump.tar.zst")"
