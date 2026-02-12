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
    for lib_file in lib/colors.sh lib/utils.sh; do
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

# ─── Step 3: Migrate config files ───────────────────────────────────────────

header "Step 3 — Config migration"

CONFIG_MIGRATED=false

if [[ "$HAS_MATRX_JSON" == true ]]; then
    skip ".matrx.json already exists — no migration needed"
elif [[ "$HAS_LEGACY_SHIP_JSON" == true ]] || [[ "$HAS_LEGACY_TOOLS_CONF" == true ]]; then
    # We have legacy config(s) to migrate
    SHIP_URL=""
    SHIP_KEY=""
    DOPPLER_PROJECT=""
    DOPPLER_CONFIG=""
    ENV_FILE=""
    DOPPLER_MULTI=""
    LOCAL_KEYS=""

    # Read from .matrx-ship.json
    if [[ "$HAS_LEGACY_SHIP_JSON" == true ]] && command -v node &>/dev/null; then
        SHIP_URL=$(node -e "const c=require('./.matrx-ship.json'); console.log(c.url||'')" 2>/dev/null || echo "")
        SHIP_KEY=$(node -e "const c=require('./.matrx-ship.json'); console.log(c.apiKey||'')" 2>/dev/null || echo "")
    fi

    # Read from .matrx-tools.conf
    if [[ "$HAS_LEGACY_TOOLS_CONF" == true ]]; then
        source .matrx-tools.conf 2>/dev/null || true
        DOPPLER_PROJECT="${DOPPLER_PROJECT:-}"
        DOPPLER_CONFIG="${DOPPLER_CONFIG:-}"
        ENV_FILE="${ENV_FILE:-}"
        DOPPLER_MULTI="${DOPPLER_MULTI:-}"
        LOCAL_KEYS="${ENV_LOCAL_KEYS:-}"
    fi

    # Build .matrx.json
    if command -v node &>/dev/null; then
        node -e "
            const fs = require('fs');
            const config = {};

            // Ship section
            const url = '${SHIP_URL}';
            const key = '${SHIP_KEY}';
            if (url || key) {
                config.ship = {};
                if (url) config.ship.url = url;
                if (key) config.ship.apiKey = key;
            }

            // Env section
            const dopplerProject = '${DOPPLER_PROJECT}';
            const dopplerConfig = '${DOPPLER_CONFIG}';
            const envFile = '${ENV_FILE}';
            const multi = '${DOPPLER_MULTI}';
            const localKeys = '${LOCAL_KEYS}'.split(',').filter(Boolean);

            if (dopplerProject || dopplerConfig || envFile) {
                config.env = {};

                if (multi === 'true') {
                    config.env.multi = true;
                    // Multi-config needs more complex parsing — leave a note
                    config.env._note = 'Multi-config was detected. Please verify configs section manually.';
                } else {
                    if (dopplerProject || dopplerConfig) {
                        config.env.doppler = {};
                        if (dopplerProject) config.env.doppler.project = dopplerProject;
                        if (dopplerConfig) config.env.doppler.config = dopplerConfig;
                    }
                    if (envFile) config.env.file = envFile;
                }

                if (localKeys.length > 0) {
                    config.env.localKeys = localKeys;
                }
            }

            if (Object.keys(config).length > 0) {
                fs.writeFileSync('.matrx.json', JSON.stringify(config, null, 2) + '\n');
            }
        " 2>/dev/null

        if [[ -f ".matrx.json" ]]; then
            changed "Migrated config to .matrx.json"
            CONFIG_MIGRATED=true

            if [[ "$HAS_LEGACY_SHIP_JSON" == true ]]; then
                info "Legacy .matrx-ship.json preserved (still works as fallback)"
            fi
            if [[ "$HAS_LEGACY_TOOLS_CONF" == true ]]; then
                info "Legacy .matrx-tools.conf preserved (still works as fallback)"
            fi
        else
            skip "No config values to migrate"
        fi
    else
        warn "Node.js not available — cannot migrate config to .matrx.json"
        info "Legacy config files still work fine. Migrate later with: pnpm tools:migrate"
    fi
else
    skip "No config files to migrate"
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
    has_tsx=$(node -e "const p=require('./package.json'); console.log(p.devDependencies?.tsx || p.dependencies?.tsx || '')" 2>/dev/null || echo "")
    if [[ -z "$has_tsx" ]] && [[ "$HAS_SHIP" == true ]]; then
        json_set "package.json" "devDependencies.tsx" "\"^4.21.0\"" && {
            changed "Added tsx to devDependencies (run pnpm install)"
            PKG_UPDATED=true
        }
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

if [[ ${#CHANGES[@]} -gt 0 ]]; then
    echo -e "${BOLD}${GREEN}  ✅ Migration complete — ${#CHANGES[@]} change(s)${NC}"
else
    echo -e "${BOLD}${GREEN}  ✅ Everything is already up to date!${NC}"
fi

if [[ ${#WARNINGS[@]} -gt 0 ]]; then
    echo -e "\n  ${YELLOW}Warnings:${NC}"
    for w in "${WARNINGS[@]}"; do
        echo -e "    ${YELLOW}!${NC} $w"
    done
fi

echo -e "${BOLD}${CYAN}──────────────────────────────────────────${NC}"

# Show next steps if there were changes
if [[ ${#CHANGES[@]} -gt 0 ]]; then
    echo ""
    echo -e "  ${BOLD}Next steps:${NC}"

    if [[ "$IS_NODE" == true ]]; then
        if [[ "$UPDATED_ANY_FILE" == true ]] || [[ "$PKG_UPDATED" == true ]]; then
            echo -e "    1. Run ${CYAN}pnpm install${NC} (if tsx was added)"
        fi
        echo -e "    2. Test: ${CYAN}pnpm ship status${NC}"
        if [[ "$HAS_ENV" == true ]]; then
            echo -e "    3. Test: ${CYAN}pnpm env:status${NC}"
        fi
    elif [[ "$IS_PYTHON" == true ]]; then
        echo -e "    1. Test: ${CYAN}bash scripts/matrx/ship.sh status${NC}"
        if [[ "$HAS_ENV" == true ]]; then
            echo -e "    2. Test: ${CYAN}make env-status${NC}"
        fi
    fi

    if [[ "$CONFIG_MIGRATED" == true ]]; then
        echo -e "    · Review ${CYAN}.matrx.json${NC} to verify migrated config"
    fi
    echo ""
fi
