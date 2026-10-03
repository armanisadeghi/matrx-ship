# matrx-main host cron scripts (mirror)

This is a **read-only mirror** of `/root/scripts` on the Coolify host `matrx-main`
(89.116.187.5, SSH alias `matrx-main` in `~/.ssh/config`). These scripts exist only on
that server — they are in no other repo — so a host rebuild would silently lose them.
This copy exists purely so the fix history and logic survive a rebuild; **it is not
deployed from here**. Two literal secrets found while copying were replaced with
required env-var references (`RESEND_API_KEY` in `lib/notify-failure.sh`,
`DEV_LOGIN_SECRET` in `_watch-dev-deploy.sh`) — restore the real values only on the
server's own env, never in this repo.

## Crontab (root's crontab on matrx-main)

| Schedule | Script | Writes |
|---|---|---|
| every 1 min | `deploy-coalescer.sh` (+ `deploy-coalescer.php`, `deploy-coalescer-lib.php`) | Coolify's own deployment queue tables (collapses superseded queued builds) |
| every 1 min | `deploy-groomer-watch.sh` (+ `deploy-groomer.py`) | Docker image prune per app after a build succeeds |
| every 5 min | `matrx-infra-watchdog.sh` (sources `lib/infra-report.sh`) | `ops.app_log`, `public.infra_status` on the live Supabase Postgres (loggers `infra.disk`, `infra.deploy_queue`) |
| every 5 min | `deploy-reconciler.py --shadow --quiet` | log file only (shadow/log-only mode, no live writes) |
| every 30 min | `matrx-janitor.sh` (sources `lib/infra-report.sh`) | `ops.app_log`, `public.infra_status` (loggers `infra.coolify_cleanup`, `infra.janitor`); also prunes Docker images/build cache |
| every 30 min | `sync-coolify-envs.py` | mirrors Coolify prod/dev env vars into repo `.env` files on the host |
| daily 2:30 AM UTC | `backup-coolify-db.sh` | Coolify's own Postgres backup dump to disk/S3 |
| weekly Sun 4:15 AM UTC | `backup-verify.sh` | restores the latest backup into a scratch container to verify it |
| nightly 3:20 AM UTC | `deploy-groomer.py --all` | full image groom + S3 archive of age anchors |

`install-backup-verify-cron.sh` installs the weekly `backup-verify.sh` line above.
`_watch-dev-deploy.sh` is an ad-hoc one-off (not in crontab), used to watch a dev
deploy finish and probe the `/api/dev/login-as` endpoint.

## DB objects touched

- `ops.app_log` and `public.infra_status` — written by `lib/infra-report.sh`, sourced
  by both `matrx-infra-watchdog.sh` and `matrx-janitor.sh`. As of 2026-09-28 the
  `app_log` insert targets `ops.app_log` (fixed from a stale `public.app_log`
  reference — see `common-docs/systems/architecture/database/projects/database-estate-reduction/PLAN.md`,
  2026-09-28 00:04 row, and the on-server backup
  `/root/scripts/lib/infra-report.sh.bak-20260928-app_log`).
- Coolify's own internal Postgres (`coolify` DB, container `coolify-db`) — read/written
  by the coalescer, backup, and backup-verify scripts. Not the AI Matrx product DB.

## Keeping the server copy in step

There is no deploy pipeline for this directory — it is not built or pulled by
anything. To apply a change made here to the real host:

1. Edit the file here, verify it, commit it (paths under
   `infrastructure/matrx-main-host-cron/` only).
2. Copy the changed file to the host, e.g.:
   `ssh matrx-main "cat > /root/scripts/<path>" < infrastructure/matrx-main-host-cron/<path>`
3. If secrets were replaced with env-var references, confirm the same variable
   already exists in the host's environment (e.g. sourced from `/root/.coolify-token`
   or the shell's own env) before relying on it — the host is the source of truth
   for actual secret values, never this repo.
4. If you add/remove a cron line, edit it live with `ssh matrx-main "crontab -e"`
   (or `crontab -l` / pipe a new file) and update the table above in the same change.
5. Re-pull this mirror after any live server-side fix so it doesn't drift again:
   `ssh matrx-main "cat /root/scripts/<path>"` and diff against this copy.
