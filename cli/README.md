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
    "url": "https://myproject.dev.codematrx.com",
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

| Action | pnpm (Node) | make (non-Node) | bash (any) |
|--------|-------------|------------------|------------|
| Patch bump + ship | `pnpm ship "msg"` | `make ship MSG="msg"` | `bash scripts/matrx/ship.sh "msg"` |
| Minor bump | `pnpm ship:minor "msg"` | `make ship-minor MSG="msg"` | `bash scripts/matrx/ship.sh --minor "msg"` |
| Major bump | `pnpm ship:major "msg"` | `make ship-major MSG="msg"` | `bash scripts/matrx/ship.sh --major "msg"` |
| Auto-provision | `pnpm ship:init PROJECT "Name"` | `make ship-init ARGS='...'` | `bash scripts/matrx/ship.sh init PROJECT "Name"` |
| Manual config | `pnpm ship:init --url URL --key KEY` | — | `bash scripts/matrx/ship.sh init --url URL --key KEY` |
| Save credentials | `pnpm ship:setup --token TOKEN` | `make ship-setup ARGS='--token TOKEN'` | `bash scripts/matrx/ship.sh setup --token TOKEN` |
| Import git history | `pnpm ship:history` | `make ship-history` | `bash scripts/matrx/ship.sh history` |
| Preview import | `pnpm ship:history --dry` | — | `bash scripts/matrx/ship.sh history --dry` |
| Clear + reimport | `pnpm ship:history --clear` | — | `bash scripts/matrx/ship.sh history --clear` |
| Import since date | `pnpm ship:history --since DATE` | — | `bash scripts/matrx/ship.sh history --since DATE` |
| Update CLI | `pnpm ship:update` | `make ship-update` | `bash scripts/matrx/ship.sh update` |
| Force remove | `pnpm ship:force-remove INST` | `make ship-force-remove ARGS='INST'` | `bash scripts/matrx/ship.sh force-remove INST` |
| Show status | `pnpm ship status` | `make ship-status` | `bash scripts/matrx/ship.sh status` |
| Show help | `pnpm ship:help` | `make ship-help` | `bash scripts/matrx/ship.sh help` |

---

## Env-Sync Commands

Env-Sync safely merges secrets between Doppler and local `.env` files.

| Action | pnpm (Node) | make (non-Node) | bash (any) |
|--------|-------------|------------------|------------|
| Quick summary | `pnpm env:status` | `make env-status` | `bash scripts/matrx/env-sync.sh status` |
| Show differences | `pnpm env:diff` | `make env-diff` | `bash scripts/matrx/env-sync.sh diff` |
| Safe pull (merge from Doppler) | `pnpm env:pull` | `make env-pull` | `bash scripts/matrx/env-sync.sh pull` |
| Safe push (merge to Doppler) | `pnpm env:push` | `make env-push` | `bash scripts/matrx/env-sync.sh push` |
| Interactive sync | `pnpm env:sync` | `make env-sync` | `bash scripts/matrx/env-sync.sh sync` |
| Force pull (overwrite local) | `pnpm env:pull:force` | `make env-pull-force` | `bash scripts/matrx/env-sync.sh pull --force` |
| Force push (overwrite Doppler) | `pnpm env:push:force` | `make env-push-force` | `bash scripts/matrx/env-sync.sh push --force` |

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

## Migrating from Old Installs

If your project was set up with the old `matrx-dev-tools` repo or an earlier version of `matrx-ship`, run the migration tool to bring everything up to date:

```bash
# Node projects (if tools:migrate is already registered)
pnpm tools:migrate

# Any project (one-liner)
curl -sL https://raw.githubusercontent.com/armanisadeghi/matrx-ship/main/cli/migrate.sh | bash
```

The migration tool will:
1. Re-download all CLI scripts from the latest source
2. Migrate `.matrx-ship.json` and `.matrx-tools.conf` into unified `.matrx.json`
3. Fix `tools:update` URLs that still point to `matrx-dev-tools`
4. Register any missing `package.json` scripts or Makefile targets
5. Add `tools:migrate` command for future use
6. Clean up stale files (e.g. `ship.sh` in Node projects)
7. Update `.gitignore` with all needed entries

Safe to run multiple times -- it's idempotent and won't touch configs that are already correct.

---

## Updating the CLI

| Action | pnpm (Node) | make (non-Node) |
|--------|-------------|------------------|
| Update CLI files + scripts | `pnpm ship:update` | `make ship-update` |
| Re-run full installer | `pnpm tools:update` | `make tools-update` |
| Migrate from old install | `pnpm tools:migrate` | `make tools-migrate` |

Or re-run the installer directly:

```bash
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
curl https://myproject.dev.codematrx.com/api/health
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

If the instance already exists on the server, Ship will try to retrieve the existing config. If that fails, check the admin UI at `https://manager.dev.codematrx.com/admin/` for the URL and API key.
