#!/usr/bin/env bash
# =============================================================================
# Matrx CLI Migration / Update Tool
#
# Brings any project up to date with the consolidated matrx-ship CLI.
# Handles migration from:
#   - Old matrx-dev-tools installs (tools:update → matrx-dev-tools)
#   - Old matrx-ship-only installs (ship.ts without lib/ or env-sync)
#   - Partially updated installs (some new, some old files)
#
# What it does:
#   1. Detects what's currently installed (scripts, configs, package.json)
#   2. Re-downloads all CLI files from matrx-ship/main/cli/
#   3. Migrates config files to .matrx.json (preserving values)
#   4. Updates package.json scripts / Makefile targets
#   5. Fixes tools:update URL to point to matrx-ship
#   6. Cleans up stale files
#   7. Shows a clear summary of what changed
#
# Usage:
#   curl -sL https://raw.githubusercontent.com/armanisadeghi/matrx-ship/main/cli/migrate.sh | bash
#   # or from a project that already has tools installed:
#   pnpm tools:migrate
#   make tools-migrate
#
# Safe to run multiple times — idempotent.
# =============================================================================

set -uo pipefail

REPO_RAW="https://raw.githubusercontent.com/armanisadeghi/matrx-ship/main"
INSTALL_DIR="scripts/matrx"

# ─── Colors ──────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

# ─── State tracking ─────────────────────────────────────────────────────────

CHANGES=()
WARNINGS=()
SKIPPED=()

changed() { CHANGES+=("$1"); echo -e "  ${GREEN}✓${NC} $1"; }
warn()    { WARNINGS+=("$1"); echo -e "  ${YELLOW}!${NC} $1"; }
skip()    { SKIPPED+=("$1"); echo -e "  ${DIM}· $1${NC}"; }
info()    { echo -e "  ${DIM}$1${NC}"; }
header()  { echo -e "\n${BOLD}${BLUE}$1${NC}"; }

# ─── Helpers ─────────────────────────────────────────────────────────────────

# Unified function to ensure tsx is in devDependencies for npm projects
ensure_tsx_dependency() {
    if [[ ! -f "package.json" ]]; then
        return 0  # Not a Node project, skip
    fi

    local has_tsx
    has_tsx=$(node -e "const p=require('./package.json'); console.log(p.devDependencies?.tsx || p.dependencies?.tsx || '')" 2>/dev/null || echo "")
    
    if [[ -n "$has_tsx" ]]; then
        return 0  # Already installed
    fi

    # tsx is missing — add it to package.json and install
    changed "Adding tsx to devDependencies (required for ship CLI)"
    
    # Add to package.json using node
    if command -v node &>/dev/null; then
        node -e "
            const fs = require('fs');
            const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
            if (!pkg.devDependencies) pkg.devDependencies = {};
            if (!pkg.devDependencies.tsx) {
                pkg.devDependencies.tsx = '^4.21.0';
                fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
            }
        " 2>/dev/null
    fi
    
    # Detect package manager and install
    if [[ -f "pnpm-lock.yaml" ]] || [[ -f "pnpm-workspace.yaml" ]]; then
        if pnpm install 2>/dev/null; then
            changed "tsx installed via pnpm"
        else
            warn "Failed to install tsx. Run: pnpm install"
        fi
    elif [[ -f "yarn.lock" ]]; then
        if yarn install 2>/dev/null; then
            changed "tsx installed via yarn"
        else
            warn "Failed to install tsx. Run: yarn install"
        fi
    elif [[ -f "bun.lockb" ]] || [[ -f "bun.lock" ]]; then
        if bun install 2>/dev/null; then
            changed "tsx installed via bun"
        else
            warn "Failed to install tsx. Run: bun install"
        fi
    else
        if npm install 2>/dev/null; then
            changed "tsx installed via npm"
        else
            warn "Failed to install tsx. Run: npm install"
        fi
    fi
}

download_file() {
    local url="$1"
    local dest="$2"
    local label="$3"

    local dir
    dir=$(dirname "$dest")
    mkdir -p "$dir"

    if curl -fsSL --connect-timeout 10 --max-time 30 "$url" -o "$dest" 2>/dev/null; then
        changed "Downloaded $label"
        return 0
    else
        warn "Failed to download $label"
        return 1
    fi
}

