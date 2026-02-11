#!/usr/bin/env bash
# Matrx Ship CLI Installer
# Usage: curl -sL https://raw.githubusercontent.com/armanisadeghi/matrx-ship/main/cli/install.sh | bash
#
# This script:
# 1. Downloads the ship CLI script into your project's scripts/matrx/ directory
# 2. Adds "ship" scripts to your package.json (if it exists)
# 3. Creates a .matrx-ship.json template if one doesn't exist

set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/armanisadeghi/matrx-ship/main"
INSTALL_DIR="scripts/matrx"
CLI_FILE="ship.ts"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${BLUE}╔══════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     Matrx Ship CLI Installer         ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════╝${NC}"
echo ""

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

# Add to .gitignore if not already there
if [ -f ".gitignore" ]; then
  if ! grep -q ".matrx-ship.json" ".gitignore" 2>/dev/null; then
    echo "" >> ".gitignore"
    echo "# Matrx Ship config (contains API key)" >> ".gitignore"
    echo ".matrx-ship.json" >> ".gitignore"
    echo -e "${GREEN}✓${NC} Added .matrx-ship.json to .gitignore"
  fi
fi

# Try to add scripts to package.json
if [ -f "package.json" ]; then
  if command -v jq &> /dev/null; then
    UPDATED=$(jq '
      .scripts.ship = "tsx scripts/matrx/ship.ts" |
      .scripts["ship:minor"] = "tsx scripts/matrx/ship.ts --minor" |
      .scripts["ship:major"] = "tsx scripts/matrx/ship.ts --major" |
      .scripts["ship:init"] = "tsx scripts/matrx/ship.ts init" |
      .scripts["ship:setup"] = "tsx scripts/matrx/ship.ts setup"
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
    echo '    "ship:setup": "tsx scripts/matrx/ship.ts setup"'
    echo ""
  fi
fi

echo ""
echo -e "${GREEN}✓ Installation complete!${NC}"
echo ""
echo -e "${BOLD}Quick Start:${NC}"
echo ""
echo "  1. Save your server token (one-time per machine):"
echo "     pnpm ship:setup --token YOUR_SERVER_TOKEN"
echo ""
echo "  2. Provision an instance for this project:"
echo '     pnpm ship:init my-project "My Project Name"'
echo ""
echo "  3. Ship!"
echo '     pnpm ship "your commit message"'
echo ""
echo -e "  Run ${BOLD}pnpm ship help${NC} for all options."
echo ""
