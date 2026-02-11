#!/usr/bin/env bash
# Matrx Ship CLI Installer
# Usage: curl -sL https://raw.githubusercontent.com/armanisadeghi/matrx-ship/main/cli/install.sh | bash
#
# This script:
# 1. Downloads the ship CLI into your project's scripts/matrx/ directory
# 2. For Node projects: adds "ship" scripts to package.json
# 3. For non-Node projects: downloads a bash wrapper (ship.sh)
# 4. Adds .matrx-ship.json to .gitignore
# 5. Interactively sets up server token (if not already configured)
# 6. Provisions a ship instance for this project
#
# Compatible with bash 3.2+ (macOS default)
# Reads interactive input from /dev/tty so curl|bash piping works correctly.

set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/armanisadeghi/matrx-ship/main"
INSTALL_DIR="scripts/matrx"
CLI_FILE="ship.ts"
WRAPPER_FILE="ship.sh"
DEFAULT_SERVER="https://mcp.dev.codematrx.com"
SERVER_CONFIG_FILE="$HOME/.config/matrx-ship/server.json"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

# ─── Interactive input helper ────────────────────────────────────────────────
# Always reads from /dev/tty so curl|bash works correctly.

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

detect_project_name() {
  basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" \
    | tr '[:upper:]' '[:lower:]' \
    | sed 's/[^a-z0-9-]/-/g; s/--*/-/g; s/^-//; s/-$//'
}

detect_display_name() {
  # Convert kebab-case to Title Case
  echo "$1" | sed 's/-/ /g' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) substr($i,2)}1'
}

# ══════════════════════════════════════════════════════════════════════════════
# Phase 1: Download CLI files
# ══════════════════════════════════════════════════════════════════════════════

echo ""
echo -e "${BLUE}╔══════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     Matrx Ship CLI Installer         ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════╝${NC}"
echo ""

# Detect project type
IS_NODE=false
if [ -f "package.json" ]; then
  IS_NODE=true
fi

# Create install directory
mkdir -p "$INSTALL_DIR"
echo -e "${GREEN}✓${NC} Created $INSTALL_DIR/"

# Download CLI script
echo -e "${YELLOW}↓${NC} Downloading ship CLI..."
if curl -sL "${REPO_RAW}/cli/ship.ts" -o "${INSTALL_DIR}/${CLI_FILE}"; then
  echo -e "${GREEN}✓${NC} Downloaded ${INSTALL_DIR}/${CLI_FILE}"
else
  echo -e "${RED}✗${NC} Failed to download CLI script"
  exit 1
fi

# For non-Node projects, also download the bash wrapper
if [ "$IS_NODE" = false ]; then
  echo -e "${YELLOW}↓${NC} Downloading bash wrapper (no package.json detected)..."
  if curl -sL "${REPO_RAW}/cli/ship.sh" -o "${INSTALL_DIR}/${WRAPPER_FILE}"; then
    chmod +x "${INSTALL_DIR}/${WRAPPER_FILE}"
    echo -e "${GREEN}✓${NC} Downloaded ${INSTALL_DIR}/${WRAPPER_FILE}"
  else
    echo -e "${RED}✗${NC} Failed to download bash wrapper"
    exit 1
  fi
fi

# Add to .gitignore if not already there
if [ -f ".gitignore" ]; then
  if ! grep -q ".matrx-ship.json" ".gitignore" 2>/dev/null; then
    echo "" >> ".gitignore"
    echo "# Matrx Ship config (contains API key)" >> ".gitignore"
    echo ".matrx-ship.json" >> ".gitignore"
    echo -e "${GREEN}✓${NC} Added .matrx-ship.json to .gitignore"
  fi
fi

