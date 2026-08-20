---
name: supabase-region-migration
description: Safely inspect, rehearse, verify, and cut over the AI Matrx Supabase Postgres region migration from Matrx Main in us-west-1 to the prepared AI Matrx project in us-east-1. Use for Supabase region-move status, logical backup/restore, project capacity, Auth/config synchronization, cron or pg_net isolation, credential rotation, consumer inventory, acceptance checks, rollback, or database cutover work.
---

# Supabase region migration

Treat this as a production-data migration even during rehearsal. Read
`../common-docs/systems/production-infrastructure/FEATURE.md` from the workspace root and use the
Supabase skill before acting.

## Fixed identity

- Source: `Matrx Main`, `txzxabzwovsujtloxrus`, `us-west-1`.
- Destination: `AI Matrx`, `brsgrqvjdzwihsvnfqkf`, `us-east-1`.
- Migration secret: AWS Secrets Manager `/matrx/migration/supabase-east` in `us-east-1`.
- Protected artifact bucket: `matrx-supabase-migration-artifacts-872515272894` in `us-east-1`.
- Runtime source credential: `/matrx/production/aidream`; use only the five
  `SUPABASE_MATRIX_*` database fields.

Stop if any project ref, region, database version, or account differs. Never include other Supabase
projects in this migration.

## Absolute safety rules

- Never put a database password, access token, service key, provider secret, or connection URL with
  credentials in a command argument, file outside the protected rehearsal directory, logs, docs,
  Terraform, or Git. Fetch values into an environment variable or stdin from the named secret.
- Never copy active `cron.job`, `cron.job_run_details`, `net.http_request_queue`, or
  `net._http_response` rows into a rehearsal. Preserve job definitions separately with mode `0600`.
- Keep East Auth providers, SMTP, SMS, production redirect URLs, Edge Functions, webhooks, and cron
  inactive until the explicit cutover step. Database users may be copied; project-level Auth config
  must remain dormant during rehearsal.
- Do not change source settings or consumers during rehearsal. Do not delete or overwrite West.
- A dump is not a cutover. Production changes require a write pause, a final delta/full copy, consumer
  credential rotation, acceptance tests, a rollback deadline, and an owner.

## Preflight

Use the restricted AWS operator role and current Supabase CLI:

```bash
export AWS_PROFILE=matrx-production
export AWS_REGION=us-east-1
aws sts get-caller-identity
supabase --version
supabase projects list
supabase backups list --project-ref txzxabzwovsujtloxrus -o json
supabase backups list --project-ref brsgrqvjdzwihsvnfqkf -o json
```

Verify source is healthy with PITR and destination is healthy. Query the Management API for both
projects' disk, compute, Auth, Realtime, network, SSL, and backup settings. Compare secret-bearing
configuration by key name and configured/not-configured state; do not emit values.

Before importing, destination disk must have generous room above source database size and destination
compute must be no smaller than the intended production class. Current baseline: source database is
31.1 GB on a 40 GB disk and XL compute; destination is provisioned as XL with a 60 GB gp3 disk for the
rehearsal.

Count `vault.secrets` and prove every row is readable through `vault.decrypted_secrets`. If either
Supabase Vault or pgSodium-backed column encryption is present, copy the source project's managed
root key to East through the official Management API `GET /v1/projects/{source}/pgsodium` → `PUT
/v1/projects/{destination}/pgsodium` before restore. Forward the response body in memory; never print
or persist the key. Read it back from East and compare in memory before importing. A logical backup
contains ciphertext but never this project-level key.

## Create the protected export

Create a mode-`0700` directory with `mktemp -d`; never place database artifacts in a repository.
Initialize and link that directory to the source. Supply the source password through
`SUPABASE_DB_PASSWORD`, populated from Secrets Manager, never `--password`.

Create roles and schema files with the official Supabase CLI. For the 30 GB data set, use a
directory-format `pg_dump --data-only --jobs=8` over the session pooler, include the reviewed
application/Auth/Storage/Vault schema list, and exclude the same side-effect and migration tables.
The parallel dump uses one synchronized snapshot but keeps individual data connections short enough
for the managed connection lifetime. Archive the directory with `tar` + `zstd`:

```bash
supabase db dump --workdir "$migration_dir" --file "$migration_dir/roles.sql" --role-only
supabase db dump --workdir "$migration_dir" --file "$migration_dir/schema.sql"
chmod 600 "$migration_dir"/*.sql
shasum -a 256 "$migration_dir"/*.sql
```

Use the reviewed `runner-export.sh` for the data command rather than reconstructing its schema list,
pooler mode, parallelism, or exclusions at the shell.

Record hashes, byte counts, source transaction timestamp, CLI version, and exclusions without
recording credentials or row contents. Export cron definitions separately into the protected
directory; do not restore them during rehearsal. Upload every dump, the cron inventory, and a
credential-free manifest to the protected artifact bucket with each file's SHA-256 in object
metadata. Verify KMS encryption and object size with `head-object`; multipart ETags are not hashes.

## Restore rehearsal

Confirm East outbound integrations are still inactive immediately before restore. Use the East
credential from `/matrx/migration/supabase-east` through stdin or environment only. Restore with the
destination's Postgres client version and `ON_ERROR_STOP=1` in this order:

1. `roles.sql`
2. a separately hashed compatibility file, only when a proven managed-Supabase permission mismatch
   requires one
3. `schema.sql`
4. one transactional `psql` session that sets `session_replication_role=replica` after authentication
   and consumes `pg_restore --data-only --file=-` from the verified directory archive
5. the reviewed post-data compatibility file

Capture stderr to a protected log. Any error aborts the transaction; never continue a partial
restore. If the fresh destination has conflicts with Supabase-owned objects, use only the remedies
from Supabase's current within-platform migration guide and document each exception.

The source currently contains LOGIN role `svc_seo`, which owns schema objects. The destination's
managed `postgres` role can create it but cannot replay `ALTER ... OWNER TO svc_seo` until membership
is explicit. Keep the original dump immutable; insert a separately hashed `restore-compat.sql`
containing `GRANT "svc_seo" TO "postgres";` between roles and schema. Prove the need with a rolled-back
probe first. The grant is restore authority, not the missing `svc_seo` login password; rotate that
password separately before any consumer uses the role.

Never replay a final schema over a stale rehearsal copy because existing constraints and indexes
collide. Clear dormant East before the maintenance window, while the protected rehearsal artifacts
remain its recovery copy: drop each non-system, non-Supabase-managed schema in its own committed
statement; recreate `public`; clear non-migration Auth tables; drop objects owned by and then drop
`svc_seo`. Preserve the managed schemas `auth`, `cron`, `extensions`, `graphql`, `graphql_public`,
`net`, `realtime`, `storage`, and `vault`, plus their migration ledgers. A single transaction that
drops every application schema exceeds Supabase's `max_locks_per_transaction`; do not retry that
shape. After cleanup, prove roles, compatibility, and schema replay in a transaction ending in
`ROLLBACK`, then verify East is still empty and read/write. The final full restore starts from that
tested clean state.

## Authoritative write pause

Do not use `default_transaction_read_only` as the final managed-Supabase freeze. On this project,
Supabase health management clears that default and restarts the compute, terminating long exports.
Instead, quiesce every writer before the synchronized snapshot:

1. stop Coolify AI Dream, workflow workers, scraper, and all AWS/EC2 services that can write;
2. remove the West `db.matrxserver.com` custom hostname so browser and Vercel clients cannot reach
   the source even through cached DNS;
3. verify native project URLs are absent from production consumer configuration;
4. prove no non-export sessions remain and database transaction/write counters stay unchanged during
   a measured observation interval.

The parallel directory-format dump then supplies one synchronized snapshot without requiring the
managed database itself to stay read-only. Do not begin this pause until maintenance is announced.

The prepared East runner is `matrx-python-server` (`i-0241f4fee60fb02f6`) with the temporary encrypted
volume mounted at `/mnt/matrx-supabase-migration`. Use the reviewed scripts in this skill's `scripts/`
directory: `runner-freeze.sh`, `runner-export.sh`, and `runner-restore.sh`. Upload byte-identical copies
to the runner and verify their hashes before use. The runner's rolled-back schema replay completed in
30 seconds, versus 37 minutes from the West-coast operator machine; final export and restore therefore
run there. The runner role may read only the minimal East service secret and migration artifacts.

## Acceptance gate

Keep all validation pointed explicitly at East. Compare at minimum:

- database size; schema/table/function/extension counts;
- exact row counts for Auth users and every business-critical table;
- estimated/all-table row totals and large-schema sizes;
- RLS policy count and representative anonymous/authenticated/service-role access;
- functions, grants, publications, generated types, migrations ledger, Vault/encrypted-column reads;
- no rows in the four excluded side-effect tables and zero active cron jobs;
- direct DB latency from two ECS AI Dream tasks and one sandbox;
- AI Dream readiness, one read-only application journey, file signing, and a rollback connection test.

Do not copy project API keys or enable Auth providers merely to validate the database. Use dedicated
preview consumers with East credentials.

## Cutover gate

Cut over only after the rehearsal has a measured duration and a clean acceptance report:

Before announcing maintenance, prove the staged consumer set is complete: ECS AI Dream and dormant
workflow worker runtime JSON; the three Vercel projects; the immutable admin-dashboard image; EC2
Matrx Files and Matrx SEO `east`/`west` env files plus switch script; and the Coolify scraper. Do not
rotate unrelated Supabase projects or HTML/sample variables.

1. Announce and begin the write pause; stop every writer and detach the West custom hostname as
   described above, then prove the source is quiescent.
2. Take a new full logical export using the exact tested versions and exclusions. Do not patch the
   stale rehearsal copy.
3. Confirm the pre-cleaned East project is still empty, restore transactionally, and rerun acceptance
   checks.
4. Copy reviewed project-level Auth/Realtime/SSL/network settings. Rotate all consumers to East URL,
   publishable/secret keys, and database connection values. Never reuse West project API keys.
5. Update OAuth callback registrations before enabling providers. Enable SMTP/SMS only after their
   canaries pass.
6. Recreate scheduled jobs as inactive, inspect every command, then enable them one at a time after
   the corresponding consumer is live.
7. Release writes, observe errors/latency/queue depth, and keep West intact and write-protected until
   the declared rollback deadline.

Rollback means stopping East writers and restoring every consumer to West; never attempt to merge
two independently writable projects.