file_differs() {
    local url="$1"
    local local_file="$2"

    if [[ ! -f "$local_file" ]]; then
        return 0  # doesn't exist = differs
    fi

    local remote_content
    remote_content=$(curl -fsSL --connect-timeout 10 --max-time 30 "$url" 2>/dev/null) || return 0

    local local_content
    local_content=$(cat "$local_file")

    [[ "$remote_content" != "$local_content" ]]
}

json_set() {
    # Set a key in a JSON file using node (available in Node projects)
    local file="$1"
    local key_path="$2"
    local value="$3"

    if command -v node &>/dev/null; then
        node -e "
            const fs = require('fs');
            const data = JSON.parse(fs.readFileSync('$file', 'utf-8'));
            const keys = '$key_path'.split('.');
            let obj = data;
            for (let i = 0; i < keys.length - 1; i++) {
                if (!obj[keys[i]]) obj[keys[i]] = {};
                obj = obj[keys[i]];
            }
            obj[keys[keys.length - 1]] = $value;
            fs.writeFileSync('$file', JSON.stringify(data, null, 2) + '\n');
        " 2>/dev/null
        return $?
    fi
    return 1
}

# ─── Find project root ──────────────────────────────────────────────────────

find_project_root() {
    local dir
    dir=$(pwd)
    while [[ "$dir" != "/" ]]; do
        if [[ -d "$dir/.git" ]]; then
            echo "$dir"
            return 0
        fi
        dir=$(dirname "$dir")
    done
    # Fall back to cwd
    echo "$(pwd)"
}

# ═════════════════════════════════════════════════════════════════════════════
# MAIN
# ═════════════════════════════════════════════════════════════════════════════

echo ""
echo -e "${BOLD}${CYAN}╭──────────────────────────────────────────╮${NC}"
echo -e "${BOLD}${CYAN}│     Matrx CLI Migration / Update Tool    │${NC}"
echo -e "${BOLD}${CYAN}╰──────────────────────────────────────────╯${NC}"
echo ""

PROJECT_ROOT=$(find_project_root)
export PROJECT_ROOT

# Download and run the environment checker
CHECK_URL="${REPO_RAW}/cli/lib/check-environment.sh"

CHECK_TMP=$(mktemp)
if curl -fsSL "$CHECK_URL" -o "$CHECK_TMP" 2>/dev/null; then
    chmod +x "$CHECK_TMP"
    # Run in subshell
    ( PROJECT_ROOT="$PROJECT_ROOT" source "$CHECK_TMP" && check_environment_all )
    rm -f "$CHECK_TMP"
else
   echo -e "  ${YELLOW}!${NC} Could not fetch environment checker. Proceeding..."
fi
cd "$PROJECT_ROOT" || { echo "Failed to cd to project root"; exit 1; }
echo -e "  Project: ${BOLD}$(basename "$PROJECT_ROOT")${NC} ($PROJECT_ROOT)"

# ─── Step 1: Detect current state ───────────────────────────────────────────

header "Step 1 — Detecting current state"

IS_NODE=false
IS_PYTHON=false
HAS_SHIP=false
HAS_ENV=false
HAS_LIB=false
HAS_LEGACY_DEV_TOOLS_URL=false
HAS_LEGACY_SHIP_JSON=false
HAS_LEGACY_TOOLS_CONF=false
HAS_MATRX_JSON=false
IS_MATRX_SHIP_REPO=false

# Project type
if [[ -f "package.json" ]]; then
    IS_NODE=true
    info "Project type: Node.js"
else
    info "Project type: Not Node.js"
fi
if [[ -f "pyproject.toml" ]] || [[ -f "setup.py" ]] || [[ -f "requirements.txt" ]]; then
    IS_PYTHON=true
    info "Project type: Python"
fi

# Check if this IS the matrx-ship repo itself
if [[ -f "package.json" ]]; then
    local_name=$(node -e "console.log(require('./package.json').name || '')" 2>/dev/null || echo "")
    if [[ "$local_name" == "matrx-ship" ]]; then
        IS_MATRX_SHIP_REPO=true
        info "This is the matrx-ship repo — special handling applies"
    fi
fi

# Installed scripts
if [[ -f "$INSTALL_DIR/ship.ts" ]]; then
    HAS_SHIP=true
    info "Found: $INSTALL_DIR/ship.ts"
