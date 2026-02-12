# matrx-dev-tools

Shared developer tooling for all AI Matrx projects. One repo, works everywhere — Node (pnpm) and Python alike.

## Prerequisites

- **bash 3.2+** — comes standard on macOS and Linux
- **git** — for cloning repos and detecting project root

That's it. The installer handles everything else automatically — including installing the Doppler CLI and walking you through authentication.

## Quick Start — New Project

Run this from any project root:

```bash
curl -sL https://raw.githubusercontent.com/armanisadeghi/matrx-dev-tools/main/install.sh | bash
```

The installer will:
1. Detect your project type (Node/Python) and suggest smart defaults
2. Ask for your Doppler project name (defaults to the repo directory name)
3. Install scripts to `scripts/matrx/`
4. Register commands in `package.json` (Node) or `Makefile` (Python)
5. Install the Doppler CLI if missing (macOS via Homebrew, Linux via apt/rpm/install script)
6. Walk you through `doppler login` if not authenticated

### After Installing

Pull your environment variables:

```bash
pnpm env:pull       # Node
make env-pull       # Python
```

That's it. Your `.env.local` (or `.env`) is populated from Doppler.

## Quick Start — Cloning an Existing Project

If the project already has matrx-dev-tools committed (most do), there's almost nothing to do:

```bash
git clone <repo>
cd <repo>

# Pull your env (will prompt for Doppler login if needed)
pnpm env:pull       # Node
make env-pull       # Python
```

If Doppler CLI isn't installed or you aren't logged in yet, the tool will tell you exactly what to do.

## Update

```bash
pnpm tools:update    # Node
make tools-update    # Python
```

## Tools

### env-sync — Safe Doppler ↔ .env synchronization

Merge-based sync that **never deletes** keys from either side. Changed values keep the new value and comment out the old one with a timestamp.

| Node Command | Python Command | What it does |
|---|---|---|
| `pnpm env:status` | `make env-status` | Quick variable count summary |
| `pnpm env:diff` | `make env-diff` | Show differences between local and Doppler |
| `pnpm env:pull` | `make env-pull` | Safe merge from Doppler (add + update, never delete) |
| `pnpm env:push` | `make env-push` | Safe merge to Doppler (add + update, never delete) |
| `pnpm env:pull:force` | `make env-pull-force` | Full replace from Doppler |
| `pnpm env:push:force` | `make env-push-force` | Full replace to Doppler |

### Local Override Keys — Machine-Specific Variables

Some environment variables are machine-specific (local file paths, machine credentials, etc.) and should **never** be blindly synced between environments. List them in `.matrx-tools.conf`:

```bash
ENV_LOCAL_KEYS="ADMIN_PYTHON_ROOT,BASE_DIR,PYTHONPATH,GOOGLE_APPLICATION_CREDENTIALS"
```

**What happens:**

| Operation | Behavior |
|---|---|
| `env:push` / `env:push:force` | Stores `__REPLACE_ME__` placeholder in Doppler instead of the real value |
| `env:pull` (key exists locally) | **Keeps your local value** — never overwrites |
| `env:pull` (key missing locally) | Adds the key **commented out** so you're reminded to set it |
| `env:pull:force` | Same as merge — local overrides are always preserved |
| `env:diff` | Shows these keys with a `⚙ LOCAL OVERRIDE` label |

Example: after pulling on a fresh machine, your `.env.local` will contain:

```bash
# [env-sync] Local override variables — set these for your environment:
# ADMIN_PYTHON_ROOT="__REPLACE_ME__"
# BASE_DIR="__REPLACE_ME__"
# PYTHONPATH="__REPLACE_ME__"
```

Uncomment and set the values for your machine. Future pulls will leave them alone.

### Monorepo / Multi-config

The installer **automatically detects** monorepo and multi-service structures. It scans for:

- **pnpm/npm/yarn workspaces** in `package.json`
- **Turborepo/Nx** config files (`turbo.json`, `nx.json`)
- **Known directory patterns**: `apps/*/`, `packages/*/`, `services/*/` with their own `package.json` or `pyproject.toml`
- **Docker Compose** `env_file:` entries pointing to subdirectories
- **Existing `.env` files** in subdirectories

When detected, the installer offers to set up multi-config automatically:

```
  Detected project structure:
    apps/web/     (Next.js)
    apps/api/     (Python)

  Set up multi-config env sync for these? (y/n) [y]:

  [web]
    Doppler project [my-app]:
    Doppler config [web]:
    Env file [apps/web/.env.local]:

  [api]
    Doppler project [my-app]:
    Doppler config [api]:
    Env file [apps/api/.env]:
```

This generates a `.matrx-tools.conf` with `DOPPLER_MULTI="true"`. All `env:pull`, `env:push`, `env:diff`, and `env:status` commands then operate on every config automatically.

#### Manual multi-config setup

