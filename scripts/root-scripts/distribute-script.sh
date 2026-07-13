#!/bin/bash
# ============================================================================
# distribute-script.sh
# Distributes a script from this directory to the scripts/ dir of all projects
#
# Usage: ./distribute-script.sh <script-name>
# Example: ./distribute-script.sh git-branches.sh
# ============================================================================

# ---- EXCLUDE LIST (update as needed) ----
EXCLUDE_DIRS=(
    "clawdbot"
    "junk"
    "litellm"
    "scripts"
    "secrets"
    ".arman"
    ".claude"
)

# ---- Colors ----
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ---- Setup ----
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECTS_DIR="$(dirname "$SCRIPTS_DIR")"

# ---- Validate args ----
if [[ $# -lt 1 ]]; then
    echo -e "${RED}Usage: $0 <script-name>${NC}"
    echo -e "  Example: $0 git-branches.sh"
    echo ""
    echo "Available scripts in ${SCRIPTS_DIR}:"
    ls -1 "$SCRIPTS_DIR" | grep -v "$(basename "$0")"
    exit 1
fi

SCRIPT_NAME="$1"
SOURCE_FILE="${SCRIPTS_DIR}/${SCRIPT_NAME}"

if [[ ! -f "$SOURCE_FILE" ]]; then
    echo -e "${RED}Error: Script '${SCRIPT_NAME}' not found in ${SCRIPTS_DIR}${NC}"
    exit 1
fi

# ---- Build exclusion check ----
is_excluded() {
    local dir_name="$1"
    for excluded in "${EXCLUDE_DIRS[@]}"; do
        if [[ "$dir_name" == "$excluded" ]]; then
            return 0
        fi
    done
    return 1
}

# ---- Distribute ----
echo ""
echo -e "${CYAN}Distributing '${SCRIPT_NAME}' to project scripts/ directories...${NC}"
echo -e "${CYAN}Source: ${SOURCE_FILE}${NC}"
echo ""

copied=0
skipped=0
created=0

for dir in "$PROJECTS_DIR"/*/; do
    dir_name="$(basename "$dir")"

    # Skip non-directories (shouldn't happen with */, but just in case)
    [[ ! -d "$dir" ]] && continue

    # Skip excluded directories
    if is_excluded "$dir_name"; then
        echo -e "  ${YELLOW}SKIP${NC}  ${dir_name}  (excluded)"
        ((skipped++))
        continue
    fi

    # Skip non-git repos (plain files/dirs that aren't projects)
    if [[ ! -d "${dir}.git" ]]; then
        echo -e "  ${YELLOW}SKIP${NC}  ${dir_name}  (not a git repo)"
        ((skipped++))
        continue
    fi

    # Create scripts/ directory if it doesn't exist
    target_dir="${dir}scripts"
    if [[ ! -d "$target_dir" ]]; then
        mkdir -p "$target_dir"
        echo -e "  ${CYAN}MKDIR${NC} ${dir_name}/scripts/"
        ((created++))
    fi

    # Copy the script
    cp "$SOURCE_FILE" "${target_dir}/${SCRIPT_NAME}"
    chmod +x "${target_dir}/${SCRIPT_NAME}"
    echo -e "  ${GREEN}COPY${NC}  ${dir_name}/scripts/${SCRIPT_NAME}"
    ((copied++))
done

echo ""
echo -e "${GREEN}Done!${NC} Copied: ${copied} | Skipped: ${skipped} | Dirs created: ${created}"
echo ""
