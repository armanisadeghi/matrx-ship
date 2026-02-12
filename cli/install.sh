#!/usr/bin/env bash
# =============================================================================
# Matrx CLI Installer — Unified Ship + Env-Sync setup
#
# Usage:
#   curl -sL https://raw.githubusercontent.com/armanisadeghi/matrx-ship/main/cli/install.sh | bash
#
# This script:
#   1. Downloads CLI files (ship.ts, env-sync.sh, ship.sh, lib/) into scripts/matrx/
#   2. Detects project type (Node/Python) and registers commands
#   3. Asks what to set up: Ship / Env-sync / Both (default: both)
#   4. Ship setup: server token + instance provisioning
#   5. Env-sync setup: Doppler project/config, installs Doppler CLI if needed
#   6. Writes unified .matrx.json config, updates .gitignore
#   7. Prints summary of what was configured
#
# Design principles:
#   - Idempotent: safe to run multiple times; detects what's already set up
#   - Smart detection: project type, monorepo structure, existing configs
#   - Graceful failures: never hard-exits on non-critical steps
#   - Clear error messages with "fix it later" instructions
#
# Compatible with bash 3.2+ (macOS default)
# Reads interactive input from /dev/tty so curl|bash piping works correctly.
# =============================================================================

# We do NOT use set -e globally — we handle errors explicitly per step.
set -uo pipefail

REPO_RAW="https://raw.githubusercontent.com/armanisadeghi/matrx-ship/main"
INSTALL_DIR="scripts/matrx"
DEFAULT_SERVER="https://mcp.dev.codematrx.com"
SERVER_CONFIG_FILE="$HOME/.config/matrx-ship/server.json"

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

WARNINGS=()
ERRORS=()
IS_NODE=false
IS_PYTHON=false
SETUP_SHIP=false
SETUP_ENV=false
HAS_JQ=false

warn() { WARNINGS+=("$1"); echo -e "  ${YELLOW}!${NC} $1"; }
fail() { ERRORS+=("$1"); echo -e "  ${RED}x${NC} $1"; }
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
info() { echo -e "  ${DIM}$1${NC}"; }

# ─── Interactive input helper ────────────────────────────────────────────────

prompt_user() {
    local prompt_text="$1"
    local default_value="${2:-}"
    local result=""

    if [[ -n "$default_value" ]]; then
        echo -en "  ${prompt_text} [${GREEN}${default_value}${NC}]: " >&2
    else
        echo -en "  ${prompt_text}: " >&2
    fi

    if read -r result < /dev/tty 2>/dev/null; then
        : # success
    else
        result=""
    fi

    if [[ -z "$result" ]]; then
        result="$default_value"
    fi

    echo "$result"
}

# ─── Detection helpers ───────────────────────────────────────────────────────

detect_project_type() {
    if [[ -f "package.json" ]]; then
        echo "node"
    elif [[ -f "pyproject.toml" ]] || [[ -f "setup.py" ]] || [[ -f "requirements.txt" ]]; then
        echo "python"
    else
        echo "other"
    fi
}

detect_project_name() {
    basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" \
        | tr '[:upper:]' '[:lower:]' \
        | sed 's/[^a-z0-9-]/-/g; s/--*/-/g; s/^-//; s/-$//'
}

detect_display_name() {
    echo "$1" | sed 's/-/ /g' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) substr($i,2)}1'
}

detect_env_file() {
    if [[ -f ".env.local" ]]; then echo ".env.local"; return; fi
    if [[ -f ".env" ]]; then echo ".env"; return; fi
    if [[ -f "next.config.ts" ]] || [[ -f "next.config.js" ]] || [[ -f "next.config.mjs" ]]; then
        echo ".env.local"; return
    fi
    if [[ "$1" == "python" ]]; then echo ".env"; else echo ".env.local"; fi
}

detect_subproject_env_file() {
    local dir="$1"
    if [[ -f "${dir}/.env.local" ]]; then echo "${dir}/.env.local"; return; fi
    if [[ -f "${dir}/.env" ]]; then echo "${dir}/.env"; return; fi
    if [[ -f "${dir}/next.config.ts" ]] || [[ -f "${dir}/next.config.js" ]] || [[ -f "${dir}/next.config.mjs" ]]; then
        echo "${dir}/.env.local"; return
    fi
    if [[ -f "${dir}/pyproject.toml" ]] || [[ -f "${dir}/setup.py" ]] || [[ -f "${dir}/requirements.txt" ]]; then
        echo "${dir}/.env"; return
    fi
    if [[ -f "${dir}/package.json" ]]; then echo "${dir}/.env.local"; return; fi
    echo "${dir}/.env"
}

detect_subproject_label() {
    local dir="$1"
    if [[ -f "${dir}/next.config.ts" ]] || [[ -f "${dir}/next.config.js" ]] || [[ -f "${dir}/next.config.mjs" ]]; then
        echo "Next.js"
    elif [[ -f "${dir}/pyproject.toml" ]]; then echo "Python"
    elif [[ -f "${dir}/package.json" ]]; then echo "Node"
    else echo ""; fi
}

# ─── Monorepo detection ─────────────────────────────────────────────────────

DETECTED_SUBPROJECTS=()

