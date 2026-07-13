#!/bin/bash

# Configuration
TARGET_DIR="${1:-.}" # Use first argument or current directory
cd "$TARGET_DIR" || { echo "Directory not found"; exit 1; }

# Smart check: if no git repos found here, try going up one level
HAS_REPOS=false
for d in */ ; do
    [ -d "${d}.git" ] && { HAS_REPOS=true; break; }
done
if [ "$HAS_REPOS" = false ]; then
    echo -e "No git repos found in $(pwd), trying parent directory..."
    cd .. || { echo "Cannot navigate to parent directory"; exit 1; }
fi

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Arrays to store results for summary
declare -a SUCCESS_REPOS
declare -a UPDATED_REPOS
declare -a DIRTY_REPOS
declare -a DIRTY_PATHS
declare -a FAILED_REPOS
declare -a FAILED_PATHS
declare -a SKIP_REPOS

echo -e "${BOLD}Checking repositories in $(pwd)...${NC}"
echo "---------------------------------------------------"

# Loop through directories
for d in */ ; do
    [ -L "${d%/}" ] && continue # Skip symlinks if desired, or keep them. Let's keep specific logic simple.
    d=${d%/} # remove trailing slash
    
    if [ -d "$d/.git" ]; then
        # Go into dir
        cd "$d" || continue
        
        # Check current branch
        BRANCH=$(git branch --show-current)
        
        # Check status (porcelain gives empty string if clean)
        STATUS=$(git status --porcelain)
        
        if [[ -n "$STATUS" ]]; then
            # DIRTY: Report and skip pull
            echo -e "📂 ${BOLD}$d${NC} ($BRANCH): ${YELLOW}Has local changes${NC} -> ${YELLOW}Skipping pull${NC}"
            DIRTY_REPOS+=("$d ($BRANCH)")
            DIRTY_PATHS+=("$d")
        else
            # CLEAN: Try to pull
            # Capture output to check if it was actually updated or just up-to-date
            # We use a temp file or variable. Variable is fine.
            if OUTPUT=$(git pull 2>&1); then
                if [[ "$OUTPUT" == *"Already up to date."* ]]; then
                    echo -e "📂 ${BOLD}$d${NC} ($BRANCH): ${GREEN}Clean & Up to date${NC}"
                    SUCCESS_REPOS+=("$d")
                else
                    echo -e "📂 ${BOLD}$d${NC} ($BRANCH): ${BLUE}Successfully Updated${NC}"
                    UPDATED_REPOS+=("$d ($BRANCH)")
                fi
            else
                # Pull failed (e.g. no upstream, merge conflict, network)
                echo -e "📂 ${BOLD}$d${NC} ($BRANCH): ${RED}Pull Failed${NC}"
                FAILED_REPOS+=("$d ($BRANCH)")
                FAILED_PATHS+=("$d")
            fi
        fi
        
        cd ..
    fi
done

echo ""
echo "==================================================="
echo -e "${BOLD}           SUMMARY REPORT               ${NC}"
echo "==================================================="

