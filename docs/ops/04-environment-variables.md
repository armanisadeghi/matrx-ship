# Environment Variables Reference

## Server Manager (`/srv/apps/server-manager/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 3000) |
| `MANAGER_BEARER_TOKEN` | Yes | Authentication token for API access |
| `HOST_SRV` | Yes | Host path to /srv (mounted into container) |
| `DOMAIN_SUFFIX` | Yes | Base domain for instances (e.g., `dev.codematrx.com`) |
| `GITHUB_TOKEN` | No | GitHub PAT for private repo access |
| `SUPABASE_URL` | No | Supabase project URL for persistence |
| `SUPABASE_SERVICE_KEY` | No | Supabase service role key |
| `AWS_ACCESS_KEY_ID` | No | AWS credentials for S3 backups |
| `AWS_SECRET_ACCESS_KEY` | No | AWS credentials for S3 backups |
| `AWS_S3_BUCKET` | No | S3 bucket name for backups |
| `AWS_S3_REGION` | No | S3 bucket region |

### Legacy Variables (deprecated, still supported as fallback)
| Variable | Replacement |
|----------|-------------|
| `MCP_BEARER_TOKEN` | `MANAGER_BEARER_TOKEN` |

---

## Deploy Server (`/srv/apps/deploy/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 3000) |
| `DEPLOY_TOKEN` | Yes | Authentication token for Deploy UI access |
| `HOST_SRV` | Yes | Host path to /srv (mounted into container) |
| `MANAGER_URL` | No | Server Manager URL (default: `https://manager.dev.codematrx.com`) |
| `MANAGER_TOKEN` | No | Token to authenticate with Server Manager API |
| `SUPABASE_URL` | No | Supabase project URL for persistence |
| `SUPABASE_SERVICE_KEY` | No | Supabase service role key |

---

## Traefik (`/srv/traefik/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `ACME_EMAIL` | Yes | Email for Let's Encrypt certificate registration |
| `TRAEFIK_DASHBOARD_USER` | Yes | Dashboard HTTP basic auth (htpasswd format) |

---

## PostgreSQL (`/srv/postgres/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `POSTGRES_USER` | Yes | Superuser username (default: `postgres`) |
| `POSTGRES_PASSWORD` | Yes | Superuser password |
| `PGADMIN_DEFAULT_EMAIL` | Yes | pgAdmin login email |
| `PGADMIN_DEFAULT_PASSWORD` | Yes | pgAdmin login password |

---

## Ship App Instances (per instance)

Each Ship instance inherits these from the Server Manager's deployment template:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Connection string to the instance's dedicated Postgres |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |
| `NEXTAUTH_SECRET` | NextAuth.js secret |
| `NEXTAUTH_URL` | Instance's public URL |

Additional per-instance variables can be configured via the Server Manager admin UI.

---

## Bootstrap Script (`.env.bootstrap`)

These are required only during initial server provisioning:

| Variable | Required | Description |
|----------|----------|-------------|
| `SERVER_IP` | Yes | Server's public IP address |
| `DOMAIN_SUFFIX` | Yes | Base domain (e.g., `dev.codematrx.com`) |
| `ACME_EMAIL` | Yes | Let's Encrypt email |
| `POSTGRES_PASSWORD` | Yes | Shared Postgres password |
| `PGADMIN_EMAIL` | Yes | pgAdmin admin email |
| `PGADMIN_PASSWORD` | Yes | pgAdmin admin password |
| `MANAGER_BEARER_TOKEN` | Yes | Server Manager auth token |
| `DEPLOY_TOKEN` | Yes | Deploy Server auth token |
| `GITHUB_TOKEN` | No | GitHub PAT for private repos |
| `SUPABASE_URL` | No | Supabase URL for persistence |
| `SUPABASE_SERVICE_KEY` | No | Supabase service role key |
| `AWS_ACCESS_KEY_ID` | No | AWS key for S3 |
| `AWS_SECRET_ACCESS_KEY` | No | AWS secret for S3 |
| `AWS_S3_BUCKET` | No | S3 bucket name |
| `AWS_S3_REGION` | No | S3 region |

---

## Supabase Tables (for persistence)

If Supabase is configured, the following tables must exist in the `matrx_infra` schema:

| Table | Purpose |
|-------|---------|
| `infra_servers` | Server identity records |
| `infra_instances` | App instance configurations |
| `infra_tokens` | Authentication tokens |
| `infra_builds` | Build and deployment history |
| `infra_backups` | Backup records (with S3 paths) |
| `infra_audit_log` | Full audit trail |

These are defined in the Drizzle schema at `src/lib/db/schema.ts` and should be migrated using `drizzle-kit push` or `drizzle-kit migrate`.

---

## Security Notes

- Never commit `.env` files to source control
- Store production secrets in your team's password manager
- Use `SUPABASE_SERVICE_KEY` (service role), not the anon key, for backend operations
- The `MANAGER_BEARER_TOKEN` gives full control of the server — treat it as a root credential
- Rotate tokens periodically and update across all services simultaneously