fi
if [[ -f "$INSTALL_DIR/env-sync.sh" ]]; then
    HAS_ENV=true
    info "Found: $INSTALL_DIR/env-sync.sh"
fi
if [[ -f "$INSTALL_DIR/lib/colors.sh" ]] && [[ -f "$INSTALL_DIR/lib/utils.sh" ]]; then
    HAS_LIB=true
    info "Found: $INSTALL_DIR/lib/"
fi

# Config files
if [[ -f ".matrx.json" ]]; then
    HAS_MATRX_JSON=true
    info "Found: .matrx.json (unified config)"
fi
if [[ -f ".matrx-ship.json" ]]; then
    HAS_LEGACY_SHIP_JSON=true
    info "Found: .matrx-ship.json (legacy ship config)"
fi
if [[ -f ".matrx-tools.conf" ]]; then
    HAS_LEGACY_TOOLS_CONF=true
    info "Found: .matrx-tools.conf (legacy env-sync config)"
fi

# Check tools:update URL
if [[ "$IS_NODE" == true ]]; then
    current_update=$(node -e "const p=require('./package.json'); console.log(p.scripts?.['tools:update']||'')" 2>/dev/null || echo "")
    if [[ "$current_update" == *"matrx-dev-tools"* ]]; then
        HAS_LEGACY_DEV_TOOLS_URL=true
        info "Found: tools:update still points to matrx-dev-tools"
    fi
fi

# Nothing installed at all?
if [[ "$HAS_SHIP" == false ]] && [[ "$HAS_ENV" == false ]] && [[ "$IS_MATRX_SHIP_REPO" == false ]]; then
    echo ""
    echo -e "  ${YELLOW}No Matrx CLI tools found in this project.${NC}"
    echo -e "  To install from scratch, run:"
    echo -e "  ${CYAN}curl -sL ${REPO_RAW}/cli/install.sh | bash${NC}"
    echo ""
    exit 0
fi

# ─── Step 2: Update script files ────────────────────────────────────────────

header "Step 2 — Updating CLI scripts"

UPDATED_ANY_FILE=false

# Always update lib/ (shared by both ship and env-sync)
if [[ "$HAS_SHIP" == true ]] || [[ "$HAS_ENV" == true ]]; then
    for lib_file in lib/colors.sh lib/utils.sh lib/check-environment.sh; do
        if file_differs "${REPO_RAW}/cli/${lib_file}" "${INSTALL_DIR}/${lib_file}"; then
            download_file "${REPO_RAW}/cli/${lib_file}" "${INSTALL_DIR}/${lib_file}" "${lib_file}"
            UPDATED_ANY_FILE=true
        else
            skip "${lib_file} already up to date"
        fi
    done
fi

# Update ship.ts
if [[ "$HAS_SHIP" == true ]]; then
    if file_differs "${REPO_RAW}/cli/ship.ts" "${INSTALL_DIR}/ship.ts"; then
        download_file "${REPO_RAW}/cli/ship.ts" "${INSTALL_DIR}/ship.ts" "ship.ts"
        UPDATED_ANY_FILE=true
    else
        skip "ship.ts already up to date"
    fi

    # Update ship.sh for non-Node projects
    if [[ "$IS_NODE" == false ]]; then
        if file_differs "${REPO_RAW}/cli/ship.sh" "${INSTALL_DIR}/ship.sh"; then
            download_file "${REPO_RAW}/cli/ship.sh" "${INSTALL_DIR}/ship.sh" "ship.sh"
            chmod +x "${INSTALL_DIR}/ship.sh" 2>/dev/null || true
            UPDATED_ANY_FILE=true
        else
            skip "ship.sh already up to date"
        fi
    fi
fi

# Update env-sync.sh
if [[ "$HAS_ENV" == true ]]; then
    if file_differs "${REPO_RAW}/cli/env-sync.sh" "${INSTALL_DIR}/env-sync.sh"; then
        download_file "${REPO_RAW}/cli/env-sync.sh" "${INSTALL_DIR}/env-sync.sh" "env-sync.sh"
        chmod +x "${INSTALL_DIR}/env-sync.sh" 2>/dev/null || true
        UPDATED_ANY_FILE=true
    else
        skip "env-sync.sh already up to date"
    fi