# 1. Action Needed / Issues (Prioritized)
if [ ${#FAILED_REPOS[@]} -gt 0 ]; then
    echo -e "${RED}❌ FAILED TO PULL (Check network/upstream):${NC}"
    printf '   %s\n' "${FAILED_REPOS[@]}"
    echo ""
fi

if [ ${#DIRTY_REPOS[@]} -gt 0 ]; then
    echo -e "${YELLOW}⚠️  NEEDS ATTENTION (Local changes present, not pulled):${NC}"
    printf '   %s\n' "${DIRTY_REPOS[@]}"
    echo ""
fi

# 2. Updates
if [ ${#UPDATED_REPOS[@]} -gt 0 ]; then
    echo -e "${BLUE}⬇️  UPDATED (New changes pulled):${NC}"
    printf '   %s\n' "${UPDATED_REPOS[@]}"
    echo ""
fi

# 3. All Good
if [ ${#SUCCESS_REPOS[@]} -gt 0 ]; then
    echo -e "${GREEN}✅ ALL GOOD (Clean & Up to date):${NC}"
    # Summarize count instead of listing all if there are many, or list if few. 
    # For now, list them to be explicit as requested.
    printf '   %s\n' "${SUCCESS_REPOS[@]}"
fi

echo "==================================================="

# Save base directory for walkthrough
BASE_DIR=$(pwd)

# ── Helper Functions ──────────────────────────────────────────────

do_pull() {
    # Safely pull even with dirty working tree: stash → pull → unstash
    local had_stash=false
    local stash_output
    stash_output=$(git stash 2>&1)
    if [[ "$stash_output" != *"No local changes"* ]]; then
        had_stash=true
        echo -e "  ${BLUE}↳ Stashed local changes${NC}"
    fi

    echo -e "  ${BLUE}↳ Pulling...${NC}"
    if git pull 2>&1; then
        echo -e "  ${GREEN}↳ Pull succeeded${NC}"
    else
        echo -e "  ${RED}↳ Pull failed!${NC}"
        if $had_stash; then
            git stash pop --quiet 2>/dev/null
            echo -e "  ${YELLOW}↳ Restored stashed changes${NC}"
        fi
        return 1
    fi

    if $had_stash; then
        if git stash pop 2>&1; then
            echo -e "  ${GREEN}↳ Restored stashed changes${NC}"
        else
            echo -e "  ${RED}↳ Stash pop had conflicts — resolve manually${NC}"
            return 1
        fi
    fi
    return 0
}

do_commit_push() {
    # Add all → prompt commit message → commit → push
    echo ""
    read -r -p "  Commit message: " COMMIT_MSG
    if [[ -z "$COMMIT_MSG" ]]; then
        echo -e "  ${YELLOW}↳ Empty message — skipping commit${NC}"
        return 1
    fi

    git add -A
    echo -e "  ${BLUE}↳ Staged all changes${NC}"

    if git commit -m "$COMMIT_MSG" 2>&1; then
        echo -e "  ${GREEN}↳ Committed${NC}"
    else
        echo -e "  ${RED}↳ Commit failed${NC}"
        return 1
    fi

    echo -e "  ${BLUE}↳ Pushing...${NC}"
    if git push 2>&1; then
        echo -e "  ${GREEN}↳ Pushed successfully${NC}"
    else
        echo -e "  ${RED}↳ Push failed (check remote/permissions)${NC}"
        return 1
    fi
    return 0
}

do_discard_pull() {
    # Backup changes to a named stash (including untracked), then pull
    echo ""
    echo -e "  ${RED}⚠️  This will discard ALL local changes (modified + untracked files).${NC}"
    echo -e "  ${YELLOW}  Changes are backed up to git stash and recoverable with 'git stash list'.${NC}"
    echo ""
    read -r -p "  Type 'yes' to confirm: " CONFIRM
    if [[ "$CONFIRM" != "yes" ]]; then
        echo -e "  ${YELLOW}↳ Cancelled${NC}"
        return 1
    fi

    TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "  ${BLUE}↳ Backing up changes to stash...${NC}"
    if git stash push -u -m "pull.sh auto-backup before discard ($TIMESTAMP)" 2>&1; then
        echo -e "  ${GREEN}↳ Changes backed up (recoverable via 'git stash list')${NC}"
    else
        echo -e "  ${RED}↳ Stash failed — aborting to be safe${NC}"
        return 1
    fi

    echo -e "  ${BLUE}↳ Pulling...${NC}"
    if git pull 2>&1; then
        echo -e "  ${GREEN}↳ Pull succeeded${NC}"
    else
        echo -e "  ${RED}↳ Pull failed${NC}"
        return 1
    fi
    return 0
}

# ── Interactive Walkthrough ───────────────────────────────────────

if [ ${#DIRTY_PATHS[@]} -gt 0 ]; then
    echo ""
    TOTAL=${#DIRTY_PATHS[@]}
    echo -e "${BOLD}Found $TOTAL repo(s) with local changes.${NC}"
    read -p "Walk through them? (Y/n) " WALK_ANSWER
    WALK_ANSWER=${WALK_ANSWER:-Y}

    if [[ "$WALK_ANSWER" =~ ^[Yy]$ ]]; then
        for i in "${!DIRTY_PATHS[@]}"; do
            REPO="${DIRTY_PATHS[$i]}"
            NUM=$((i + 1))
            echo ""
            echo "=================================================="
            echo -e "${BOLD}[$NUM/$TOTAL] 📂 $REPO${NC}"
            echo "=================================================="
            cd "$BASE_DIR/$REPO" || continue

            # Detect if branch is behind remote
            git fetch --quiet 2>/dev/null
            LOCAL_REV=$(git rev-parse @ 2>/dev/null)
            REMOTE_REV=$(git rev-parse @{u} 2>/dev/null)
            BASE_REV=$(git merge-base @ @{u} 2>/dev/null)
            BEHIND_LABEL=""
            if [[ "$LOCAL_REV" != "$REMOTE_REV" && "$LOCAL_REV" == "$BASE_REV" ]]; then
                BEHIND_COUNT=$(git rev-list --count @..@{u} 2>/dev/null)
                BEHIND_LABEL=" ${RED}(${BEHIND_COUNT} commit(s) behind remote)${NC}"
            fi

            # Action loop — lets you pull first, then decide what to do next
            while true; do
                git status
                [[ -n "$BEHIND_LABEL" ]] && echo -e "$BEHIND_LABEL"
                echo ""

                # Show action menu
                echo -e "  ${BOLD}Actions:${NC}"
                echo -e "    ${GREEN}[p]${NC} Pull & decide    (stash → pull → unstash, then choose again)"
                echo -e "    ${GREEN}[c]${NC} Commit & push    (add all → commit → push)"
                echo -e "    ${GREEN}[b]${NC} Pull + commit & push"
                echo -e "    ${RED}[d]${NC} Discard & pull   (backup to stash → clean → pull)"
                echo -e "    ${YELLOW}[s]${NC} Skip             (next repo)"
                echo -e "    ${RED}[q]${NC} Stay here        (exit walkthrough into this repo)"
                echo ""
                read -r -p "  Choose [p/c/b/d/s/q] (default: s): " ACTION
                ACTION=${ACTION:-s}

                case "$ACTION" in
                    p)
                        do_pull
                        BEHIND_LABEL=""  # Clear since we just pulled
                        echo ""
                        echo -e "  ${BLUE}──── Updated status ────${NC}"
                        continue  # Loop back to show status + menu again
                        ;;
                    c)
                        do_commit_push
                        break
                        ;;
                    b)
                        if do_pull; then
                            do_commit_push
                        else
                            echo -e "  ${YELLOW}↳ Skipping commit & push due to pull issues${NC}"
                        fi
                        break
                        ;;
                    d)
                        do_discard_pull
                        break
                        ;;
                    q)
                        echo ""
                        echo -e "${GREEN}Dropped into ${BOLD}$REPO${NC}${GREEN}. Happy hacking!${NC}"
                        exec bash
                        ;;
                    *)
                        echo -e "  ${YELLOW}↳ Skipped${NC}"
                        break
                        ;;
                esac
            done

            # After action, pause before next repo (unless it's the last)
            if [ $NUM -eq $TOTAL ]; then
                echo ""
                echo -e "${GREEN}✅ Walkthrough complete!${NC}"
            else
                echo ""
                echo -e "${YELLOW}Press Enter for next repo...${NC}"
                read -r
            fi
        done
    fi
fi

# ── Walkthrough for Failed Repos ──────────────────────────────────

if [ ${#FAILED_PATHS[@]} -gt 0 ]; then
    echo ""
    TOTAL_F=${#FAILED_PATHS[@]}
    echo -e "${RED}${BOLD}Found $TOTAL_F repo(s) that failed to pull.${NC}"
    read -p "Walk through them? (Y/n) " FAIL_ANSWER
    FAIL_ANSWER=${FAIL_ANSWER:-Y}

    if [[ "$FAIL_ANSWER" =~ ^[Yy]$ ]]; then
        for i in "${!FAILED_PATHS[@]}"; do
            REPO="${FAILED_PATHS[$i]}"
            NUM=$((i + 1))
            echo ""
            echo "=================================================="
            echo -e "${BOLD}[${NUM}/${TOTAL_F}] ❌ $REPO${NC}"
            echo "=================================================="
            cd "$BASE_DIR/$REPO" || continue

            BRANCH=$(git branch --show-current)
            echo -e "  Branch: ${YELLOW}$BRANCH${NC}"

            # Check if the tracking branch exists on remote
            REMOTE_REF=$(git ls-remote --heads origin "$BRANCH" 2>/dev/null)
            if [[ -z "$REMOTE_REF" ]]; then
                echo -e "  ${RED}⚠ Remote branch '$BRANCH' no longer exists!${NC}"
            fi

            # Show available remote branches
            echo -e "  ${BLUE}Remote branches:${NC}"
            git branch -r --no-color 2>/dev/null | head -10 | sed 's/^/    /'

            # Show error detail
            echo ""
            echo -e "  ${BLUE}Pull error:${NC}"
            git pull 2>&1 | sed 's/^/    /'
            echo ""

            # Show action menu
            echo -e "  ${BOLD}Actions:${NC}"
            echo -e "    ${GREEN}[m]${NC} Switch to main   (checkout main → pull)"
            echo -e "    ${GREEN}[r]${NC} Retry pull       (try pulling again)"
            echo -e "    ${YELLOW}[s]${NC} Skip             (next repo)"
            echo -e "    ${RED}[q]${NC} Stay here        (exit into this repo)"
            echo ""
            read -r -p "  Choose [m/r/s/q] (default: s): " FACTION
            FACTION=${FACTION:-s}

            case "$FACTION" in
                m)
                    echo -e "  ${BLUE}↳ Switching to main...${NC}"
                    if git checkout main 2>&1; then
                        echo -e "  ${GREEN}↳ On main${NC}"
                        echo -e "  ${BLUE}↳ Pulling...${NC}"
                        if git pull 2>&1; then
                            echo -e "  ${GREEN}↳ Pull succeeded${NC}"
                        else
                            echo -e "  ${RED}↳ Pull still failing${NC}"
                        fi
                    else
                        echo -e "  ${RED}↳ Checkout failed${NC}"
                    fi
                    ;;
                r)
                    echo -e "  ${BLUE}↳ Retrying pull...${NC}"
                    if git pull 2>&1; then
                        echo -e "  ${GREEN}↳ Pull succeeded${NC}"
                    else
                        echo -e "  ${RED}↳ Pull still failing${NC}"
                    fi
                    ;;
                q)
                    echo ""
                    echo -e "${GREEN}Dropped into ${BOLD}$REPO${NC}${GREEN}. Happy hacking!${NC}"
                    exec bash
                    ;;
                *)
                    echo -e "  ${YELLOW}↳ Skipped${NC}"
                    ;;
            esac

            if [ $NUM -eq $TOTAL_F ]; then
                echo ""
                echo -e "${GREEN}✅ Failed repo walkthrough complete!${NC}"
            else
                echo ""
                echo -e "${YELLOW}Press Enter for next repo...${NC}"
                read -r
            fi
        done
    fi
fi