detect_project_structure() {
    local found=()

    # pnpm/npm/yarn workspaces
    if [[ -f "package.json" ]] && command -v node &>/dev/null; then
        local workspace_dirs
        workspace_dirs=$(node -e "
const pkg = JSON.parse(require('fs').readFileSync('package.json','utf8'));
const ws = pkg.workspaces || (pkg.workspaces && pkg.workspaces.packages) || [];
const dirs = Array.isArray(ws) ? ws : (ws.packages || []);
dirs.forEach(d => {
    if (d.includes('*')) {
        const base = d.replace(/\/?\*.*/, '');
        try {
            require('fs').readdirSync(base, {withFileTypes:true})
                .filter(e => e.isDirectory())
                .forEach(e => console.log(base + '/' + e.name));
        } catch(e) {}
    } else {
        console.log(d);
    }
});
" 2>/dev/null) || true

        if [[ -n "$workspace_dirs" ]]; then
            while IFS= read -r wdir; do
                [[ -z "$wdir" ]] && continue
                wdir="${wdir%/}"
                if [[ -d "$wdir" ]] && { [[ -f "${wdir}/package.json" ]] || [[ -f "${wdir}/pyproject.toml" ]]; }; then
                    local name
                    name=$(basename "$wdir")
                    found+=("${name}:${wdir}")
                fi
            done <<< "$workspace_dirs"
        fi
    fi

    # Turborepo / Nx
    if [[ ${#found[@]} -eq 0 ]]; then
        if [[ -f "turbo.json" ]] || [[ -f "nx.json" ]]; then
            for search_dir in apps packages services; do
                if [[ -d "$search_dir" ]]; then
                    for sub in "$search_dir"/*/; do
                        [[ ! -d "$sub" ]] && continue
                        sub="${sub%/}"
                        if [[ -f "${sub}/package.json" ]] || [[ -f "${sub}/pyproject.toml" ]]; then
                            local name
                            name=$(basename "$sub")
                            found+=("${name}:${sub}")
                        fi
                    done
                fi
            done
        fi
    fi

    # Generic apps/packages/services scan
    if [[ ${#found[@]} -eq 0 ]]; then
        for search_dir in apps packages services; do
            if [[ -d "$search_dir" ]]; then
                for sub in "$search_dir"/*/; do
                    [[ ! -d "$sub" ]] && continue
                    sub="${sub%/}"
                    if [[ -f "${sub}/package.json" ]] || [[ -f "${sub}/pyproject.toml" ]]; then
                        local name
                        name=$(basename "$sub")
                        found+=("${name}:${sub}")
                    fi
                done
            fi
        done
    fi

    DETECTED_SUBPROJECTS=("${found[@]}")
}

# ─── Download helper ─────────────────────────────────────────────────────────

download_file() {
    local url="$1"
    local dest="$2"
    local label="$3"

    if curl -sfL "$url" -o "$dest" 2>/dev/null; then
        ok "$label"
        return 0
    else
        fail "Failed to download $label"
        info "URL: $url"
        info "You can download manually and place at: $dest"
        return 1
    fi
}

# ─── Spinner helper ──────────────────────────────────────────────────────────

spinner_pid=""

start_spinner() {
    local message="${1:-Working...}"
    (
        local chars='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
        local i=0
        while true; do
            printf '\r  %s %s ' "${chars:i%${#chars}:1}" "$message" >&2
            i=$((i + 1))
            sleep 0.1
        done
    ) &
    spinner_pid=$!
}

stop_spinner() {
    local success="${1:-1}"
    local message="${2:-}"
    if [[ -n "$spinner_pid" ]]; then
        kill "$spinner_pid" 2>/dev/null || true
        wait "$spinner_pid" 2>/dev/null || true
        spinner_pid=""
    fi
    printf '\r  %-60s\r' "" >&2
    if [[ -n "$message" ]]; then
        if [[ "$success" == "1" ]]; then
            ok "$message"
        else
            fail "$message"
        fi
    fi
}

# ─── Open URL helper ─────────────────────────────────────────────────────────

open_url() {
    local url="$1"
    if [[ "$(uname)" == "Darwin" ]]; then
        open "$url" 2>/dev/null && return 0
    elif command -v xdg-open &>/dev/null; then
        xdg-open "$url" 2>/dev/null && return 0
    elif command -v wslview &>/dev/null; then
        wslview "$url" 2>/dev/null && return 0
    fi
    return 1
}

# ══════════════════════════════════════════════════════════════════════════════
#  PHASE 0: Detect environment
# ══════════════════════════════════════════════════════════════════════════════

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$PROJECT_ROOT"

PROJECT_TYPE=$(detect_project_type)
if [[ "$PROJECT_TYPE" == "node" ]]; then IS_NODE=true; fi
if [[ "$PROJECT_TYPE" == "python" ]]; then IS_PYTHON=true; fi
if command -v jq &>/dev/null; then HAS_JQ=true; fi

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     Matrx CLI Installer                  ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}"
echo ""
info "Project root: ${PROJECT_ROOT}"
info "Project type: ${PROJECT_TYPE}"
echo ""

# ══════════════════════════════════════════════════════════════════════════════
#  PHASE 1: Ask what to set up
# ══════════════════════════════════════════════════════════════════════════════

echo -e "${CYAN}What would you like to set up?${NC}"
echo ""
echo -e "  ${BOLD}1${NC}) Ship + Env-Sync (both)  ${DIM}— recommended${NC}"
echo -e "  ${BOLD}2${NC}) Ship only               ${DIM}— deployment versioning${NC}"
echo -e "  ${BOLD}3${NC}) Env-Sync only            ${DIM}— Doppler env management${NC}"
echo ""
SETUP_CHOICE=$(prompt_user "Choose (1/2/3)" "1")

case "$SETUP_CHOICE" in
    1|both|"") SETUP_SHIP=true; SETUP_ENV=true ;;
    2|ship)    SETUP_SHIP=true ;;
    3|env*)    SETUP_ENV=true ;;
    *)         SETUP_SHIP=true; SETUP_ENV=true ;;
