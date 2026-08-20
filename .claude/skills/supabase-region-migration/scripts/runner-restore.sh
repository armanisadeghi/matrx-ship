#!/usr/bin/env bash
set -euo pipefail

RUNNER_ROOT="/mnt/matrx-supabase-migration"
EAST_SECRET_ID="/matrx/migration/supabase-east-services"
SOURCE_ENV_FILE="/etc/aidream/app.env"

run_id="${1:-}"
if [[ ! "$run_id" =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; then
  echo "usage: $0 YYYYMMDDTHHMMSSZ" >&2
  exit 2
fi

out="$RUNNER_ROOT/cutovers/$run_id"
test -d "$out"

read_env_value() {
  local key="$1" value
  value=$(sed -n "s/^${key}=//p" "$SOURCE_ENV_FILE" | tail -1)
  value=${value%\"}; value=${value#\"}; value=${value%\'}; value=${value#\'}
  test -n "$value"
  printf '%s' "$value"
}

for file in roles.sql schema.sql data.dump.tar.zst data-schemas.txt cron-jobs.csv restore-compat.sql pre-data-compat.sql post-data-compat.sql; do
  expected=$(sed -n "s/^${file//./\\.}\.sha256=//p" "$out/manifest.txt")
  actual=$(sha256sum "$out/$file" | awk '{print $1}')
  test -n "$expected"
  test "$actual" = "$expected"
done

east=$(aws secretsmanager get-secret-value --region us-east-1 --secret-id "$EAST_SECRET_ID" --query SecretString --output text)
export PGHOST=$(jq -r .direct_host <<<"$east") PGPORT=5432 PGDATABASE=postgres PGUSER=postgres PGPASSWORD=$(jq -r .password <<<"$east")

empty_counts=$(docker run --rm -e PGHOST -e PGPORT -e PGDATABASE -e PGUSER -e PGPASSWORD \
  postgres:17-alpine psql -X -Atqc \
  "select (select count(*) from pg_namespace where nspname not in ('auth','cron','extensions','graphql','graphql_public','information_schema','net','realtime','storage','vault','public') and nspname not like 'pg_%')||'|'||(select count(*) from pg_tables where schemaname='public')||'|'||(select count(*) from auth.users);")
test "$empty_counts" = "0|0|0"

start_epoch=$(date +%s)
{
  printf 'BEGIN;\n'
  cat "$out/roles.sql" "$out/restore-compat.sql" "$out/schema.sql" "$out/pre-data-compat.sql"
  printf 'COMMIT;\n'
} | docker run --rm -i -e PGHOST -e PGPORT -e PGDATABASE -e PGUSER -e PGPASSWORD \
  postgres:17-alpine psql -X -v ON_ERROR_STOP=1 -q >"$out/restore.stdout.log" 2>"$out/restore.stderr.log"

if [ ! -d "$out/data.dump" ]; then
  zstd -dc "$out/data.dump.tar.zst" | tar -C "$out" -xf -
fi
docker run --rm -v "$out:$out" postgres:17-alpine pg_restore --list "$out/data.dump" \
  | sed '/ TABLE DATA vault secrets /d' >"$out/restore.list"
{
  printf 'BEGIN;\nSET session_replication_role = replica;\n'
  docker run --rm -v "$out:$out" postgres:17-alpine pg_restore \
    --format=directory --data-only --no-owner --role=postgres --exit-on-error \
    --use-list="$out/restore.list" --file=- \
    "$out/data.dump"
  printf 'COMMIT;\n'
} | docker run --rm -i -e PGHOST -e PGPORT -e PGDATABASE -e PGUSER -e PGPASSWORD \
  postgres:17-alpine psql -X -v ON_ERROR_STOP=1 -q >>"$out/restore.stdout.log" 2>>"$out/restore.stderr.log"

{
  printf 'BEGIN;\n'
  cat "$out/post-data-compat.sql"
  printf 'COMMIT;\n'
} | docker run --rm -i -e PGHOST -e PGPORT -e PGDATABASE -e PGUSER -e PGPASSWORD \
  postgres:17-alpine psql -X -v ON_ERROR_STOP=1 -q >>"$out/restore.stdout.log" 2>>"$out/restore.stderr.log"

# Managed Supabase blocks direct writes to vault.secrets. Stream decrypted
# rows from West to East through vault.create_secret without persisting or
# printing plaintext. Base64 keeps COPY framing unambiguous.
SOURCE_PGHOST=$(read_env_value SUPABASE_MATRIX_HOST)
SOURCE_PGUSER=$(read_env_value SUPABASE_MATRIX_USER)
SOURCE_PGPASSWORD=$(read_env_value SUPABASE_MATRIX_PASSWORD)
{
  printf 'CREATE TEMP TABLE matrx_vault_transfer(secret_b64 text, name_b64 text, description_b64 text);\n'
  printf 'COPY matrx_vault_transfer FROM STDIN WITH (FORMAT csv);\n'
  docker run --rm \
    -e PGHOST="$SOURCE_PGHOST" -e PGPORT=5432 -e PGDATABASE=postgres \
    -e PGUSER="$SOURCE_PGUSER" -e PGPASSWORD="$SOURCE_PGPASSWORD" \
    postgres:17-alpine psql -X -qAtc \
    "copy (select encode(convert_to(decrypted_secret,'utf8'),'base64'), encode(convert_to(name,'utf8'),'base64'), encode(convert_to(description,'utf8'),'base64') from vault.decrypted_secrets order by id) to stdout with (format csv)"
  printf '\\.\n'
  printf "SELECT vault.create_secret(convert_from(decode(secret_b64,'base64'),'utf8'), convert_from(decode(name_b64,'base64'),'utf8'), convert_from(decode(description_b64,'base64'),'utf8')) FROM matrx_vault_transfer;\n"
} | docker run --rm -i -e PGHOST -e PGPORT -e PGDATABASE -e PGUSER -e PGPASSWORD \
  postgres:17-alpine psql -X -v ON_ERROR_STOP=1 -q >>"$out/restore.stdout.log" 2>>"$out/restore.stderr.log"
chmod 600 "$out/restore.stdout.log" "$out/restore.stderr.log"

east_counts=$(docker run --rm -e PGHOST -e PGPORT -e PGDATABASE -e PGUSER -e PGPASSWORD \
  postgres:17-alpine psql -X -Atqc \
  "select count(*) from auth.users; select count(*) from public._schema_migrations; select pg_database_size(current_database()); select count(*) from vault.secrets; select count(*) from vault.decrypted_secrets where decrypted_secret is not null; select count(*) from cron.job; select count(*) from cron.job_run_details;")
source_counts=$(sed -n 's/^source_counts=//p' "$out/manifest.txt" | tr ',' '\n')
test "$(sed -n '1p' <<<"$east_counts")" = "$(sed -n '1p' <<<"$source_counts")"
test "$(sed -n '2p' <<<"$east_counts")" = "$(sed -n '2p' <<<"$source_counts")"
test "$(sed -n '4p' <<<"$east_counts")" = "$(sed -n '4p' <<<"$source_counts")"
test "$(sed -n '5p' <<<"$east_counts")" = "$(sed -n '5p' <<<"$source_counts")"
test "$(sed -n '6p' <<<"$east_counts")" = 0
test "$(sed -n '7p' <<<"$east_counts")" = 0

end_epoch=$(date +%s)
printf 'FINAL_RESTORE=passed run_id=%s duration_seconds=%s auth_users=%s migration_ledger=%s east_bytes=%s vault_secrets=%s vault_decryptable=%s\n' \
  "$run_id" "$((end_epoch-start_epoch))" \
  "$(sed -n '1p' <<<"$east_counts")" "$(sed -n '2p' <<<"$east_counts")" "$(sed -n '3p' <<<"$east_counts")" \
  "$(sed -n '4p' <<<"$east_counts")" "$(sed -n '5p' <<<"$east_counts")"