fi

# ─── Step 3: Config migration & validation ──────────────────────────────────

header "Step 3 — Config migration & validation"

CONFIG_MIGRATED=false

# ── Helper: extract a value from a .env file ──
read_env_var() {
    local file="$1"
    local key="$2"
    if [[ ! -f "$file" ]]; then return; fi
    local val
    val=$(grep -E "^${key}=" "$file" 2>/dev/null | head -1 | sed 's/^[^=]*=//' | sed 's/^"//;s/"$//' | sed "s/^'//;s/'$//")
    echo "$val"
}

# Collect config values from ALL sources (in priority order)
MIG_SHIP_URL=""
MIG_SHIP_KEY=""
MIG_DOPPLER_PROJECT=""
MIG_DOPPLER_CONFIG=""
MIG_ENV_FILE=""
MIG_DOPPLER_MULTI=""
MIG_LOCAL_KEYS=""

# Source 1: Existing .matrx.json
if [[ "$HAS_MATRX_JSON" == true ]] && command -v node &>/dev/null; then
    MIG_SHIP_URL=$(node -e "try{const c=JSON.parse(require('fs').readFileSync('.matrx.json','utf8'));console.log(c.ship?.url||'')}catch{console.log('')}" 2>/dev/null)
    MIG_SHIP_KEY=$(node -e "try{const c=JSON.parse(require('fs').readFileSync('.matrx.json','utf8'));console.log(c.ship?.apiKey||'')}catch{console.log('')}" 2>/dev/null)
    MIG_DOPPLER_PROJECT=$(node -e "try{const c=JSON.parse(require('fs').readFileSync('.matrx.json','utf8'));console.log(c.env?.doppler?.project||'')}catch{console.log('')}" 2>/dev/null)
    MIG_DOPPLER_CONFIG=$(node -e "try{const c=JSON.parse(require('fs').readFileSync('.matrx.json','utf8'));console.log(c.env?.doppler?.config||'')}catch{console.log('')}" 2>/dev/null)
    MIG_ENV_FILE=$(node -e "try{const c=JSON.parse(require('fs').readFileSync('.matrx.json','utf8'));console.log(c.env?.file||'')}catch{console.log('')}" 2>/dev/null)
fi

# Source 2: Legacy .matrx-ship.json
if [[ "$HAS_LEGACY_SHIP_JSON" == true ]] && command -v node &>/dev/null; then
    [[ -z "$MIG_SHIP_URL" ]] && MIG_SHIP_URL=$(node -e "const c=require('./.matrx-ship.json'); console.log(c.url||'')" 2>/dev/null || echo "")
    [[ -z "$MIG_SHIP_KEY" ]] && MIG_SHIP_KEY=$(node -e "const c=require('./.matrx-ship.json'); console.log(c.apiKey||'')" 2>/dev/null || echo "")
fi

# Source 3: Legacy .matrx-tools.conf
if [[ "$HAS_LEGACY_TOOLS_CONF" == true ]]; then
    source .matrx-tools.conf 2>/dev/null || true
    [[ -z "$MIG_DOPPLER_PROJECT" ]] && MIG_DOPPLER_PROJECT="${DOPPLER_PROJECT:-}"
    [[ -z "$MIG_DOPPLER_CONFIG" ]] && MIG_DOPPLER_CONFIG="${DOPPLER_CONFIG:-}"
    [[ -z "$MIG_ENV_FILE" ]] && MIG_ENV_FILE="${ENV_FILE:-}"
    MIG_DOPPLER_MULTI="${DOPPLER_MULTI:-}"
    MIG_LOCAL_KEYS="${ENV_LOCAL_KEYS:-}"
fi

# Source 4: Process environment variables
[[ -z "$MIG_SHIP_URL" ]] && MIG_SHIP_URL="${MATRX_SHIP_URL:-}"
[[ -z "$MIG_SHIP_KEY" ]] && MIG_SHIP_KEY="${MATRX_SHIP_API_KEY:-}"