esac

echo ""

# ══════════════════════════════════════════════════════════════════════════════
#  PHASE 2: Download CLI files
# ══════════════════════════════════════════════════════════════════════════════

echo -e "${CYAN}Downloading CLI files...${NC}"

mkdir -p "${INSTALL_DIR}/lib"

# Always download lib files (shared by both tools)
download_file "${REPO_RAW}/cli/lib/colors.sh" "${INSTALL_DIR}/lib/colors.sh" "lib/colors.sh"
download_file "${REPO_RAW}/cli/lib/utils.sh" "${INSTALL_DIR}/lib/utils.sh" "lib/utils.sh"

if [[ "$SETUP_SHIP" == true ]]; then
    download_file "${REPO_RAW}/cli/ship.ts" "${INSTALL_DIR}/ship.ts" "ship.ts"
    if [[ "$IS_NODE" == false ]]; then
        download_file "${REPO_RAW}/cli/ship.sh" "${INSTALL_DIR}/ship.sh" "ship.sh"
        chmod +x "${INSTALL_DIR}/ship.sh" 2>/dev/null || true
    fi
fi

if [[ "$SETUP_ENV" == true ]]; then
    download_file "${REPO_RAW}/cli/env-sync.sh" "${INSTALL_DIR}/env-sync.sh" "env-sync.sh"
    chmod +x "${INSTALL_DIR}/env-sync.sh" 2>/dev/null || true
fi

echo ""

# ══════════════════════════════════════════════════════════════════════════════
#  PHASE 3: Register commands (package.json / Makefile)
# ══════════════════════════════════════════════════════════════════════════════

echo -e "${CYAN}Registering commands...${NC}"

if [[ "$IS_NODE" == true ]] && [[ -f "package.json" ]]; then
    if command -v node &>/dev/null; then
        node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (!pkg.scripts) pkg.scripts = {};

const shipScripts = ${SETUP_SHIP:+true}${SETUP_SHIP:-false} ? {
    'ship': 'tsx scripts/matrx/ship.ts',
    'ship:minor': 'tsx scripts/matrx/ship.ts --minor',
    'ship:major': 'tsx scripts/matrx/ship.ts --major',
    'ship:init': 'tsx scripts/matrx/ship.ts init',
    'ship:setup': 'tsx scripts/matrx/ship.ts setup',
    'ship:history': 'tsx scripts/matrx/ship.ts history',
    'ship:update': 'tsx scripts/matrx/ship.ts update',
    'ship:force-remove': 'tsx scripts/matrx/ship.ts force-remove',
} : {};

const envScripts = ${SETUP_ENV:+true}${SETUP_ENV:-false} ? {
    'env:pull': 'bash scripts/matrx/env-sync.sh pull',
    'env:push': 'bash scripts/matrx/env-sync.sh push',
    'env:diff': 'bash scripts/matrx/env-sync.sh diff',
    'env:status': 'bash scripts/matrx/env-sync.sh status',
    'env:sync': 'bash scripts/matrx/env-sync.sh sync',
    'env:pull:force': 'bash scripts/matrx/env-sync.sh pull --force',
    'env:push:force': 'bash scripts/matrx/env-sync.sh push --force',
} : {};

const all = { ...shipScripts, ...envScripts };
let added = 0;
for (const [key, val] of Object.entries(all)) {
    if (pkg.scripts[key] !== val) { pkg.scripts[key] = val; added++; }
}

fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
if (added > 0) console.log('Updated ' + added + ' script(s)');
" 2>/dev/null && ok "package.json scripts updated" || warn "Could not update package.json scripts"
    else
        warn "Node.js not found — skipping package.json script registration"
    fi

    # Ensure tsx is installed for ship
    if [[ "$SETUP_SHIP" == true ]]; then
        TSX_INSTALLED=false
        if [[ "$HAS_JQ" == true ]]; then
            if jq -e '.devDependencies.tsx // .dependencies.tsx' package.json &>/dev/null; then
                TSX_INSTALLED=true
            fi
        else
            if grep -q '"tsx"' package.json 2>/dev/null; then TSX_INSTALLED=true; fi
        fi

        if [[ "$TSX_INSTALLED" == false ]]; then
            echo -e "  ${YELLOW}↓${NC} Installing tsx (required for ship CLI)..."
            if [[ -f "pnpm-lock.yaml" ]] || [[ -f "pnpm-workspace.yaml" ]]; then
                pnpm add -D tsx 2>/dev/null && ok "tsx installed via pnpm" || warn "Run: pnpm add -D tsx"
            elif [[ -f "yarn.lock" ]]; then
                yarn add -D tsx 2>/dev/null && ok "tsx installed via yarn" || warn "Run: yarn add -D tsx"
            elif [[ -f "bun.lockb" ]] || [[ -f "bun.lock" ]]; then
                bun add -D tsx 2>/dev/null && ok "tsx installed via bun" || warn "Run: bun add -D tsx"
            else
                npm install -D tsx 2>/dev/null && ok "tsx installed via npm" || warn "Run: npm install -D tsx"
            fi
        fi
    fi
