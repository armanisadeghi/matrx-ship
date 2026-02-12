# Matrx Ship

Universal deployment and version tracking system. Dockerized per-project instance with full admin portal, CLI tools, and embeddable client components.

Works with **any project** — Node (pnpm), Python, bash, Chrome extensions, anything with a git repo.

## Quick Start

### 1. Install CLI in Your Project

```bash
# From your project root
curl -sL https://raw.githubusercontent.com/armanisadeghi/matrx-ship/main/cli/install.sh | bash
```

The installer auto-detects your project type:
- **Node projects** (has `package.json`): adds `pnpm ship:*` scripts
- **Everything else**: downloads a bash wrapper (`scripts/matrx/ship.sh`)

### 2. Save Your Server Token (one-time per machine)

Get your token from the [Server Manager](https://mcp.dev.codematrx.com/admin/) (Tokens tab).

```bash
# Node projects
pnpm ship:setup --token YOUR_SERVER_TOKEN

# Non-Node projects
bash scripts/matrx/ship.sh setup --token YOUR_SERVER_TOKEN
```

This saves the token to `~/.config/matrx-ship/server.json`. You only do this once — it works across all projects on this machine.

### 3. Provision an Instance

```bash
# Node projects
pnpm ship:init my-project "My Project Name"

# Non-Node projects
bash scripts/matrx/ship.sh init my-project "My Project Name"
```

This calls the MCP server, provisions a new Docker instance (Next.js + PostgreSQL), and writes `.matrx-ship.json` into your project with the URL and API key. The instance is live and ready immediately.

### 4. Ship!

```bash
# Node projects
pnpm ship "your commit message"           # Patch bump
pnpm ship:minor "your commit message"     # Minor bump
pnpm ship:major "your commit message"     # Major bump

# Non-Node projects
bash scripts/matrx/ship.sh "your commit message"
bash scripts/matrx/ship.sh --minor "your commit message"
bash scripts/matrx/ship.sh --major "your commit message"
```

### 5. Import Git History (optional)

Backfill your existing git history into the ship dashboard:

```bash
# Node projects
pnpm ship:history --dry              # Preview first
pnpm ship:history                    # Import all commits

# Non-Node projects
bash scripts/matrx/ship.sh history --dry
bash scripts/matrx/ship.sh history
```

## Architecture

Each project gets its own matrx-ship instance (Next.js + PostgreSQL) deployed via Docker. The CLI tool in each project communicates with its instance's API.

```
Your Project (Next.js / Python / Chrome Extension / etc.)
  └── CLI (scripts/matrx/ship.ts)
        └── POST /api/ship ──→ Matrx Ship Instance
                                  ├── Next.js Admin Portal
                                  ├── PostgreSQL Database
                                  └── Webhook Endpoints
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
| GET | `/api/health` | No | Health check for orchestration |

## Admin Portal

Access at `/admin` with pages for:
- **Dashboard** - Current version hero, quick stats, navigation
- **Versions** - Full version history table with pagination
- **Statistics** - Deployment metrics by period (today, week, month)
- **Deployments** - Deployment status timeline with Vercel links

## CLI Reference

All commands work with either `pnpm ship:*` (Node) or `bash scripts/matrx/ship.sh *` (non-Node).

| Command | Description |
|---------|-------------|
| `setup --token TOKEN` | Save server credentials (one-time per machine) |
| `init PROJECT "Name"` | Auto-provision an instance on the server |
| `init --url URL --key KEY` | Manual config (bring your own instance) |
| `"commit message"` | Patch bump + commit + push |
| `--minor "message"` | Minor bump + commit + push |
| `--major "message"` | Major bump + commit + push |
| `history` | Import full git history |
| `history --dry` | Preview what would be imported |
| `history --clear` | Clear existing versions and reimport |
| `status` | Show current version from server |
| `update` | Update CLI to the latest version |
| `help` | Show all options |

## Embeddable Components

### useAppVersion Hook

```tsx
import { useAppVersion } from "@matrx/ship-client";

const { isUpdateAvailable, reloadApp } = useAppVersion({
  baseUrl: "https://myproject.yourdomain.com",
  pollingInterval: 300000,
});
```

### UpdateBanner Component

```tsx
import { UpdateBanner } from "@matrx/ship-client";

<UpdateBanner
  baseUrl="https://myproject.yourdomain.com"
  pollingInterval={300000}
/>
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `MATRX_SHIP_API_KEY` | No | API key (auto-generated if not set) |
| `PROJECT_NAME` | No | Display name for the project |
| `VERCEL_ACCESS_TOKEN` | No | For Vercel deployment sync |
| `VERCEL_PROJECT_ID` | No | For Vercel deployment sync |
| `VERCEL_TEAM_ID` | No | For Vercel team projects |
| `VERCEL_WEBHOOK_SECRET` | No | Vercel webhook signature verification |
| `GITHUB_WEBHOOK_SECRET` | No | GitHub webhook signature verification |

## Tech Stack

- Next.js 16.1 (App Router) + React 19.2 + TypeScript 5.9
- PostgreSQL 16 + Drizzle ORM
- Tailwind CSS 4.1
- Docker Compose

## Self-Hosting

See [DEPLOY.md](DEPLOY.md) for manual deployment of ship instances via Docker Compose.

## Development

```bash
pnpm install
pnpm dev
```

Requires a PostgreSQL database. Set `DATABASE_URL` in `.env.local` or start the Postgres container:

```bash
docker compose up db -d
```

## License

MIT
