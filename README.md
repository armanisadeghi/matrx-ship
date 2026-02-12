# Matrx Ship

Universal deployment, version tracking, and environment management for all Matrx projects. One repo, one CLI -- works with Node, Python, or any project with a git repo.

This repo contains:
- **Ship** -- deployment versioning (CLI + per-project Docker instances + admin portal)
- **Env-Sync** -- safe Doppler-to-local env synchronization
- **Server Manager** -- admin UI for managing all running server instances
- **Deploy UI** -- web interface for triggering rebuilds

---

## Using in Other Projects

### Install

```bash
curl -sL https://raw.githubusercontent.com/armanisadeghi/matrx-ship/main/cli/install.sh | bash
```

The installer will:
1. Detect your project type (Node / Python / other)
2. Ask what to set up (Ship, Env-Sync, or both)
3. Download CLI files to `scripts/matrx/`
4. Register commands (`package.json` for Node, `Makefile` for everything else)
5. Walk you through config and write `.matrx.json`

### Migrate / Update Existing Projects

If a project was set up with the old `matrx-dev-tools` repo or an earlier version:

```bash
curl -sL https://raw.githubusercontent.com/armanisadeghi/matrx-ship/main/cli/migrate.sh | bash
```

This re-downloads all scripts, migrates legacy configs (`.matrx-ship.json`, `.matrx-tools.conf`) into unified `.matrx.json`, fixes stale URLs, and registers any missing commands. Safe to run multiple times.

### Ship Commands

| Node | Make | What it does |
|------|------|--------------|
| `pnpm ship "message"` | `make ship MSG="message"` | Patch bump + commit + push |
| `pnpm ship:minor "msg"` | `make ship-minor MSG="msg"` | Minor bump |
| `pnpm ship:major "msg"` | `make ship-major MSG="msg"` | Major bump |
| `pnpm ship:setup --token T` | `make ship-setup` | Save server token (once per machine) |
| `pnpm ship:init name "Name"` | `make ship-init` | Provision a new instance |
| `pnpm ship:history` | `make ship-history` | Import git history to dashboard |
| `pnpm ship:update` | `make ship-update` | Update CLI to latest |
| `pnpm ship status` | `make ship-status` | Show current version |
| `pnpm ship help` | `make ship-help` | All options |

### Env-Sync Commands

| Node | Make | What it does |
|------|------|--------------|
| `pnpm env:pull` | `make env-pull` | Safe merge from Doppler (add + update, never delete) |
| `pnpm env:push` | `make env-push` | Safe merge to Doppler |
| `pnpm env:diff` | `make env-diff` | Show differences |
| `pnpm env:status` | `make env-status` | Quick summary |
| `pnpm env:pull:force` | `make env-pull-force` | Full replace from Doppler |
| `pnpm env:push:force` | `make env-push-force` | Full replace to Doppler |

### Update CLI

```bash
pnpm tools:update       # Node
make tools-update        # Make
# or re-run the installer
```

Full CLI documentation: [`cli/README.md`](cli/README.md)

---

## Architecture

Each project gets its own Ship instance (Next.js + PostgreSQL) deployed via Docker. The CLI communicates with its instance's API.

```
Your Project (Node / Python / anything)
  └── scripts/matrx/
        ├── ship.ts          → POST /api/ship → Your Ship Instance
        ├── env-sync.sh      → Doppler CLI
        └── .matrx.json      → Config (URL, API key, Doppler settings)
```

## Repo Structure

```
matrx-ship/
  cli/                 # Source for all CLI tools (installed into other projects)
    ship.ts            # Ship CLI
    ship.sh            # Bash wrapper for non-Node
    env-sync.sh        # Env-Sync CLI
    install.sh         # Installer
    migrate.sh         # Migration tool
    lib/               # Shared bash utilities
    templates/         # Config file examples
  deploy/              # Deploy UI source
  server-manager/      # Server Manager source
  src/                 # Ship app source (Next.js)
  public/              # Static assets (logo variants, favicons)
```

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/version` | No | Current deployed version |
| GET | `/api/version/history` | No | Paginated version history |
| GET | `/api/version/stats` | No | Deployment statistics |
| POST | `/api/ship` | API Key | Create a new version (CLI) |
| POST | `/api/webhooks/vercel` | Webhook | Vercel deployment status |
| POST | `/api/webhooks/github` | Webhook | GitHub push events |
| GET | `/api/health` | No | Health check |

## Admin Portal

Each Ship instance has an admin portal at `/admin`:
- **Dashboard** -- current version, quick stats
- **Versions** -- full version history with pagination
- **Statistics** -- deployment metrics by period
- **Deployments** -- status timeline with Vercel links

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `MATRX_SHIP_API_KEY` | No | API key (auto-generated if not set) |
| `PROJECT_NAME` | No | Display name for the project |
| `VERCEL_ACCESS_TOKEN` | No | For Vercel deployment sync |
| `VERCEL_PROJECT_ID` | No | For Vercel deployment sync |
| `VERCEL_TEAM_ID` | No | For Vercel team projects |

## Tech Stack

- Next.js 16.1 (App Router) + React 19.2 + TypeScript 5.9
- PostgreSQL 16 + Drizzle ORM
- Tailwind CSS 4.1
- Docker Compose

## Development

```bash
pnpm install
pnpm dev
```

Requires PostgreSQL. Set `DATABASE_URL` in `.env` or start the container:

```bash
docker compose up db -d
```

## Self-Hosting

See [DEPLOY.md](DEPLOY.md) for manual deployment of Ship instances via Docker Compose.

## License

MIT