# Source 5: .env files
for _env_file in .env.local .env .env.development; do
    if [[ -f "$_env_file" ]]; then
        [[ -z "$MIG_SHIP_URL" ]] && MIG_SHIP_URL=$(read_env_var "$_env_file" "MATRX_SHIP_URL")
        [[ -z "$MIG_SHIP_KEY" ]] && MIG_SHIP_KEY=$(read_env_var "$_env_file" "MATRX_SHIP_API_KEY")
    fi
    [[ -n "$MIG_SHIP_URL" ]] && [[ -n "$MIG_SHIP_KEY" ]] && break
done

# Now build/update .matrx.json with all collected values
if command -v node &>/dev/null; then
    node -e "
        const fs = require('fs');

        // Start with existing config if available
        let config = {};
        try { config = JSON.parse(fs.readFileSync('.matrx.json', 'utf-8')); } catch {}

        // Ship section — always write both fields if either is present
        const url = '${MIG_SHIP_URL}';
        const key = '${MIG_SHIP_KEY}';
        if (url || key) {
            config.ship = { url: url || '', apiKey: key || '' };
        }

        // Env section
        const dopplerProject = '${MIG_DOPPLER_PROJECT}';
        const dopplerConfig = '${MIG_DOPPLER_CONFIG}';
        const envFile = '${MIG_ENV_FILE}';
        const multi = '${MIG_DOPPLER_MULTI}';
        const localKeys = '${MIG_LOCAL_KEYS}'.split(',').filter(Boolean);

        if (dopplerProject || dopplerConfig || envFile) {
            if (!config.env) config.env = {};

            if (multi === 'true') {
                config.env.multi = true;
                config.env._note = 'Multi-config was detected. Please verify configs section manually.';
            } else {
                config.env.doppler = {
                    project: dopplerProject || config.env?.doppler?.project || '',
                    config: dopplerConfig || config.env?.doppler?.config || 'dev'
                };
                config.env.file = envFile || config.env?.file || '.env';
            }

            if (localKeys.length > 0) {
                config.env.localKeys = localKeys;
            }
        }

        fs.writeFileSync('.matrx.json', JSON.stringify(config, null, 2) + '\n');
    " 2>/dev/null

    if [[ -f ".matrx.json" ]]; then
        if [[ "$HAS_MATRX_JSON" == true ]]; then
            changed "Validated and updated .matrx.json"
        else
            changed "Created .matrx.json from collected config values"
        fi
        CONFIG_MIGRATED=true

        # Remove legacy config files — their values are now in .matrx.json
        if [[ "$HAS_LEGACY_SHIP_JSON" == true ]]; then
            rm -f ".matrx-ship.json"
            changed "Removed .matrx-ship.json (migrated into .matrx.json)"
        fi
        if [[ "$HAS_LEGACY_TOOLS_CONF" == true ]]; then
            rm -f ".matrx-tools.conf"
            changed "Removed .matrx-tools.conf (migrated into .matrx.json)"
        fi
    fi
else
    warn "Node.js not available — cannot migrate/validate config"
    info "Legacy config files still work fine. Migrate later with: pnpm tools:migrate"
fi

# ── Validate the final config ──
SHIP_VALID=false
ENV_VALID=false

if [[ -n "$MIG_SHIP_URL" ]] && [[ -n "$MIG_SHIP_KEY" ]] && \
   [[ "$MIG_SHIP_URL" != *"yourdomain"* ]] && [[ "$MIG_SHIP_URL" != *"YOUR"* ]] && \
   [[ "$MIG_SHIP_KEY" != *"YOUR"* ]] && [[ "$MIG_SHIP_KEY" != *"xxx"* ]]; then
    SHIP_VALID=true
    skip "Ship config: ✓ ${MIG_SHIP_URL}"
elif [[ "$HAS_SHIP" == true ]]; then
    warn "Ship config is incomplete — 'pnpm ship' will not work"
    if [[ -z "$MIG_SHIP_URL" ]] && [[ -z "$MIG_SHIP_KEY" ]]; then
        info "Both URL and API key are missing"
    elif [[ -z "$MIG_SHIP_URL" ]]; then
        info "Ship URL is missing"
    else
        info "Ship API key is missing"
    fi
    info "Fix: Add MATRX_SHIP_URL and MATRX_SHIP_API_KEY to your .env.local"
    info "  or: pnpm ship:init my-project \"My Project\""
fi

if [[ -n "$MIG_DOPPLER_PROJECT" ]]; then
    ENV_VALID=true
    skip "Env-sync config: ✓ ${MIG_DOPPLER_PROJECT}/${MIG_DOPPLER_CONFIG:-dev}"