# Node projects: add scripts to package.json
if [ "$IS_NODE" = true ]; then
  if command -v jq &> /dev/null; then
    UPDATED=$(jq '
      .scripts.ship = "tsx scripts/matrx/ship.ts" |
      .scripts["ship:minor"] = "tsx scripts/matrx/ship.ts --minor" |
      .scripts["ship:major"] = "tsx scripts/matrx/ship.ts --major" |
      .scripts["ship:init"] = "tsx scripts/matrx/ship.ts init" |
      .scripts["ship:setup"] = "tsx scripts/matrx/ship.ts setup" |
      .scripts["ship:history"] = "tsx scripts/matrx/ship.ts history" |
      .scripts["ship:update"] = "tsx scripts/matrx/ship.ts update"
    ' package.json)
    echo "$UPDATED" > package.json
    echo -e "${GREEN}✓${NC} Added ship scripts to package.json"
  else
    echo -e "${YELLOW}→${NC} Install jq to auto-add scripts, or manually add to package.json:"
    echo ""
    echo '    "ship": "tsx scripts/matrx/ship.ts",'
    echo '    "ship:minor": "tsx scripts/matrx/ship.ts --minor",'
    echo '    "ship:major": "tsx scripts/matrx/ship.ts --major",'
    echo '    "ship:init": "tsx scripts/matrx/ship.ts init",'
    echo '    "ship:setup": "tsx scripts/matrx/ship.ts setup",'
    echo '    "ship:history": "tsx scripts/matrx/ship.ts history",'
    echo '    "ship:update": "tsx scripts/matrx/ship.ts update"'
    echo ""
  fi
fi

echo ""
echo -e "${GREEN}✓ CLI files installed${NC}"

# Build the command used to invoke ship.ts during this installer
SHIP_CMD="npx tsx ${INSTALL_DIR}/${CLI_FILE}"

# Build display commands for the final summary
if [ "$IS_NODE" = true ]; then
  SHIP_DISPLAY="pnpm ship"
  SHIP_INIT_DISPLAY="pnpm ship:init"
  SHIP_SETUP_DISPLAY="pnpm ship:setup"
  SHIP_HISTORY_DISPLAY="pnpm ship:history"
  SHIP_UPDATE_DISPLAY="pnpm ship:update"
  SHIP_HELP_DISPLAY="pnpm ship help"
else
  SHIP_DISPLAY="bash scripts/matrx/ship.sh"
  SHIP_INIT_DISPLAY="bash scripts/matrx/ship.sh init"
  SHIP_SETUP_DISPLAY="bash scripts/matrx/ship.sh setup"
  SHIP_HISTORY_DISPLAY="bash scripts/matrx/ship.sh history"
  SHIP_UPDATE_DISPLAY="bash scripts/matrx/ship.sh update"
  SHIP_HELP_DISPLAY="bash scripts/matrx/ship.sh help"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Phase 2: Ensure npx/tsx are available
# ══════════════════════════════════════════════════════════════════════════════

if ! command -v npx &> /dev/null; then
  echo ""
  echo -e "${YELLOW}npx not found.${NC} Node.js is required to run the ship CLI."
  echo -e "${DIM}Install Node.js: https://nodejs.org/${NC}"
  echo ""
  echo -e "${GREEN}✓ CLI files installed.${NC} Run setup manually once Node.js is available:"
  echo -e "  ${CYAN}${SHIP_SETUP_DISPLAY} --token YOUR_TOKEN${NC}"
  echo -e "  ${CYAN}${SHIP_INIT_DISPLAY} my-project \"My Project\"${NC}"
  echo ""
  exit 0
fi

# ══════════════════════════════════════════════════════════════════════════════
# Phase 3: Server token
# ══════════════════════════════════════════════════════════════════════════════

echo ""
echo -e "${CYAN}── Server Token ──────────────────────────────────${NC}"

HAS_TOKEN=false
if [ -f "$SERVER_CONFIG_FILE" ]; then
  # Check if the file has a non-empty token value
  if command -v node &> /dev/null; then
    EXISTING_TOKEN=$(node -e "try{const c=JSON.parse(require('fs').readFileSync('$SERVER_CONFIG_FILE','utf8'));console.log(c.token||'')}catch{console.log('')}" 2>/dev/null)
  else
    EXISTING_TOKEN=$(grep -o '"token"[[:space:]]*:[[:space:]]*"[^"]*"' "$SERVER_CONFIG_FILE" 2>/dev/null | sed 's/.*"token"[[:space:]]*:[[:space:]]*"//;s/"$//' || echo "")
  fi

  if [ -n "$EXISTING_TOKEN" ]; then
    # Show truncated token for confirmation
    TOKEN_PREVIEW="${EXISTING_TOKEN:0:8}...${EXISTING_TOKEN: -4}"
    echo -e "  ${GREEN}✓${NC} Server token already configured (${DIM}${TOKEN_PREVIEW}${NC})"
    HAS_TOKEN=true
  fi
fi

if [ "$HAS_TOKEN" = false ]; then
  echo -e "  No server token found."
  echo -e "  ${DIM}Get your token from: ${CYAN}${DEFAULT_SERVER}/admin/${NC} ${DIM}(Tokens tab)${NC}"
  echo ""

  TOKEN=$(prompt_user "Server token" "")

  if [ -z "$TOKEN" ]; then
    echo ""
    echo -e "  ${YELLOW}Skipped.${NC} You can set this up later:"
    echo -e "    ${CYAN}${SHIP_SETUP_DISPLAY} --token YOUR_SERVER_TOKEN${NC}"
    echo ""
    echo -e "  Then provision an instance:"
    echo -e "    ${CYAN}${SHIP_INIT_DISPLAY} my-project \"My Project\"${NC}"
    echo ""
    exit 0
  fi

  echo ""
  echo -e "  ${DIM}Verifying connection to ${DEFAULT_SERVER}...${NC}"

  # Use ship.ts setup to verify and save the token
  if $SHIP_CMD setup --token "$TOKEN" 2>&1; then
    HAS_TOKEN=true
  else
    echo ""
    echo -e "  ${RED}Token verification failed.${NC} You can retry later:"
    echo -e "    ${CYAN}${SHIP_SETUP_DISPLAY} --token YOUR_TOKEN${NC}"
    echo ""
    exit 1
  fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# Phase 4: Instance provisioning
# ══════════════════════════════════════════════════════════════════════════════

if [ -f ".matrx-ship.json" ]; then
  # Already configured — read the URL and show it
  if command -v node &> /dev/null; then
    EXISTING_URL=$(node -e "try{const c=JSON.parse(require('fs').readFileSync('.matrx-ship.json','utf8'));console.log(c.url||'')}catch{console.log('')}" 2>/dev/null)
  else
    EXISTING_URL=$(grep -o '"url"[[:space:]]*:[[:space:]]*"[^"]*"' .matrx-ship.json 2>/dev/null | sed 's/.*"url"[[:space:]]*:[[:space:]]*"//;s/"$//' || echo "")
  fi

  echo ""
  echo -e "${CYAN}── Instance ──────────────────────────────────────${NC}"
  echo -e "  ${GREEN}✓${NC} Already configured for: ${BOLD}${EXISTING_URL}${NC}"
  echo ""
  echo -e "${GREEN}${BOLD}✓ Ship is ready!${NC}"
  echo ""
  echo -e "  Ship a version:"
  echo -e "    ${CYAN}${SHIP_DISPLAY} \"your commit message\"${NC}"
  echo ""
  echo -e "  Import git history:"
  echo -e "    ${CYAN}${SHIP_HISTORY_DISPLAY}${NC}"
  echo ""
  echo -e "  Update CLI:"
  echo -e "    ${CYAN}${SHIP_UPDATE_DISPLAY}${NC}"
  echo ""
  echo -e "  All options:"
  echo -e "    ${CYAN}${SHIP_HELP_DISPLAY}${NC}"
  echo ""
  exit 0
fi

echo ""
echo -e "${CYAN}── Instance Setup ────────────────────────────────${NC}"

# Detect smart defaults
DETECTED_NAME=$(detect_project_name)
DETECTED_DISPLAY=$(detect_display_name "$DETECTED_NAME")

PROJECT_NAME=$(prompt_user "Project name" "$DETECTED_NAME")
DISPLAY_NAME=$(prompt_user "Display name" "$(detect_display_name "$PROJECT_NAME")")

if [ -z "$PROJECT_NAME" ]; then
  echo -e "  ${RED}Project name is required.${NC}"
  echo -e "  Run manually: ${CYAN}${SHIP_INIT_DISPLAY} my-project \"My Project\"${NC}"
  exit 1
fi

echo ""

# Use ship.ts init to provision the instance (handles MCP call, health check, config write)
$SHIP_CMD init "$PROJECT_NAME" "$DISPLAY_NAME"
INIT_EXIT=$?

if [ $INIT_EXIT -ne 0 ]; then
  echo ""
  echo -e "  ${RED}Provisioning failed.${NC} You can retry:"
  echo -e "    ${CYAN}${SHIP_INIT_DISPLAY} ${PROJECT_NAME} \"${DISPLAY_NAME}\"${NC}"
  echo ""
  exit 1
fi

# ship.ts init already prints the success banner with URL/admin/key info.
# Just add the ongoing usage commands.
echo ""
echo -e "  ${BOLD}Ongoing usage:${NC}"
echo ""
echo -e "    ${CYAN}${SHIP_DISPLAY} \"your commit message\"${NC}      Ship a patch version"
echo -e "    ${CYAN}${SHIP_HISTORY_DISPLAY}${NC}                    Import git history"
echo -e "    ${CYAN}${SHIP_UPDATE_DISPLAY}${NC}                     Update CLI"
echo -e "    ${CYAN}${SHIP_HELP_DISPLAY}${NC}                       All options"
echo ""