If you prefer to set it up manually (or the auto-detection didn't find your structure), edit `.matrx-tools.conf`:

```bash
DOPPLER_MULTI="true"
DOPPLER_CONFIGS="web,api"

DOPPLER_PROJECT_web="my-project"
DOPPLER_CONFIG_web="web"
ENV_FILE_web="apps/web/.env.local"

DOPPLER_PROJECT_api="my-project"
DOPPLER_CONFIG_api="api"
ENV_FILE_api="apps/api/.env"
```

#### Switching between single and multi-config

To switch from single to multi: add the `DOPPLER_MULTI` / `DOPPLER_CONFIGS` / per-config keys above. The root `DOPPLER_PROJECT` / `DOPPLER_CONFIG` / `ENV_FILE` are ignored when `DOPPLER_MULTI="true"`.

To switch from multi to single: set `DOPPLER_MULTI="false"` (or remove it) and ensure the root keys are set.

Or just delete `.matrx-tools.conf` and re-run the installer — it will re-detect and ask you.

Per-config local override keys are also supported:

```bash
ENV_LOCAL_KEYS_web="BASE_DIR,GOOGLE_APPLICATION_CREDENTIALS"
ENV_LOCAL_KEYS_api="BASE_DIR"
```

## Configuration

Each project has a `.matrx-tools.conf` file in its root.

**Single-config (most projects):**

```bash
PROJECT_TYPE="node"
TOOLS_ENABLED="env-sync"
DOPPLER_PROJECT="ai-matrx-admin"
DOPPLER_CONFIG="dev"
ENV_FILE=".env.local"

# Machine-specific keys (optional)
ENV_LOCAL_KEYS="ADMIN_PYTHON_ROOT,BASE_DIR,PYTHONPATH"
```

**Multi-config (monorepos / multi-service):**

```bash
PROJECT_TYPE="node"
TOOLS_ENABLED="env-sync"
DOPPLER_MULTI="true"
DOPPLER_CONFIGS="web,api"

DOPPLER_PROJECT_web="my-project"
DOPPLER_CONFIG_web="web"
ENV_FILE_web="apps/web/.env.local"

DOPPLER_PROJECT_api="my-project"
DOPPLER_CONFIG_api="api"
ENV_FILE_api="apps/api/.env"
```

The installer creates this automatically with smart defaults:
- **DOPPLER_PROJECT** defaults to the repo directory name
- **DOPPLER_CONFIG** defaults to `dev` (single) or sub-project name (multi)
- **ENV_FILE** defaults to `.env.local` for Node/Next.js or `.env` for Python, scoped to sub-project path in multi-config
- **PROJECT_TYPE** auto-detected from `package.json` / `pyproject.toml`
- **Multi-config** auto-detected from workspaces, monorepo directories, or existing env files

## Troubleshooting

### `CONF_FILE: unbound variable` or similar

Your `.matrx-tools.conf` has corrupted values. This happens when the installer ran via `curl | bash` and the terminal prompts couldn't read input properly.

**Fix:** Delete `.matrx-tools.conf` and re-run the installer:

```bash
rm .matrx-tools.conf
curl -sL https://raw.githubusercontent.com/armanisadeghi/matrx-dev-tools/main/install.sh | bash
```

### `Doppler CLI not found`

Re-run the installer — it will auto-install Doppler for you:

```bash
pnpm tools:update    # or: curl -sL ... | bash
```

If automatic install fails (permissions, unsupported OS), install manually: https://docs.doppler.com/docs/install-cli

### `Doppler CLI is not authenticated`

Run `doppler login` to authenticate. This is a one-time setup per machine. The installer will offer to do this for you if you run it again.

## Matrx Ship — Version Tracking

This repo uses [matrx-ship](https://github.com/armanisadeghi/matrx-ship) for deployment and version tracking. Since this is a bash project (no `package.json`), all ship commands use the bash wrapper.

### Install (already done for this repo)

```bash
curl -sL https://raw.githubusercontent.com/armanisadeghi/matrx-ship/main/cli/install.sh | bash
```

### Commands

| Command | What it does |
|---|---|
| `bash scripts/matrx/ship.sh "message"` | Ship a patch version (commit + push + track) |
| `bash scripts/matrx/ship.sh --minor "message"` | Ship a minor version |
| `bash scripts/matrx/ship.sh --major "message"` | Ship a major version |
| `bash scripts/matrx/ship.sh status` | Show current version from server |
| `bash scripts/matrx/ship.sh history` | Import full git history into dashboard |
| `bash scripts/matrx/ship.sh history --dry` | Preview what would be imported |
| `bash scripts/matrx/ship.sh update` | Update the ship CLI to latest |
| `bash scripts/matrx/ship.sh help` | Show all options |

### Admin Dashboard

https://matrx-dev-tools.dev.codematrx.com/admin

### Note for Node projects

In projects with `package.json`, the installer registers `pnpm ship:*` scripts instead. For example, `pnpm ship "message"`, `pnpm ship:minor "message"`, `pnpm ship:history`, etc.

## Adding New Tools

1. Create `tools/my-tool.sh` in this repo
2. Source `lib/colors.sh` and `lib/utils.sh` for shared helpers
3. Add config keys to `templates/matrx-tools.conf.example`
4. Add the tool name to `TOOLS_ENABLED` in consuming projects
5. Run `tools:update` / `tools-update` to pick it up

## Requirements

- bash 3.2+ (macOS default works)
- git
- [Doppler CLI](https://docs.doppler.com/docs/install-cli) (for env-sync) — **auto-installed** by the installer
- node (for Node projects — used to patch package.json)
- sudo access (only needed if Doppler CLI needs to be installed via apt/rpm)