elif [[ "$IS_PYTHON" == true ]] && [[ "$SETUP_ENV" == true ]]; then
    echo -e "${CYAN}Registering Makefile targets...${NC}"

    MARKER="# --- matrx-cli"

    if [[ -f "Makefile" ]]; then
        if grep -q "$MARKER" Makefile 2>/dev/null; then
            sed -i.bak "/$MARKER/,\$d" Makefile
            rm -f Makefile.bak
            info "Replacing existing matrx-cli section"
        fi
    else
        echo "# Makefile" > Makefile
        echo "" >> Makefile
        info "Created new Makefile"
    fi

    cat >> Makefile << 'MAKEFILE_SNIPPET'

# --- matrx-cli ─────────────────────────────────────
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

.PHONY: env-pull env-push env-diff env-status env-sync env-pull-force env-push-force
MAKEFILE_SNIPPET

    ok "Makefile targets registered"
fi

echo ""

# ══════════════════════════════════════════════════════════════════════════════
#  PHASE 4: Read or create .matrx.json config
# ══════════════════════════════════════════════════════════════════════════════

# Start building the config object. If .matrx.json exists, read it; otherwise start fresh.
MATRX_JSON=".matrx.json"
CONFIG_EXISTED=false

# We'll track config values in shell variables and write JSON at the end
SHIP_URL=""
SHIP_API_KEY=""
ENV_DOPPLER_PROJECT=""
ENV_DOPPLER_CONFIG=""
ENV_FILE_PATH=""
ENV_MULTI=false
# For multi-config, we store in a temp file
MULTI_CONFIGS_TMP=$(mktemp)
trap "rm -f '$MULTI_CONFIGS_TMP'" EXIT

if [[ -f "$MATRX_JSON" ]] && [[ "$HAS_JQ" == true ]]; then
    CONFIG_EXISTED=true
    info "Found existing ${MATRX_JSON}"

    SHIP_URL=$(jq -r '.ship.url // empty' "$MATRX_JSON" 2>/dev/null)
    SHIP_API_KEY=$(jq -r '.ship.apiKey // empty' "$MATRX_JSON" 2>/dev/null)
    ENV_DOPPLER_PROJECT=$(jq -r '.env.doppler.project // empty' "$MATRX_JSON" 2>/dev/null)
    ENV_DOPPLER_CONFIG=$(jq -r '.env.doppler.config // empty' "$MATRX_JSON" 2>/dev/null)
    ENV_FILE_PATH=$(jq -r '.env.file // empty' "$MATRX_JSON" 2>/dev/null)
    ENV_MULTI=$(jq -r '.env.multi // false' "$MATRX_JSON" 2>/dev/null)
elif [[ -f ".matrx-ship.json" ]]; then
    # Migrate from legacy config
    CONFIG_EXISTED=true
    info "Found legacy .matrx-ship.json — will migrate to .matrx.json"

    if [[ "$HAS_JQ" == true ]]; then
        SHIP_URL=$(jq -r '.url // empty' ".matrx-ship.json" 2>/dev/null)
        SHIP_API_KEY=$(jq -r '.apiKey // empty' ".matrx-ship.json" 2>/dev/null)
    elif command -v node &>/dev/null; then
        SHIP_URL=$(node -e "try{const c=JSON.parse(require('fs').readFileSync('.matrx-ship.json','utf8'));console.log(c.url||'')}catch{console.log('')}" 2>/dev/null)
        SHIP_API_KEY=$(node -e "try{const c=JSON.parse(require('fs').readFileSync('.matrx-ship.json','utf8'));console.log(c.apiKey||'')}catch{console.log('')}" 2>/dev/null)
    fi
fi

if [[ -f ".matrx-tools.conf" ]] && [[ -z "$ENV_DOPPLER_PROJECT" ]]; then
    # Migrate from legacy env config
    # shellcheck disable=SC1091
    source ".matrx-tools.conf" 2>/dev/null || true
    ENV_DOPPLER_PROJECT="${DOPPLER_PROJECT:-}"
    ENV_DOPPLER_CONFIG="${DOPPLER_CONFIG:-}"
    ENV_FILE_PATH="${ENV_FILE:-}"
    if [[ "${DOPPLER_MULTI:-false}" == "true" ]]; then
        ENV_MULTI=true
    fi
    info "Found legacy .matrx-tools.conf — will migrate to .matrx.json"
fi

# ══════════════════════════════════════════════════════════════════════════════
#  PHASE 5: Ship setup
# ══════════════════════════════════════════════════════════════════════════════

