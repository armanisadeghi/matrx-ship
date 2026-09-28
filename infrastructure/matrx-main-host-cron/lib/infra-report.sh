#!/usr/bin/env bash
# Report host infrastructure state into the app's Supabase DB.
#
# Two sinks, on purpose:
#   public.infra_status  -- current state, one row per component (the dead-man switch)
#   ops.app_log          -- the durable log firehose (moved from public; was failing 42P01 since 2026-09-25) the dashboard's Logs page already reads
#
# We write DIRECTLY to Supabase rather than POSTing to the aidream API, because the
# failures we most need to report (disk full, builds wedged) are exactly the ones that
# can take the local API down with them. Supabase is off-box, so it survives us.
#
# psql comes from the postgres:17-alpine image (already on the host for backup-verify.sh).
# Env comes from the aidream repo .env, which /root/scripts/sync-coolify-envs.py keeps
# mirrored from Coolify every 30 min.

INFRA_ENV_FILE="${INFRA_ENV_FILE:-/root/projects/aidream/.env}"
INFRA_PG_IMAGE="${INFRA_PG_IMAGE:-postgres:17-alpine}"

_infra_load_env() {
    [ -f "$INFRA_ENV_FILE" ] || { echo "infra-report: no env file at $INFRA_ENV_FILE" >&2; return 1; }
    # Extract ONLY the keys we need, robustly. Sourcing the whole .env breaks on any value
    # containing spaces/quotes (e.g. a "... PRIVATE KEY ..." blob) -- which it does.
    local k
    for k in SUPABASE_MATRIX_HOST SUPABASE_MATRIX_PORT SUPABASE_MATRIX_USER \
             SUPABASE_MATRIX_PASSWORD SUPABASE_MATRIX_DATABASE_NAME; do
        local v
        v="$(grep -m1 "^${k}=" "$INFRA_ENV_FILE" | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//')"
        export "${k}=${v}"
    done
    [ -n "${SUPABASE_MATRIX_HOST:-}" ] && [ -n "${SUPABASE_MATRIX_PASSWORD:-}" ]
}

# _infra_psql <<<"SQL"  — runs SQL against Supabase, stdin-fed so no secrets hit argv/ps.
_infra_psql() {
    docker run --rm -i \
        -e PGPASSWORD="$SUPABASE_MATRIX_PASSWORD" \
        "$INFRA_PG_IMAGE" \
        psql -h "$SUPABASE_MATRIX_HOST" \
             -p "${SUPABASE_MATRIX_PORT:-6543}" \
             -U "$SUPABASE_MATRIX_USER" \
             -d "${SUPABASE_MATRIX_DATABASE_NAME:-postgres}" \
             -v ON_ERROR_STOP=1 -qtA -f - 2>&1
}

# infra_report <component> <state> <stale_after_seconds> <message> <detail_json>
#
# state: ok | warn | critical | failed
# Upserts infra_status AND appends an app_log row. last_ok_at only advances on state='ok',
# so "when did this last actually work" survives a run of failures.
infra_report() {
    local component="$1" state="$2" stale_after="$3" message="$4" detail="${5:-{\}}"
    local level level_no
    case "$state" in
        ok)       level=INFO;    level_no=20 ;;
        warn)     level=WARNING; level_no=30 ;;
        critical) level=ERROR;   level_no=40 ;;
        failed)   level=ERROR;   level_no=40 ;;
        *)        level=INFO;    level_no=20 ;;
    esac

    _infra_load_env || { echo "infra-report: env load failed; cannot report" >&2; return 1; }

    # Dollar-quoted to avoid any escaping games with the JSON / message payloads.
    _infra_psql <<SQL
INSERT INTO public.infra_status
    (component, state, message, last_run_at, last_ok_at, stale_after_seconds, detail, updated_at)
VALUES (
    \$c\$${component}\$c\$,
    \$s\$${state}\$s\$,
    \$m\$${message}\$m\$,
    now(),
    CASE WHEN \$s2\$${state}\$s2\$ = 'ok' THEN now() ELSE NULL END,
    ${stale_after},
    \$d\$${detail}\$d\$::jsonb,
    now()
)
ON CONFLICT (component) DO UPDATE SET
    state               = EXCLUDED.state,
    message             = EXCLUDED.message,
    last_run_at         = EXCLUDED.last_run_at,
    last_ok_at          = COALESCE(EXCLUDED.last_ok_at, public.infra_status.last_ok_at),
    stale_after_seconds = EXCLUDED.stale_after_seconds,
    detail              = EXCLUDED.detail,
    updated_at          = now();

INSERT INTO ops.app_log
    (level, level_no, logger_name, feature, host_role, message, metadata, classified)
VALUES (
    \$l\$${level}\$l\$, ${level_no},
    \$g\$infra.${component}\$g\$,
    'infra',
    'coolify-host',
    \$m2\$[${component}/${state}] ${message}\$m2\$,
    \$d2\$${detail}\$d2\$::jsonb,
    true
);
SQL
}
