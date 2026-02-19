#!/usr/bin/env bash
# =============================================================================
# check-environment.sh — Pre-flight checks for Matrx CLI tools
#
# Usage:
#   source ./lib/check-environment.sh
#   check_environment_all
#
# This script verifies:
#   1. System dependencies (git, curl, node, package managers)
#   2. Project type (Node vs Python) and structure
#   3. Configuration status
#   4. CLI installation integrity
# =============================================================================

# Define colors if not already defined (in case this is run standalone)
if [[ -z "${RED:-}" ]]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    CYAN='\033[0;36m'
    DIM='\033[2m'
    BOLD='\033[1m'
    NC='\033[0m'
fi

# Detect Project Root (if not already set)
if [[ -z "${PROJECT_ROOT:-}" ]]; then
    PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fi

# Helper for formatted output
log_check() {
    local status="$1"
    local message="$2"
    local details="${3:-}"
    
    if [[ "$status" == "ok" ]]; then
        echo -e "  ${GREEN}✓${NC} ${message} ${details:+${DIM}(${details})${NC}}"
        return 0
    elif [[ "$status" == "warn" ]]; then
        echo -e "  ${YELLOW}!${NC} ${message} ${details:+${DIM}- ${details}${NC}}"
        return 0
    elif [[ "$status" == "fail" ]]; then
        echo -e "  ${RED}x${NC} ${message} ${details:+${RED}- ${details}${NC}}"
        return 1
    elif [[ "$status" == "info" ]]; then
        echo -e "  ${DIM}·${NC} ${message} ${details:+${DIM}${details}${NC}}"
        return 0
    fi
}

check_cmd() {
    local cmd="$1"
    if command -v "$cmd" &>/dev/null; then
        return 0
    else
        return 1
    fi
}

check_system_deps() {
    local all_ok=true
    
    if check_cmd git; then
        log_check ok "Git available"
    else
        log_check fail "Git missing" "Required for version control"
        all_ok=false
    fi
    
    if check_cmd curl; then
        log_check ok "Curl available"
    else
        log_check fail "Curl missing" "Required for downloading scripts"
        all_ok=false
    fi
    
    if check_cmd jq; then
        log_check ok "jq available" "Recommended for JSON parsing"
    else
        log_check info "jq missing" "Optional, but recommended"
    fi

    return 0
}

check_node_environment() {
    if ! check_cmd node; then
        log_check warn "Node.js not found" "Required for full functionality"
        return 1
    fi
    
    local node_ver
    node_ver=$(node -v 2>/dev/null)
    log_check ok "Node.js installed" "${node_ver}"
    
    # Detect package manager
    local pm="npm"
    if [[ -f "${PROJECT_ROOT}/pnpm-lock.yaml" ]]; then pm="pnpm"; fi
    if [[ -f "${PROJECT_ROOT}/yarn.lock" ]]; then pm="yarn"; fi
    if [[ -f "${PROJECT_ROOT}/bun.lockb" ]]; then pm="bun"; fi
    
    log_check ok "Package Manager" "${pm}"
    
    if [[ "$pm" != "npm" ]] && ! check_cmd "$pm"; then
        log_check warn "${pm} lockfile found but command missing"
    fi
    
    return 0
}

check_project_context() {
    local has_pkg=false
    local has_py=false
    
    if [[ -f "${PROJECT_ROOT}/package.json" ]]; then has_pkg=true; fi
    if [[ -f "${PROJECT_ROOT}/pyproject.toml" ]] || [[ -f "${PROJECT_ROOT}/setup.py" ]] || [[ -f "${PROJECT_ROOT}/requirements.txt" ]]; then has_py=true; fi
    
    if [[ "$has_pkg" == true ]]; then
        log_check ok "Project Type" "Node.js"
        check_node_environment
    elif [[ "$has_py" == true ]]; then
         log_check ok "Project Type" "Python"
    else
         log_check info "Project Type" "Generic / Other"
    fi
}

check_existing_install() {
    local install_dir="${PROJECT_ROOT}/scripts/matrx"
    local ship_ts="${install_dir}/ship.ts"
    local env_sh="${install_dir}/env-sync.sh"
    
    local ship_installed=false
    if [[ -f "$ship_ts" ]]; then
        log_check ok "CLI: Ship tool" "Installed"
        ship_installed=true
    else
        log_check info "CLI: Ship tool" "Not installed"
    fi
    
    if [[ -f "$env_sh" ]]; then
        log_check ok "CLI: Env-Sync tool" "Installed"
    else
        log_check info "CLI: Env-Sync tool" "Not installed"
    fi
    
    # Check legacy paths
    if [[ -f "${PROJECT_ROOT}/scripts/ship.ts" ]]; then
        log_check warn "Legacy install detected" "scripts/ship.ts (should be in scripts/matrx/)"
    fi
    
    if [[ "$ship_installed" == true ]]; then
        # Check integrity of lib
        if [[ -f "${install_dir}/lib/utils.sh" ]] && [[ -f "${install_dir}/lib/colors.sh" ]]; then
            log_check ok "CLI Integrity" "Libs found"
        else
            log_check warn "CLI Integrity" "Libs missing in ${install_dir}/lib/"
        fi
    fi
}

check_config_status() {
    local config="${PROJECT_ROOT}/.matrx.json"
    local legacy_ship="${PROJECT_ROOT}/.matrx-ship.json"
    local legacy_tools="${PROJECT_ROOT}/.matrx-tools.conf"
    
    if [[ -f "$config" ]]; then
        log_check ok "Config (.matrx.json)" "Found"
    elif [[ -f "$legacy_ship" ]] || [[ -f "$legacy_tools" ]]; then
        log_check warn "Config" "Legacy format detected"
        if [[ -f "$legacy_ship" ]]; then log_check info "Legacy" ".matrx-ship.json"; fi
        if [[ -f "$legacy_tools" ]]; then log_check info "Legacy" ".matrx-tools.conf"; fi
    else
        log_check info "Config" "Not found (Fresh install)"
    fi
}

check_environment_all() {
    echo ""
    echo -e "${BLUE}${BOLD}🔍 Verifying Environment...${NC}"
    echo -e "${DIM}   Root: ${PROJECT_ROOT}${NC}"
    
    check_system_deps
    check_project_context
    check_existing_install
    check_config_status
    
    echo ""
    return 0
}

# Execute if run directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    check_environment_all
fi
