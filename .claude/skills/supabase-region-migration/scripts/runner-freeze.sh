#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIRECT_HOST="db.txzxabzwovsujtloxrus.supabase.co"
SOURCE_ENV_FILE="/etc/aidream/app.env"
PROBE_TABLE="__matrx_cutover_freeze_probe_20260819"

read_env_value() {
  local key="$1" value
  value=$(sed -n "s/^${key}=//p" "$SOURCE_ENV_FILE" | tail -1)
  value=${value%\"}; value=${value#\"}; value=${value%\'}; value=${value#\'}
  test -n "$value"
  printf '%s' "$value"
}

SOURCE_POOL_HOST=$(read_env_value SUPABASE_MATRIX_HOST)
SOURCE_POOL_USER=$(read_env_value SUPABASE_MATRIX_USER)
export PGPORT=5432 PGDATABASE=postgres
export PGPASSWORD=$(read_env_value SUPABASE_MATRIX_PASSWORD)

query() {
  local host="$1" database="$2" user="$3" sql="$4"
  docker run --rm \
    -e PGHOST="$host" -e PGPORT -e PGDATABASE="$database" -e PGUSER="$user" -e PGPASSWORD \
    postgres:17-alpine psql -X -v ON_ERROR_STOP=1 -Atqc "$sql"
}

mode() {
  local host="$1"
  if [ "$host" = "$SOURCE_DIRECT_HOST" ]; then
    query "$host" postgres postgres "select current_setting('default_transaction_read_only');"
  else
    query "$host" postgres "$SOURCE_POOL_USER" "select current_setting('default_transaction_read_only');"
  fi
}

assert_mode() {
  local expected="$1" direct pooled
  direct=$(mode "$SOURCE_DIRECT_HOST")
  pooled=$(mode "$SOURCE_POOL_HOST")
  test "$direct" = "$expected"
  test "$pooled" = "$expected"
  printf 'SOURCE_DIRECT_MODE=%s SOURCE_POOL_MODE=%s\n' "$direct" "$pooled"
}

case "${1:-status}" in
  freeze)
    query "$SOURCE_DIRECT_HOST" template1 postgres \
      "alter database postgres set default_transaction_read_only = on; select pg_terminate_backend(pid) from pg_stat_activity where datname='postgres' and pid <> pg_backend_pid();" >/dev/null
    assert_mode on
    if query "$SOURCE_DIRECT_HOST" postgres postgres "create table public.${PROBE_TABLE}(id integer);" >/dev/null 2>&1; then
      echo "Direct write probe unexpectedly succeeded" >&2
      exit 1
    fi
    if query "$SOURCE_POOL_HOST" postgres "$SOURCE_POOL_USER" "create table public.${PROBE_TABLE}(id integer);" >/dev/null 2>&1; then
      echo "Pooled write probe unexpectedly succeeded" >&2
      exit 1
    fi
    test "$(query "$SOURCE_DIRECT_HOST" postgres postgres "select count(*) from pg_class where relname='${PROBE_TABLE}';")" = 0
    echo SOURCE_WRITE_FREEZE=verified
    ;;
  unfreeze)
    query "$SOURCE_DIRECT_HOST" template1 postgres \
      "alter database postgres reset default_transaction_read_only; select pg_terminate_backend(pid) from pg_stat_activity where datname='postgres' and pid <> pg_backend_pid();" >/dev/null
    assert_mode off
    test "$(query "$SOURCE_DIRECT_HOST" postgres postgres "select count(*) from pg_class where relname='${PROBE_TABLE}';")" = 0
    echo SOURCE_WRITE_FREEZE=released
    ;;
  status)
    printf 'SOURCE_DIRECT_MODE=%s SOURCE_POOL_MODE=%s\n' "$(mode "$SOURCE_DIRECT_HOST")" "$(mode "$SOURCE_POOL_HOST")"
    ;;
  *)
    echo "usage: $0 {status|freeze|unfreeze}" >&2
    exit 2
    ;;
esac
