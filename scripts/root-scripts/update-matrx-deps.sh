#!/opt/homebrew/bin/bash
# ============================================================================
# update-matrx-deps.sh
# Finds all pyproject.toml files across projects and updates the minimum
# version for internal matrx packages to the latest versions listed below.
#
# Usage: ./update-matrx-deps.sh          (apply changes)
#        ./update-matrx-deps.sh --dry    (preview only, no changes)
# ============================================================================

# ---- Preflight checks -------------------------------------------------------
# Require bash 4+ (associative arrays via declare -A are not supported in
# bash 3.2, which is the macOS system default at /bin/bash)
if (( BASH_VERSINFO[0] < 4 )); then
    echo ""
    echo "ERROR: This script requires bash 4 or newer."
    echo "       Currently running: bash ${BASH_VERSION} (${BASH})"
    echo ""
    echo "  Fix:"
    echo "    brew install bash"
    echo "    Then re-run: /opt/homebrew/bin/bash $0 $*"
    echo ""
    echo "  Or update the shebang line in this script to point to your"
    echo "  Homebrew bash after installing it."
    echo ""
    exit 1
fi

# Require GNU-compatible sed (macOS BSD sed needs the empty-string -i '' form,
# which this script already uses — but flag if sed is missing entirely)
if ! command -v sed &>/dev/null; then
    echo "ERROR: sed not found. Install via: brew install gnu-sed"
    exit 1
fi

# Require grep (used for version extraction)
if ! command -v grep &>/dev/null; then
    echo "ERROR: grep not found."
    exit 1
fi

# Require find
if ! command -v find &>/dev/null; then
    echo "ERROR: find not found."
    exit 1
fi

# Require curl (used to fetch latest versions from PyPI)
if ! command -v curl &>/dev/null; then
    echo "ERROR: curl not found. Install via: brew install curl"
    exit 1
fi
# -----------------------------------------------------------------------------

# ---- Fetch latest versions from PyPI ----
PACKAGE_NAMES=("matrx-utils" "matrx-orm" "matrx-ai" "matrx-dream-service")

fetch_pypi_version() {
    local pkg="$1"
    local version
    version=$(curl -sf "https://pypi.org/pypi/${pkg}/json" | grep -o '"version":"[^"]*"' | head -1 | cut -d'"' -f4)
    if [[ -z "$version" ]]; then
        echo "ERROR: Could not fetch version for ${pkg} from PyPI" >&2
        return 1
    fi
    echo "$version"
}

declare -A PACKAGES
echo -e "${BOLD}Fetching latest versions from PyPI...${NC}"
for pkg in "${PACKAGE_NAMES[@]}"; do
    ver=$(fetch_pypi_version "$pkg") || exit 1
    PACKAGES["$pkg"]="$ver"
done

# ---- EXCLUDE DIRS (top-level directories to skip) ----
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
BOLD='\033[1m'
NC='\033[0m'

# ---- Setup ----
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECTS_DIR="$(dirname "$SCRIPTS_DIR")"
DRY_RUN=false

if [[ "$1" == "--dry" || "$1" == "--dry-run" || "$1" == "-n" ]]; then
    DRY_RUN=true
    echo -e "${YELLOW}DRY RUN — no files will be modified${NC}"
fi

# ---- Build is_excluded helper ----
is_excluded() {
    local filepath="$1"
    for excluded in "${EXCLUDE_DIRS[@]}"; do
        if [[ "$filepath" == "${PROJECTS_DIR}/${excluded}/"* ]]; then
            return 0
        fi
    done
    return 1
}

# ---- Print header ----
echo ""
echo -e "${BOLD}Matrx dependency updater${NC}"
echo -e "${CYAN}Target versions:${NC}"
for pkg in "${!PACKAGES[@]}"; do
    echo -e "  ${pkg} >= ${GREEN}${PACKAGES[$pkg]}${NC}"
done
echo ""

# ---- Find pyproject.toml files ----
TOML_FILES=()
while IFS= read -r f; do
    is_excluded "$f" || TOML_FILES+=("$f")
done < <(find "$PROJECTS_DIR" -name 'pyproject.toml' \
    -not -path '*/node_modules/*' \
    -not -path '*/.venv/*' \
    -not -path '*/venv/*' \
    -not -path '*/__pycache__/*' 2>/dev/null | sort)

updated_files=0
updated_deps=0
skipped_already_current=0

for toml_file in "${TOML_FILES[@]}"; do
    rel_path="${toml_file#${PROJECTS_DIR}/}"
    file_changed=false

    for pkg in "${!PACKAGES[@]}"; do
        latest="${PACKAGES[$pkg]}"

        # Match lines like:  "matrx-utils>=1.0.4",  or  "matrx-utils>=1.0.4"
        # Also handles commented-out lines (skips them)
        # Captures: leading whitespace, quote char, package name, operator, old version, trailing
        if grep -qE "^[^#]*[\"']${pkg}>=" "$toml_file" 2>/dev/null; then
            # Get the current version (macOS-compatible: no grep -P)
            current=$(grep -oE "[\"']${pkg}>=[0-9]+\.[0-9]+\.[0-9]+" "$toml_file" 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)

            if [[ -z "$current" ]]; then
                continue
            fi

            if [[ "$current" == "$latest" ]]; then
                ((skipped_already_current++))
                continue
            fi

            echo -e "  ${CYAN}${rel_path}${NC}"
            echo -e "    ${pkg}: ${RED}${current}${NC} → ${GREEN}${latest}${NC}"

            if [[ "$DRY_RUN" == false ]]; then
                # Use sed to replace the version, being careful to only match dependency lines
                sed -i '' "s/\([\"']${pkg}>= *\)[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*/\1${latest}/g" "$toml_file"
            fi

            file_changed=true
            ((updated_deps++))
        fi
    done

    if [[ "$file_changed" == true ]]; then
        ((updated_files++))
    fi
done

# ---- Summary ----
echo ""
if [[ "$DRY_RUN" == true ]]; then
    echo -e "${YELLOW}DRY RUN complete${NC}"
fi
echo -e "${GREEN}Done!${NC} Files updated: ${updated_files} | Deps updated: ${updated_deps} | Already current: ${skipped_already_current}"
echo ""
