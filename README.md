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

---

## Ship Commands

Ship tracks versions, commits, and pushes in one command.

| Action | pnpm (Node) | make (non-Node) | bash (any) |
|--------|-------------|------------------|------------|
| Patch bump + ship | `pnpm ship "msg"` | `make ship MSG="msg"` | `bash scripts/matrx/ship.sh "msg"` |
| Minor bump | `pnpm ship:minor "msg"` | `make ship-minor MSG="msg"` | `bash scripts/matrx/ship.sh --minor "msg"` |
| Major bump | `pnpm ship:major "msg"` | `make ship-major MSG="msg"` | `bash scripts/matrx/ship.sh --major "msg"` |
| Auto-provision | `pnpm ship:init PROJECT "Name"` | `make ship-init ARGS='PROJECT "Name"'` | `bash scripts/matrx/ship.sh init PROJECT "Name"` |
| Manual config | `pnpm ship:init --url URL --key KEY` | — | `bash scripts/matrx/ship.sh init --url URL --key KEY` |
| Save credentials | `pnpm ship:setup --token TOKEN` | `make ship-setup ARGS='--token TOKEN'` | `bash scripts/matrx/ship.sh setup --token TOKEN` |
| Import git history | `pnpm ship:history` | `make ship-history` | `bash scripts/matrx/ship.sh history` |
| Preview import | `pnpm ship:history --dry` | — | `bash scripts/matrx/ship.sh history --dry` |
| Update CLI | `pnpm ship:update` | `make ship-update` | `bash scripts/matrx/ship.sh update` |
| Force remove | `pnpm ship:force-remove INST` | `make ship-force-remove ARGS='INST'` | `bash scripts/matrx/ship.sh force-remove INST` |
| Show status | `pnpm ship status` | `make ship-status` | `bash scripts/matrx/ship.sh status` |
| Show help | `pnpm ship:help` | `make ship-help` | `bash scripts/matrx/ship.sh help` |

### Ship workflow

```
1. One-time (per machine):  pnpm ship:setup --token YOUR_TOKEN
2. Per project:              pnpm ship:init my-project "My Project"
3. Import history:           pnpm ship:history
4. Daily usage:              pnpm ship "your commit message"
```

### Environment variables

| Variable | Description |
|----------|-------------|
| `MATRX_SHIP_SERVER_TOKEN` | Server token for provisioning |
| `MATRX_SHIP_SERVER` | MCP server URL (default: `https://mcp.dev.codematrx.com`) |
| `MATRX_SHIP_URL` | Instance URL (overrides config file) |
| `MATRX_SHIP_API_KEY` | Instance API key (overrides config file) |

### Env-Sync Commands

Env-Sync safely merges secrets between Doppler and local `.env` files.

| Action | pnpm (Node) | make (non-Node) | bash (any) |
|--------|-------------|------------------|------------|
| Safe pull (merge from Doppler) | `pnpm env:pull` | `make env-pull` | `bash scripts/matrx/env-sync.sh pull` |
| Safe push (merge to Doppler) | `pnpm env:push` | `make env-push` | `bash scripts/matrx/env-sync.sh push` |
| Show differences | `pnpm env:diff` | `make env-diff` | `bash scripts/matrx/env-sync.sh diff` |
| Quick summary | `pnpm env:status` | `make env-status` | `bash scripts/matrx/env-sync.sh status` |
| Interactive sync | `pnpm env:sync` | `make env-sync` | `bash scripts/matrx/env-sync.sh sync` |
| Force pull (overwrite local) | `pnpm env:pull:force` | `make env-pull-force` | `bash scripts/matrx/env-sync.sh pull --force` |
| Force push (overwrite Doppler) | `pnpm env:push:force` | `make env-push-force` | `bash scripts/matrx/env-sync.sh push --force` |

### Update / Migrate CLI

| Action | pnpm (Node) | make (non-Node) |
|--------|-------------|------------------|
| Update CLI files + scripts | `pnpm ship:update` | `make ship-update` |
| Re-run full installer | `pnpm tools:update` | `make tools-update` |
| Migrate from old install | `pnpm tools:migrate` | `make tools-migrate` |

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