elif [[ "$HAS_ENV" == true ]]; then
    warn "Env-sync config is incomplete — 'pnpm env:pull' will not work"
    info "Fix: Re-run the installer: curl -sL ${REPO_RAW}/cli/install.sh | bash"
fi

# ─── Step 4: Update package.json / Makefile ──────────────────────────────────

header "Step 4 — Updating registered commands"

PKG_UPDATED=false

if [[ "$IS_NODE" == true ]] && [[ "$IS_MATRX_SHIP_REPO" == false ]]; then

    # Fix tools:update URL
    if [[ "$HAS_LEGACY_DEV_TOOLS_URL" == true ]]; then
        json_set "package.json" "scripts.tools:update" "\"curl -sL ${REPO_RAW}/cli/install.sh | bash\"" && {
            changed "Updated tools:update URL → matrx-ship"
            PKG_UPDATED=true
        }
    fi

    # Add tools:migrate command
    current_migrate=$(node -e "const p=require('./package.json'); console.log(p.scripts?.['tools:migrate']||'')" 2>/dev/null || echo "")
    if [[ -z "$current_migrate" ]]; then
        json_set "package.json" "scripts.tools:migrate" "\"curl -sL ${REPO_RAW}/cli/migrate.sh | bash\"" && {
            changed "Added tools:migrate script"
            PKG_UPDATED=true
        }
    else
        skip "tools:migrate already registered"
    fi

    # Ensure all ship:* scripts are registered (if ship is installed)
    if [[ "$HAS_SHIP" == true ]]; then
        local_ship_cmd=$(node -e "const p=require('./package.json'); console.log(p.scripts?.ship||'')" 2>/dev/null || echo "")
        if [[ -z "$local_ship_cmd" ]]; then
            # Ship scripts not registered at all — add them
            node -e "
                const fs = require('fs');
                const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
                if (!pkg.scripts) pkg.scripts = {};
                const cmds = {
                    'ship': 'tsx scripts/matrx/ship.ts',
                    'ship:minor': 'tsx scripts/matrx/ship.ts --minor',
                    'ship:major': 'tsx scripts/matrx/ship.ts --major',
                    'ship:init': 'tsx scripts/matrx/ship.ts init',
                    'ship:setup': 'tsx scripts/matrx/ship.ts setup',
                    'ship:history': 'tsx scripts/matrx/ship.ts history',
                    'ship:update': 'tsx scripts/matrx/ship.ts update',
                    'ship:force-remove': 'tsx scripts/matrx/ship.ts force-remove',
                };
                let added = false;
                for (const [k, v] of Object.entries(cmds)) {
                    if (!pkg.scripts[k]) { pkg.scripts[k] = v; added = true; }
                }
                if (added) {
                    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
                    process.stdout.write('ADDED');
                } else {
                    process.stdout.write('OK');
                }
            " 2>/dev/null
            if [[ $? -eq 0 ]]; then
                changed "Registered ship:* scripts in package.json"
                PKG_UPDATED=true
            fi
        else
            skip "ship:* scripts already registered"
        fi

        # Ensure ship:force-remove exists (it's newer and might be missing)
        has_force_remove=$(node -e "const p=require('./package.json'); console.log(p.scripts?.['ship:force-remove']||'')" 2>/dev/null || echo "")
        if [[ -z "$has_force_remove" ]]; then
            json_set "package.json" "scripts.ship:force-remove" "\"tsx scripts/matrx/ship.ts force-remove\"" && {
                changed "Added missing ship:force-remove script"
                PKG_UPDATED=true
            }
        fi
    fi

    # Ensure all env:* scripts are registered (if env-sync is installed)
    if [[ "$HAS_ENV" == true ]]; then
        local_env_cmd=$(node -e "const p=require('./package.json'); console.log(p.scripts?.['env:pull']||'')" 2>/dev/null || echo "")
        if [[ -z "$local_env_cmd" ]]; then
            node -e "
                const fs = require('fs');
                const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
                if (!pkg.scripts) pkg.scripts = {};
                const cmds = {
                    'env:pull': 'bash scripts/matrx/env-sync.sh pull',
                    'env:push': 'bash scripts/matrx/env-sync.sh push',
                    'env:diff': 'bash scripts/matrx/env-sync.sh diff',
                    'env:status': 'bash scripts/matrx/env-sync.sh status',
                    'env:sync': 'bash scripts/matrx/env-sync.sh sync',
                    'env:pull:force': 'bash scripts/matrx/env-sync.sh pull --force',
                    'env:push:force': 'bash scripts/matrx/env-sync.sh push --force',
                };
                let added = false;
                for (const [k, v] of Object.entries(cmds)) {
                    if (!pkg.scripts[k]) { pkg.scripts[k] = v; added = true; }
                }
                if (added) {
                    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
                    process.stdout.write('ADDED');
                } else {
                    process.stdout.write('OK');
                }
            " 2>/dev/null
            if [[ $? -eq 0 ]]; then
                changed "Registered env:* scripts in package.json"
                PKG_UPDATED=true
            fi
        else
            skip "env:* scripts already registered"
        fi
    fi

    # Ensure tsx is a devDependency
    if [[ "$HAS_SHIP" == true ]]; then
        ensure_tsx_dependency
        PKG_UPDATED=true
    fi

    if [[ "$PKG_UPDATED" == false ]]; then
        skip "package.json already up to date"
    fi