if [[ "$SETUP_SHIP" == true ]]; then
    echo -e "${CYAN}── Ship Setup ────────────────────────────────────${NC}"

    # Build the command used to invoke ship.ts
    SHIP_CMD="npx tsx ${INSTALL_DIR}/ship.ts"

    if [[ "$IS_NODE" == true ]]; then
        SHIP_DISPLAY="pnpm ship"
        SHIP_INIT_DISPLAY="pnpm ship:init"
        SHIP_SETUP_DISPLAY="pnpm ship:setup"
    else
        SHIP_DISPLAY="bash scripts/matrx/ship.sh"
        SHIP_INIT_DISPLAY="bash scripts/matrx/ship.sh init"
        SHIP_SETUP_DISPLAY="bash scripts/matrx/ship.sh setup"
    fi

    # ── Check for npx/tsx ──
    if ! command -v npx &>/dev/null; then
        warn "npx not found. Node.js is required for Ship CLI."
        info "Install Node.js: https://nodejs.org/"
        info "Then run: ${SHIP_SETUP_DISPLAY} --token YOUR_TOKEN"
    else
        # ── Server token ──
        HAS_TOKEN=false
        if [[ -f "$SERVER_CONFIG_FILE" ]]; then
            EXISTING_TOKEN=""
            if command -v node &>/dev/null; then
                EXISTING_TOKEN=$(node -e "try{const c=JSON.parse(require('fs').readFileSync('$SERVER_CONFIG_FILE','utf8'));console.log(c.token||'')}catch{console.log('')}" 2>/dev/null)
            elif [[ "$HAS_JQ" == true ]]; then
                EXISTING_TOKEN=$(jq -r '.token // empty' "$SERVER_CONFIG_FILE" 2>/dev/null)
            fi

            if [[ -n "$EXISTING_TOKEN" ]]; then
                TOKEN_PREVIEW="${EXISTING_TOKEN:0:8}...${EXISTING_TOKEN: -4}"
                ok "Server token already configured (${DIM}${TOKEN_PREVIEW}${NC})"
                HAS_TOKEN=true
            fi
        fi

        if [[ "$HAS_TOKEN" == false ]]; then
            echo -e "  No server token found."
            info "Get your token from: ${DEFAULT_SERVER}/admin/ (Tokens tab)"
            echo ""

            TOKEN=$(prompt_user "Server token (or press Enter to skip)" "")

            if [[ -z "$TOKEN" ]]; then
                warn "Skipped server token. Set it up later: ${SHIP_SETUP_DISPLAY} --token YOUR_TOKEN"
            else
                echo ""
                info "Verifying connection to ${DEFAULT_SERVER}..."
                if $SHIP_CMD setup --token "$TOKEN" 2>&1; then
                    HAS_TOKEN=true
                else
                    warn "Token verification failed. Try later: ${SHIP_SETUP_DISPLAY} --token YOUR_TOKEN"
                fi
            fi
        fi

        # ── Instance provisioning ──
        if [[ -n "$SHIP_URL" ]] && [[ -n "$SHIP_API_KEY" ]]; then
            ok "Ship instance already configured: ${SHIP_URL}"
        elif [[ "$HAS_TOKEN" == true ]]; then
            echo ""
            echo -e "  ${CYAN}── Instance Setup ──${NC}"

            DETECTED_NAME=$(detect_project_name)
            PROJECT_NAME=$(prompt_user "Project name" "$DETECTED_NAME")
            DISPLAY_NAME=$(prompt_user "Display name" "$(detect_display_name "$PROJECT_NAME")")

            if [[ -z "$PROJECT_NAME" ]]; then
                warn "Project name required. Provision later: ${SHIP_INIT_DISPLAY} my-project \"My Project\""
            else
                echo ""
                if $SHIP_CMD init "$PROJECT_NAME" "$DISPLAY_NAME" 2>&1; then
                    # Read back the config that ship.ts wrote
                    if [[ -f "$MATRX_JSON" ]] && [[ "$HAS_JQ" == true ]]; then
                        SHIP_URL=$(jq -r '.ship.url // empty' "$MATRX_JSON" 2>/dev/null)
                        SHIP_API_KEY=$(jq -r '.ship.apiKey // empty' "$MATRX_JSON" 2>/dev/null)
                    elif [[ -f ".matrx-ship.json" ]]; then
                        if [[ "$HAS_JQ" == true ]]; then
                            SHIP_URL=$(jq -r '.url // empty' ".matrx-ship.json" 2>/dev/null)
                            SHIP_API_KEY=$(jq -r '.apiKey // empty' ".matrx-ship.json" 2>/dev/null)
                        fi
                    fi
                else
                    warn "Instance provisioning failed. Try later: ${SHIP_INIT_DISPLAY} ${PROJECT_NAME} \"${DISPLAY_NAME}\""
                fi
            fi
        fi
    fi
    echo ""
fi

# ══════════════════════════════════════════════════════════════════════════════
#  PHASE 6: Env-Sync setup
# ══════════════════════════════════════════════════════════════════════════════

