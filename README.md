# Matrx Ship

Universal deployment and version tracking system. Dockerized per-project instance with full admin portal, CLI tools, and embeddable client components.

## Quick Start

### 1. Deploy an Instance

```bash
# Clone and configure
git clone https://github.com/armanisadeghi/matrx-ship.git
cd matrx-ship
cp .env.example .env

# Start with Docker Compose
docker compose up -d
```

The instance will be available at `http://localhost:3000`. On first boot it:
- Runs database migrations automatically
- Seeds an initial v1.0.0 version
- Generates an API key (printed to logs if `MATRX_SHIP_API_KEY` is not set)

### 2. Install CLI in Your Project

```bash
# One-line installer
curl -sL https://raw.githubusercontent.com/armanisadeghi/matrx-ship/main/cli/install.sh | bash

# Configure
matrx-ship init --url https://ship-myproject.yourdomain.com --key sk_ship_xxxxx
```

### 3. Ship!

```bash
pnpm ship "your commit message"           # Patch bump
pnpm ship:minor "your commit message"     # Minor bump
pnpm ship:major "your commit message"     # Major bump
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

## Embeddable Components

### useAppVersion Hook

```tsx
import { useAppVersion } from "@matrx/ship-client";

const { isUpdateAvailable, reloadApp } = useAppVersion({
  baseUrl: "https://ship-myproject.yourdomain.com",
  pollingInterval: 300000,
});
```

### UpdateBanner Component

```tsx
import { UpdateBanner } from "@matrx/ship-client";

<UpdateBanner
  baseUrl="https://ship-myproject.yourdomain.com"
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