elif [[ "$IS_PYTHON" == true ]] && [[ -f "Makefile" ]]; then
    # Check if Makefile has the env targets
    if [[ "$HAS_ENV" == true ]] && ! grep -q "env-pull:" Makefile 2>/dev/null; then
        cat >> Makefile << 'MAKE_EOF'

# ─── Matrx env-sync ──────────────────────────────────────────────────
env-pull:
	@bash scripts/matrx/env-sync.sh pull

env-push:
	@bash scripts/matrx/env-sync.sh push

env-diff:
	@bash scripts/matrx/env-sync.sh diff

env-status:
	@bash scripts/matrx/env-sync.sh status

env-sync:
	@bash scripts/matrx/env-sync.sh sync

env-pull-force:
	@bash scripts/matrx/env-sync.sh pull --force

env-push-force:
	@bash scripts/matrx/env-sync.sh push --force

tools-update:
	@curl -sL https://raw.githubusercontent.com/armanisadeghi/matrx-ship/main/cli/install.sh | bash

tools-migrate:
	@curl -sL https://raw.githubusercontent.com/armanisadeghi/matrx-ship/main/cli/migrate.sh | bash
MAKE_EOF
        changed "Added env/tools targets to Makefile"
    else
        skip "Makefile targets already up to date"
    fi
elif [[ "$IS_MATRX_SHIP_REPO" == true ]]; then
    skip "matrx-ship repo — uses cli/ directly, no script path changes needed"
else
    skip "No package.json or Makefile — commands run via bash directly"
fi

# ─── Step 5: Update .gitignore ───────────────────────────────────────────────

header "Step 5 — Updating .gitignore"

GITIGNORE_UPDATED=false
GITIGNORE_ENTRIES=(
    ".matrx.json"
    ".matrx-ship.json"
    ".matrx-tools.conf"
    ".env-backups/"
    ".env"
    ".env.local"
)

if [[ ! -f ".gitignore" ]]; then
    printf '%s\n' "${GITIGNORE_ENTRIES[@]}" > .gitignore
    changed "Created .gitignore with Matrx entries"
    GITIGNORE_UPDATED=true
else
    for entry in "${GITIGNORE_ENTRIES[@]}"; do
        if ! grep -qxF "$entry" .gitignore 2>/dev/null; then
            echo "$entry" >> .gitignore
            GITIGNORE_UPDATED=true
        fi
    done
    if [[ "$GITIGNORE_UPDATED" == true ]]; then
        changed "Added missing entries to .gitignore"
    else
        skip ".gitignore already up to date"
    fi
fi

# ─── Step 6: Cleanup stale files ────────────────────────────────────────────

header "Step 6 — Cleanup"

CLEANED=false

# Remove old ship.sh from Node projects (only needed for Python/bash)
if [[ "$IS_NODE" == true ]] && [[ -f "$INSTALL_DIR/ship.sh" ]] && [[ "$IS_MATRX_SHIP_REPO" == false ]]; then
    rm -f "$INSTALL_DIR/ship.sh"
    changed "Removed ship.sh (not needed for Node projects — tsx runs ship.ts directly)"
    CLEANED=true