if [[ "$SETUP_ENV" == true ]]; then
    echo -e "${CYAN}── Env-Sync Setup ────────────────────────────────${NC}"

    # ── Check jq ──
    if [[ "$HAS_JQ" == false ]]; then
        warn "jq not found. Env-sync reads .matrx.json via jq."
        info "Install jq: https://jqlang.github.io/jq/download/"
        info "Env-sync will fall back to .matrx-tools.conf if jq is unavailable."
    fi

    # ── Doppler CLI ──
    DOPPLER_AVAILABLE=false
    if command -v doppler &>/dev/null; then
        ok "Doppler CLI found"
        DOPPLER_AVAILABLE=true
    else
        echo -e "  ${YELLOW}Doppler CLI not found. Installing...${NC}"
        if [[ "$(uname)" == "Darwin" ]]; then
            if command -v brew &>/dev/null; then
                start_spinner "Installing Doppler via Homebrew..."
                if brew install dopplerhq/cli/doppler >/dev/null 2>&1; then
                    stop_spinner 1 "Doppler installed via Homebrew"
                    DOPPLER_AVAILABLE=true
                else
                    stop_spinner 0 "Homebrew install failed"
                fi
            fi
        elif [[ -f /etc/debian_version ]] || command -v apt-get &>/dev/null; then
            start_spinner "Installing Doppler via apt..."
            if (
                curl -sLf --retry 3 --tlsv1.2 --proto "=https" \
                    'https://packages.doppler.com/public/cli/gpg.DE2A7741A397C129.key' \
                    | sudo gpg --dearmor -o /usr/share/keyrings/doppler-archive-keyring.gpg 2>/dev/null
                echo "deb [signed-by=/usr/share/keyrings/doppler-archive-keyring.gpg] https://packages.doppler.com/public/cli/deb/debian any-version main" \
                    | sudo tee /etc/apt/sources.list.d/doppler-cli.list >/dev/null
                sudo apt-get update -qq >/dev/null 2>&1
                sudo apt-get install -y -qq doppler >/dev/null 2>&1
            ); then
                stop_spinner 1 "Doppler installed via apt"
                DOPPLER_AVAILABLE=true
            else
                stop_spinner 0 "apt install failed"
            fi
        elif command -v yum &>/dev/null || command -v dnf &>/dev/null; then
            start_spinner "Installing Doppler via rpm..."
            if (
                sudo rpm --import 'https://packages.doppler.com/public/cli/gpg.DE2A7741A397C129.key' 2>/dev/null
                curl -sLf --retry 3 --tlsv1.2 --proto "=https" \
                    'https://packages.doppler.com/public/cli/config.rpm.txt' \
                    | sudo tee /etc/yum.repos.d/doppler-cli.repo >/dev/null
                if command -v dnf &>/dev/null; then
                    sudo dnf install -y -q doppler >/dev/null 2>&1
                else
                    sudo yum install -y -q doppler >/dev/null 2>&1
                fi
            ); then
                stop_spinner 1 "Doppler installed via rpm"
                DOPPLER_AVAILABLE=true
            else
                stop_spinner 0 "rpm install failed"
            fi
        else
            start_spinner "Installing Doppler..."
            if (curl -sLf --retry 3 --tlsv1.2 --proto "=https" https://cli.doppler.com/install.sh | sh) >/dev/null 2>&1; then
                stop_spinner 1 "Doppler installed"
                DOPPLER_AVAILABLE=true
            else
                stop_spinner 0 "Automatic install failed"
            fi
        fi

        if [[ "$DOPPLER_AVAILABLE" == false ]]; then
            warn "Doppler could not be installed automatically."
            info "Install manually: https://docs.doppler.com/docs/install-cli"
            info "Env-sync won't work until Doppler is installed and authenticated."
        fi
    fi

    # ── Doppler auth ──
    if [[ "$DOPPLER_AVAILABLE" == true ]]; then
        if doppler me &>/dev/null 2>&1; then
            ok "Doppler authenticated"
        else
            echo ""
            echo -e "  ${YELLOW}Doppler is not authenticated.${NC}"
            do_login=$(prompt_user "Log in to Doppler now? (y/n)" "y")

            if [[ "$do_login" == "y" || "$do_login" == "Y" || "$do_login" == "yes" ]]; then
                echo ""
                local_auth_url=""
                local_auth_url=$(doppler login --no-prompt 2>&1 | grep -oE 'https://[^ ]+' | head -1) || true

                if [[ -n "$local_auth_url" ]]; then
                    if open_url "$local_auth_url"; then
                        ok "Opened Doppler login in browser"
                    else
                        echo -e "  Open this URL: ${BOLD}${local_auth_url}${NC}"
                    fi
                    echo ""
                    start_spinner "Waiting for login..."
                    local waited=0
                    while [[ $waited -lt 120 ]]; do
                        if doppler me &>/dev/null 2>&1; then
                            stop_spinner 1 "Doppler authenticated"
                            break
                        fi
                        sleep 3
                        waited=$((waited + 3))
                    done
                    if [[ $waited -ge 120 ]]; then
                        stop_spinner 0 "Timed out. Run: doppler login"
                    fi
                else
                    if doppler login < /dev/tty 2>&1; then
                        ok "Doppler authenticated"
                    else
                        warn "Login incomplete. Run: doppler login"
                    fi
                fi
            else
                info "Skipped. Run: doppler login"
            fi
        fi
    fi

    # ── Env config ──
    if [[ -n "$ENV_DOPPLER_PROJECT" ]] && [[ "$ENV_MULTI" != "true" ]]; then
        ok "Env-sync already configured: ${ENV_DOPPLER_PROJECT}/${ENV_DOPPLER_CONFIG} -> ${ENV_FILE_PATH}"
    elif [[ "$ENV_MULTI" == "true" ]]; then
        ok "Multi-config env-sync already configured"
    else
        echo ""
        DETECTED_NAME=$(detect_project_name)

        # Check for monorepo
        detect_project_structure
        USE_MULTI=false

        if [[ ${#DETECTED_SUBPROJECTS[@]} -ge 2 ]]; then
            echo ""
            echo -e "  ${CYAN}Detected sub-projects:${NC}"
            for entry in "${DETECTED_SUBPROJECTS[@]}"; do
                _sp_dir="${entry#*:}"
                _sp_label=$(detect_subproject_label "$_sp_dir")
                if [[ -n "$_sp_label" ]]; then
                    echo -e "    ${GREEN}${_sp_dir}/${NC} ${DIM}(${_sp_label})${NC}"
                else
                    echo -e "    ${GREEN}${_sp_dir}/${NC}"
                fi
            done
            echo ""

            _multi_ans=$(prompt_user "Set up multi-config for these? (y/n)" "y")
            if [[ "$_multi_ans" == "y" || "$_multi_ans" == "Y" || "$_multi_ans" == "yes" ]]; then
                USE_MULTI=true
            fi
        fi

        if [[ "$USE_MULTI" == true ]]; then
            ENV_MULTI=true
            ENV_DOPPLER_PROJECT=$(prompt_user "Doppler project name" "$DETECTED_NAME")

            for entry in "${DETECTED_SUBPROJECTS[@]}"; do
                _sp_name="${entry%%:*}"
                _sp_dir="${entry#*:}"
                _sp_env_default=$(detect_subproject_env_file "$_sp_dir")

                echo -e "  ${BOLD}[${_sp_name}]${NC}"
                _sp_dp=$(prompt_user "  Doppler project" "$ENV_DOPPLER_PROJECT")
                _sp_dc=$(prompt_user "  Doppler config" "$_sp_name")
                _sp_ef=$(prompt_user "  Env file" "$_sp_env_default")
                echo ""

                echo "${_sp_name}|${_sp_dp}|${_sp_dc}|${_sp_ef}" >> "$MULTI_CONFIGS_TMP"
            done
        else
            ENV_DOPPLER_PROJECT=$(prompt_user "Doppler project name" "$DETECTED_NAME")
            if [[ -z "$ENV_DOPPLER_PROJECT" ]]; then
                warn "Doppler project name required for env-sync"
            else
                ENV_DOPPLER_CONFIG=$(prompt_user "Doppler config" "dev")
                ENV_FILE_PATH=$(prompt_user "Env file" "$(detect_env_file "$PROJECT_TYPE")")
            fi
        fi
    fi
    echo ""
fi

# ══════════════════════════════════════════════════════════════════════════════
#  PHASE 7: Write .matrx.json
# ══════════════════════════════════════════════════════════════════════════════

echo -e "${CYAN}Writing config...${NC}"

write_config() {
    # Build JSON config. We use a heredoc approach if jq is available, otherwise node.
    if [[ "$HAS_JQ" == true ]]; then
        # Start with empty object
        local json='{}'

        # Add ship config
        if [[ -n "$SHIP_URL" ]] && [[ -n "$SHIP_API_KEY" ]]; then
            json=$(echo "$json" | jq --arg url "$SHIP_URL" --arg key "$SHIP_API_KEY" \
                '. + { ship: { url: $url, apiKey: $key } }')
        fi

        # Add env config
        if [[ "$SETUP_ENV" == true ]] && [[ -n "$ENV_DOPPLER_PROJECT" ]]; then
            if [[ "$ENV_MULTI" == "true" ]] && [[ -s "$MULTI_CONFIGS_TMP" ]]; then
                # Build multi-config
                local configs_json='{}'
                while IFS='|' read -r _name _dp _dc _ef; do
                    configs_json=$(echo "$configs_json" | jq \
                        --arg name "$_name" --arg dp "$_dp" --arg dc "$_dc" --arg ef "$_ef" \
                        '. + { ($name): { doppler: { project: $dp, config: $dc }, file: $ef } }')
                done < "$MULTI_CONFIGS_TMP"

                json=$(echo "$json" | jq --argjson configs "$configs_json" \
                    '. + { env: { multi: true, configs: $configs } }')
            else
                json=$(echo "$json" | jq \
                    --arg dp "$ENV_DOPPLER_PROJECT" \
                    --arg dc "${ENV_DOPPLER_CONFIG:-dev}" \
                    --arg ef "${ENV_FILE_PATH:-.env}" \
                    '. + { env: { doppler: { project: $dp, config: $dc }, file: $ef } }')
            fi
        fi

        echo "$json" | jq '.' > "$MATRX_JSON"
    elif command -v node &>/dev/null; then
        node -e "
const config = {};
if ('${SHIP_URL}' && '${SHIP_API_KEY}') {
    config.ship = { url: '${SHIP_URL}', apiKey: '${SHIP_API_KEY}' };
}
if ('${ENV_DOPPLER_PROJECT}') {
    config.env = { doppler: { project: '${ENV_DOPPLER_PROJECT}', config: '${ENV_DOPPLER_CONFIG:-dev}' }, file: '${ENV_FILE_PATH:-.env}' };
}
require('fs').writeFileSync('${MATRX_JSON}', JSON.stringify(config, null, 2) + '\n');
" 2>/dev/null
    else
        warn "Neither jq nor node available — could not write .matrx.json"
        info "Create .matrx.json manually. See: ${REPO_RAW}/cli/templates/matrx.json.example"
        return 1
    fi
}

# Only write if we have something to write
if [[ -n "$SHIP_URL" ]] || [[ -n "$ENV_DOPPLER_PROJECT" ]]; then
    if write_config; then
        ok "Wrote ${MATRX_JSON}"
    fi
else
    info "No config values to write yet"
fi

# ── Update .gitignore ──
if [[ -f ".gitignore" ]]; then
    GITIGNORE_CHANGED=false
    if ! grep -q '\.matrx\.json' .gitignore 2>/dev/null; then
        echo "" >> .gitignore
        echo "# Matrx config (contains API keys)" >> .gitignore
        echo ".matrx.json" >> .gitignore
        GITIGNORE_CHANGED=true
    fi
    if ! grep -q '\.matrx-ship\.json' .gitignore 2>/dev/null; then
        echo ".matrx-ship.json" >> .gitignore
        GITIGNORE_CHANGED=true
    fi
    if ! grep -q '\.matrx-tools\.conf' .gitignore 2>/dev/null; then
        echo ".matrx-tools.conf" >> .gitignore
        GITIGNORE_CHANGED=true
    fi
    if ! grep -q '\.env-backups/' .gitignore 2>/dev/null; then
        echo ".env-backups/" >> .gitignore
        GITIGNORE_CHANGED=true
    fi
    if [[ "$GITIGNORE_CHANGED" == true ]]; then
        ok "Updated .gitignore"
    fi
else
    {
        echo "# Matrx config (contains API keys)"
        echo ".matrx.json"
        echo ".matrx-ship.json"
        echo ".matrx-tools.conf"
        echo ".env-backups/"
    } > .gitignore
    ok "Created .gitignore"
fi

echo ""

# ══════════════════════════════════════════════════════════════════════════════
#  PHASE 8: Summary
# ══════════════════════════════════════════════════════════════════════════════

echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║  Installation complete!                   ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════╝${NC}"
echo ""
info "CLI files:  ${INSTALL_DIR}/"
info "Config:     ${MATRX_JSON}"
echo ""

if [[ "$SETUP_SHIP" == true ]]; then
    echo -e "  ${BOLD}Ship commands:${NC}"
    if [[ "$IS_NODE" == true ]]; then
        echo -e "    ${CYAN}pnpm ship \"commit message\"${NC}     Ship a patch version"
        echo -e "    ${CYAN}pnpm ship:minor \"message\"${NC}      Minor bump"
        echo -e "    ${CYAN}pnpm ship:major \"message\"${NC}      Major bump"
        echo -e "    ${CYAN}pnpm ship:history${NC}               Import git history"
        echo -e "    ${CYAN}pnpm ship:update${NC}                Update CLI"
        echo -e "    ${CYAN}pnpm ship help${NC}                  All options"
    else
        echo -e "    ${CYAN}bash scripts/matrx/ship.sh \"commit message\"${NC}"
        echo -e "    ${CYAN}bash scripts/matrx/ship.sh help${NC}"
    fi
    echo ""
fi

if [[ "$SETUP_ENV" == true ]]; then
    echo -e "  ${BOLD}Env-sync commands:${NC}"
    if [[ "$IS_NODE" == true ]]; then
        echo -e "    ${CYAN}pnpm env:status${NC}      Quick sync summary"
        echo -e "    ${CYAN}pnpm env:diff${NC}        Show differences"
        echo -e "    ${CYAN}pnpm env:pull${NC}        Safe merge from Doppler"
        echo -e "    ${CYAN}pnpm env:push${NC}        Safe merge to Doppler"
        echo -e "    ${CYAN}pnpm env:sync${NC}        Interactive conflict resolution"
    elif [[ "$IS_PYTHON" == true ]]; then
        echo -e "    ${CYAN}make env-status${NC}      Quick sync summary"
        echo -e "    ${CYAN}make env-diff${NC}        Show differences"
        echo -e "    ${CYAN}make env-pull${NC}        Safe merge from Doppler"
        echo -e "    ${CYAN}make env-push${NC}        Safe merge to Doppler"
        echo -e "    ${CYAN}make env-sync${NC}        Interactive conflict resolution"
    else
        echo -e "    ${CYAN}bash scripts/matrx/env-sync.sh status${NC}      Quick sync summary"
        echo -e "    ${CYAN}bash scripts/matrx/env-sync.sh diff${NC}        Show differences"
        echo -e "    ${CYAN}bash scripts/matrx/env-sync.sh pull${NC}        Safe merge from Doppler"
        echo -e "    ${CYAN}bash scripts/matrx/env-sync.sh push${NC}        Safe merge to Doppler"
        echo -e "    ${CYAN}bash scripts/matrx/env-sync.sh sync${NC}        Interactive conflict resolution"
    fi
    echo ""
fi

# Print warnings summary if any
if [[ ${#WARNINGS[@]} -gt 0 ]]; then
    echo -e "  ${YELLOW}${BOLD}Warnings (${#WARNINGS[@]}):${NC}"
    for w in "${WARNINGS[@]}"; do
        echo -e "    ${YELLOW}!${NC} $w"
    done
    echo ""
fi

echo -e "  ${DIM}Re-run this installer anytime to update: curl -sL ${REPO_RAW}/cli/install.sh | bash${NC}"
echo ""
