# Matrx CLI

Unified command-line tools for Matrx projects: **Ship** (deployment versioning) and **Env-Sync** (Doppler secret management).

## Quick Start

```bash
# Install in any project (Node or Python)
curl -sL https://raw.githubusercontent.com/armanisadeghi/matrx-ship/main/cli/install.sh | bash
```

The installer will:
1. Download CLI files into `scripts/matrx/`
2. Detect your project type (Node/Python)
3. Ask what to set up (Ship, Env-Sync, or both)
4. Register commands in `package.json` or `Makefile`
5. Walk you through configuration
6. Write a unified `.matrx.json` config file

## What Gets Installed

```
your-project/
  scripts/matrx/
    ship.ts           # Ship CLI (TypeScript)
    ship.sh           # Bash wrapper (non-Node projects only)
    env-sync.sh       # Env-Sync CLI
    lib/
      colors.sh       # Terminal colors
      utils.sh        # Shared utilities
  .matrx.json         # Unified config (gitignored)
```

## Configuration

### `.matrx.json` (recommended)

Single config file for both Ship and Env-Sync:

```json
{
  "ship": {
    "url": "https://ship-myproject.dev.codematrx.com",
    "apiKey": "sk_ship_..."
  },
  "env": {
    "doppler": {
      "project": "my-project",
      "config": "dev"
    },
    "file": ".env.local",
    "localKeys": ["DATABASE_URL"]
  }
}
```

### Multi-config (monorepo)

For monorepos with multiple env files:

```json
{
  "ship": { "url": "...", "apiKey": "..." },
  "env": {
    "multi": true,
    "configs": {
      "web": {
        "doppler": { "project": "my-project", "config": "web" },
        "file": "apps/web/.env.local"
      },
      "api": {
        "doppler": { "project": "my-project", "config": "api" },
        "file": "apps/api/.env"
      }
    }
  }
}
```

### Legacy configs (backward compatible)

- **`.matrx-ship.json`** — Ship reads this if `.matrx.json` has no `ship` key
- **`.matrx-tools.conf`** — Env-Sync reads this if `.matrx.json` is missing or jq is unavailable

The installer will automatically migrate legacy configs to `.matrx.json`.

---

## Ship Commands

Ship tracks versions, commits, and pushes in one command.

### Node projects (via pnpm)

| Command | Description |
|---------|-------------|
| `pnpm ship "message"` | Patch version bump + commit + push |
| `pnpm ship:minor "message"` | Minor version bump |
| `pnpm ship:major "message"` | Major version bump |
| `pnpm ship:init PROJECT "Name"` | Auto-provision a Ship instance |
| `pnpm ship:init --url URL --key KEY` | Manual config (legacy) |
| `pnpm ship:setup --token TOKEN` | Save server credentials (one-time per machine) |
| `pnpm ship:history` | Import full git history |
| `pnpm ship:history --dry` | Preview import without changes |
| `pnpm ship:history --clear` | Clear existing + reimport |
| `pnpm ship:history --since 2024-01-01` | Import since date |
| `pnpm ship:update` | Update CLI to latest version |
| `pnpm ship:force-remove INSTANCE` | Forcefully remove a broken instance |
| `pnpm ship status` | Show current version |
| `pnpm ship help` | Show all options |

### Non-Node projects (via bash)

Replace `pnpm ship` with `bash scripts/matrx/ship.sh`:

```bash
bash scripts/matrx/ship.sh "commit message"
bash scripts/matrx/ship.sh --minor "commit message"
bash scripts/matrx/ship.sh init my-project "My Project"
bash scripts/matrx/ship.sh help
```

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

---

## Env-Sync Commands

Env-Sync safely merges secrets between Doppler and local `.env` files.

### Node projects

| Command | Description |
|---------|-------------|
| `pnpm env:status` | Quick summary of sync state |
| `pnpm env:diff` | Show differences between local and Doppler |
| `pnpm env:pull` | Safe merge from Doppler (adds new keys, preserves local) |
| `pnpm env:push` | Safe merge to Doppler (adds new keys, preserves remote) |
| `pnpm env:sync` | Interactive per-key conflict resolution |
| `pnpm env:pull:force` | Full replace from Doppler (overwrites local) |
| `pnpm env:push:force` | Full replace to Doppler (overwrites remote) |

### Python projects