fi

# Check for stale files from very old installs
for stale_file in "$INSTALL_DIR/install.sh" "$INSTALL_DIR/migrate.sh"; do
    if [[ -f "$stale_file" ]]; then
        rm -f "$stale_file"
        changed "Removed stale $(basename "$stale_file") from scripts/matrx/"
        CLEANED=true
    fi
done

if [[ "$CLEANED" == false ]]; then
    skip "No stale files to clean up"
fi

# ═════════════════════════════════════════════════════════════════════════════
# Summary
# ═════════════════════════════════════════════════════════════════════════════

echo ""
echo -e "${BOLD}${CYAN}──────────────────────────────────────────${NC}"

if [[ ${#WARNINGS[@]} -gt 0 ]]; then
    echo -e "${BOLD}${YELLOW}  ⚠️  Migration complete — issues found${NC}"
else
    if [[ ${#CHANGES[@]} -gt 0 ]]; then
        echo -e "${BOLD}${GREEN}  ✅ Migration complete — ${#CHANGES[@]} change(s)${NC}"
    else
        echo -e "${BOLD}${GREEN}  ✅ Everything is already up to date!${NC}"
    fi
fi

# Readiness indicators
echo ""
if [[ "$HAS_SHIP" == true ]]; then
    if [[ "$SHIP_VALID" == true ]]; then
        echo -e "  ${GREEN}●${NC} Ship:     ${GREEN}Ready${NC}"
    else
        echo -e "  ${RED}●${NC} Ship:     ${RED}Not ready — config incomplete${NC}"
    fi
fi
if [[ "$HAS_ENV" == true ]]; then
    if [[ "$ENV_VALID" == true ]]; then
        echo -e "  ${GREEN}●${NC} Env-Sync: ${GREEN}Ready${NC}"
    else
        echo -e "  ${YELLOW}●${NC} Env-Sync: ${YELLOW}Not configured${NC}"
    fi
fi

if [[ ${#WARNINGS[@]} -gt 0 ]]; then
    echo -e "\n  ${YELLOW}Warnings:${NC}"
    for w in "${WARNINGS[@]}"; do
        echo -e "    ${YELLOW}!${NC} $w"
    done
fi

echo -e "${BOLD}${CYAN}──────────────────────────────────────────${NC}"

# Show next steps
echo ""
echo -e "  ${BOLD}Next steps:${NC}"

if [[ "$HAS_SHIP" == true ]] && [[ "$SHIP_VALID" == false ]]; then
    echo -e "    ${RED}→${NC} Fix ship config. Options:"
    echo -e "      a) Add to .env.local: MATRX_SHIP_URL=... and MATRX_SHIP_API_KEY=..."
    echo -e "      b) Run: ${CYAN}pnpm ship:init my-project \"My Project\"${NC}"
    echo -e "      c) Re-run: ${CYAN}curl -sL ${REPO_RAW}/cli/install.sh | bash${NC}"
fi

if [[ "$IS_NODE" == true ]]; then
    if [[ "$UPDATED_ANY_FILE" == true ]] || [[ "$PKG_UPDATED" == true ]]; then
        echo -e "    · Run ${CYAN}pnpm install${NC} (if tsx was added)"
    fi
    if [[ "$SHIP_VALID" == true ]]; then
        echo -e "    · Test: ${CYAN}pnpm ship status${NC}"
    fi
    if [[ "$HAS_ENV" == true ]] && [[ "$ENV_VALID" == true ]]; then
        echo -e "    · Test: ${CYAN}pnpm env:status${NC}"
    fi
elif [[ "$IS_PYTHON" == true ]]; then
    if [[ "$SHIP_VALID" == true ]]; then
        echo -e "    · Test: ${CYAN}bash scripts/matrx/ship.sh status${NC}"
    fi
    if [[ "$HAS_ENV" == true ]] && [[ "$ENV_VALID" == true ]]; then
        echo -e "    · Test: ${CYAN}make env-status${NC}"
    fi
fi

if [[ "$CONFIG_MIGRATED" == true ]]; then
    echo -e "    · Review ${CYAN}.matrx.json${NC} to verify migrated config"
fi
echo ""
