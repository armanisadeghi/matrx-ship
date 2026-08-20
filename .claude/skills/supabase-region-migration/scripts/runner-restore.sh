#!/usr/bin/env bash
set -euo pipefail

RUNNER_ROOT="/mnt/matrx-supabase-migration"
EAST_SECRET_ID="/matrx/migration/supabase-east-services"

run_id="${1:-}"
if [[ ! "$run_id" =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; then
  echo "usage: $0 YYYYMMDDTHHMMSSZ" >&2
  exit 2
fi

out="$RUNNER_ROOT/cutovers/$run_id"
test -d "$out"

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
export PGOPTIONS='-c session_replication_role=replica'
docker run --rm \
  -v "$out:$out" \
  -e PGHOST -e PGPORT -e PGDATABASE -e PGUSER -e PGPASSWORD -e PGOPTIONS \
  postgres:17-alpine pg_restore \
  --dbname=postgres --format=directory --jobs=8 --data-only --no-owner --role=postgres --exit-on-error \
  "$out/data.dump" >>"$out/restore.stdout.log" 2>>"$out/restore.stderr.log"
unset PGOPTIONS

{
  printf 'BEGIN;\n'
  cat "$out/post-data-compat.sql"
  printf 'COMMIT;\n'
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