| Command | Description |
|---------|-------------|
| `make env-status` | Quick summary |
| `make env-diff` | Show differences |
| `make env-pull` | Safe merge from Doppler |
| `make env-push` | Safe merge to Doppler |
| `make env-sync` | Interactive conflict resolution |
| `make env-pull-force` | Full replace from Doppler |
| `make env-push-force` | Full replace to Doppler |

### How pull/push work

- **`pull`** (safe): Downloads Doppler secrets, adds new keys to your local file, keeps local values for existing keys unchanged.
- **`push`** (safe): Reads your local env file, adds new keys to Doppler, keeps Doppler values for existing keys unchanged.
- **`pull --force`**: Completely replaces your local file with Doppler values (backs up first).
- **`push --force`**: Completely replaces Doppler values with your local file.
- **`sync`**: Interactive mode — shows each conflicting key and lets you choose which value to keep.

### Local override keys

Some keys are machine-specific (local file paths, machine credentials, etc.) and should never be blindly synced. Add them to `localKeys` in `.matrx.json`:

```json
{
  "env": {
    "localKeys": ["DATABASE_URL", "PYTHONPATH", "GOOGLE_APPLICATION_CREDENTIALS"]
  }
}
```

**How local overrides behave per operation:**

| Operation | Behavior |
|-----------|----------|
| `push` / `push --force` | Stores `__REPLACE_ME__` placeholder in Doppler instead of the real value |
| `pull` (key exists locally) | **Keeps your local value** -- never overwrites |
| `pull` (key missing locally) | Adds the key **commented out** so you're reminded to set it |
| `pull --force` | Same as merge -- local overrides are always preserved |
| `diff` | Shows these keys with a `LOCAL OVERRIDE` label |

After pulling on a fresh machine, your env file will contain:

```bash
# [env-sync] Local override variables -- set these for your environment:
# DATABASE_URL="__REPLACE_ME__"
# PYTHONPATH="__REPLACE_ME__"
```

Uncomment and set the values for your machine. Future pulls will leave them alone.

For multi-config monorepos, local keys are set per config in the legacy `.matrx-tools.conf` format:

```bash
ENV_LOCAL_KEYS_web="BASE_DIR,GOOGLE_APPLICATION_CREDENTIALS"
ENV_LOCAL_KEYS_api="BASE_DIR"
```

---

## Cloning an Existing Project

If the project already has the CLI committed (most do), there's almost nothing to do:

```bash
git clone <repo>
cd <repo>

# Pull your env (will prompt for Doppler login if needed)
pnpm env:pull       # Node
make env-pull       # Python
```

If Doppler CLI isn't installed or you aren't logged in yet, the tool will tell you exactly what to do.

---

## Prerequisites

- **bash 3.2+** -- comes standard on macOS and Linux
- **git** -- for detecting project root
- **Node.js** -- required for Ship CLI (tsx)
- **jq** -- required for `.matrx.json` config reading (env-sync falls back to `.matrx-tools.conf` without it)
- **[Doppler CLI](https://docs.doppler.com/docs/install-cli)** -- for env-sync (auto-installed by the installer)

---

## Updating the CLI

```bash
# Node projects
pnpm ship:update

# Non-Node projects
bash scripts/matrx/ship.sh update

# Or re-run the installer
curl -sL https://raw.githubusercontent.com/armanisadeghi/matrx-ship/main/cli/install.sh | bash
```

---

## Troubleshooting

### "No .matrx.json found"

Run the installer or create `.matrx.json` manually. See `cli/templates/matrx.json.example` for the format.

### "Doppler CLI not found"

Install Doppler: https://docs.doppler.com/docs/install-cli

Then authenticate: `doppler login`

### "jq not found"

Env-sync uses `jq` to read `.matrx.json`. Install it:

- macOS: `brew install jq`
- Ubuntu/Debian: `sudo apt install jq`
- RHEL/Fedora: `sudo dnf install jq`

Without jq, env-sync falls back to `.matrx-tools.conf` (legacy format).

### Ship can't reach the server

Check your config URL and server status:

```bash
curl https://ship-myproject.dev.codematrx.com/api/health
```

### "tsx not found" or "npx not found"

Ship requires Node.js and tsx. Install Node.js, then:

```bash
pnpm add -D tsx
```

### Config file got corrupted

Delete and re-run the installer:

```bash
rm .matrx.json
curl -sL https://raw.githubusercontent.com/armanisadeghi/matrx-ship/main/cli/install.sh | bash
```

### "Already exists" during init

If the instance already exists on the server, Ship will try to retrieve the existing config. If that fails, check the admin UI at `https://mcp.dev.codematrx.com/admin/` for the URL and API key.
