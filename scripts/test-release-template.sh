#!/usr/bin/env bash
# Guard for the shared release script (release-template.sh, copied into every repo as
# scripts/release.sh): it NEVER refuses a release, and it never touches the working folder.
#
# Builds a throwaway origin + checkout and releases under every condition that used to stop
# one of our release scripts: uncommitted files, staged files, a branch diverged from origin,
# a foreign push landing mid-release, a tag that already exists, a bad flag, local commits
# that conflict, failing after-push checks. Each must still end with the tag on origin.
#
#   scripts/test-release-template.sh                 # test scripts/release-template.sh
#   scripts/test-release-template.sh <release.sh>    # test a repo's copy (or an old script)
set -uo pipefail

UNDER_TEST="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/release-template.sh}"
UNDER_TEST="$(cd "$(dirname "$UNDER_TEST")" && pwd)/$(basename "$UNDER_TEST")"
SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT
export HOME="$SANDBOX/home"; mkdir -p "$HOME"
export GIT_CONFIG_GLOBAL="$SANDBOX/gitconfig"
git config --global user.name test; git config --global user.email test@test
git config --global init.defaultBranch main; git config --global core.hooksPath /dev/null
FAILED=0
check() { if eval "$2"; then echo "  ok    $1"; else echo "  FAIL  $1"; FAILED=1; fi; }

# new_repo NAME SETTINGS-SED  → origin + checkout + "other" writer, seeded
new_repo() {
    local name="$1" settings="$2"
    R="$SANDBOX/$name"; mkdir -p "$R"
    git init -q --bare "$R/origin.git"
    git clone -q "$R/origin.git" "$R/checkout" 2>/dev/null
    cd "$R/checkout"
    mkdir -p scripts
    # Every case starts from plain "v" tags and no extras, whatever the repo copy's settings;
    # a case that needs others sets them in its own sed.
    sed 's/^TAG_PREFIX=.*/TAG_PREFIX="v"/; s/^EXTRA_VERSION_FILES=.*/EXTRA_VERSION_FILES=()/; s/^CHANGELOG=.*/CHANGELOG=""/; s/^AFTER_PUSH=.*/AFTER_PUSH=""/' "$UNDER_TEST" \
        | sed "$settings" > scripts/release.sh
    printf '{\n  "name": "x",\n  "version": "0.1.0",\n  "dependencies": {"y": {"version": "9.9.9"}}\n}\n' > package.json
    echo "shared" > shared.txt
    git add -A; git commit -qm seed; git push -q origin main 2>/dev/null
    git clone -q "$R/origin.git" "$R/other" 2>/dev/null
}
release() { bash scripts/release.sh "$@" > "$R/out" 2>&1; echo $? > "$R/status"; }
on_origin() { git --git-dir="$R/origin.git" show "main:$1" 2>/dev/null; }

# ── 1. dirty + staged + diverged + foreign push mid-release + bad flag ─────────
new_repo one 's/^VERSION_FILE=.*/VERSION_FILE="package.json"/'
( cd "$R/other" && echo theirs > theirs.txt && git add -A && git commit -qm theirs && git push -q origin main )
echo mine > mine.txt; git add mine.txt; git commit -qm mine
echo "uncommitted work" >> shared.txt
echo staged > staged.txt; git add staged.txt
export RELEASE_TEST_BEFORE_PUSH="[ -f '$R/raced' ] || { touch '$R/raced'; cd '$R/other' && git pull -q origin main && echo race > race.txt && git add -A && git commit -qm race && git push -q origin main; }"
release --bogus-flag --message "a note"
unset RELEASE_TEST_BEFORE_PUSH
echo "release — dirty, staged, diverged, raced, bad flag"
check "exit 0"                                  '[[ $(cat "$R/status") -eq 0 ]]'
check "tag v0.1.1 is on origin"                 'git ls-remote --tags origin | grep -q "refs/tags/v0.1.1$"'
check "origin carries version 0.1.1"            'on_origin package.json | grep -q "\"version\": \"0.1.1\""'
check "a nested version field is untouched"     'on_origin package.json | grep -q "\"version\": \"9.9.9\""'
check "the commit message carries the note"     '[[ "$(git --git-dir="$R/origin.git" log -1 --format=%s main)" == "release: v0.1.1 - a note" ]]'
check "the local commit shipped"                'on_origin mine.txt >/dev/null'
check "the foreign mid-release push survived"   'on_origin race.txt >/dev/null'
check "the push race really happened"           '[[ -f "$R/raced" ]]'
check "uncommitted work never shipped"          '! on_origin shared.txt | grep -q "uncommitted work"'
check "uncommitted work never touched"          'grep -q "uncommitted work" shared.txt'
check "staged work never shipped"               '! on_origin staged.txt >/dev/null'
check "nothing stashed, no branch, no worktree" '[[ -z "$(git stash list)" && $(git branch | wc -l) -eq 1 && $(git worktree list | wc -l) -eq 1 ]]'
check "the bad flag is a WARNING in a section"  'grep -q "^WARNING  Invocation   Unknown flag" "$R/out" && grep -qx "==================== End of Invocation ====================" "$R/out"'
check "no INFO chatter"                         '! grep -qiE "\[info\]|\[ok\]" "$R/out"'
check "the ship line"                           'grep -qE "^v0\.1\.1  pushed  \([0-9]+s\)$" "$R/out"'

# ── 2. the next tag already exists → the next free one ships ─────────────────
( cd "$R/other" && git pull -q origin main && git tag v0.1.2 && git push -q origin v0.1.2 )
release
echo "release — the next tag is taken"
check "exit 0"                                  '[[ $(cat "$R/status") -eq 0 ]]'
check "v0.1.3 shipped, v0.1.2 not moved"        'git ls-remote --tags origin | grep -q "refs/tags/v0.1.3$" && [[ "$(git ls-remote --tags origin v0.1.2 | cut -f1)" == "$(git --git-dir="$R/other/.git" rev-parse v0.1.2)" ]]'

# ── 3. local commits that conflict → ERROR, main still ships ─────────────────
( cd "$R/other" && git pull -q origin main && echo "theirs v2" > conflict.txt && git add -A && git commit -qm c1 && git push -q origin main )
git checkout -q -- shared.txt 2>/dev/null; echo "mine v2" > conflict.txt; git add conflict.txt; git commit -qm c2 -- conflict.txt
release
echo "release — local commits conflict"
check "exit 0"                                  '[[ $(cat "$R/status") -eq 0 ]]'
check "v0.1.4 shipped"                          'git ls-remote --tags origin | grep -q "refs/tags/v0.1.4$"'
check "the conflict is an ERROR under Git"      'grep -q "^ERROR    Git          Local commits conflict" "$R/out"'
check "no merge left in progress"               '[[ ! -f .git/MERGE_HEAD ]]'

# ── 4. plain VERSION file, pyproject extra, changelog, failing after-push checks ─
new_repo two 's/^VERSION_FILE=.*/VERSION_FILE="VERSION"/; s/^EXTRA_VERSION_FILES=.*/EXTRA_VERSION_FILES=("sub\/pyproject.toml" "missing.json")/; s/^CHANGELOG=.*/CHANGELOG="CHANGELOG.md"/; s/^AFTER_PUSH=.*/AFTER_PUSH="echo checking; exit 1"/; s/^TAG_PREFIX=.*/TAG_PREFIX="pkg--v"/'
echo "1.2.0-alpha.4" > VERSION; mkdir -p sub
printf '[project]\nname = "sub"\nversion = "1.2.0-alpha.4"\n[tool.x]\nversion = "7"\n' > sub/pyproject.toml
printf '# Changelog\n\n## Unreleased\n\n## 1.2.0-alpha.4 - 2026-01-01\n' > CHANGELOG.md
git add -A; git commit -qm files; git push -q origin main
release
echo "release — plain VERSION, pyproject, changelog, failing checks"
check "exit 0"                                  '[[ $(cat "$R/status") -eq 0 ]]'
check "tag pkg--v1.2.0-alpha.5 on origin"       'git ls-remote --tags origin | grep -q "refs/tags/pkg--v1.2.0-alpha.5$"'
check "VERSION bumped"                          '[[ "$(on_origin VERSION)" == "1.2.0-alpha.5" ]]'
check "pyproject [project] version bumped only" 'on_origin sub/pyproject.toml | grep -q "^version = \"1.2.0-alpha.5\"" && on_origin sub/pyproject.toml | grep -q "^version = \"7\""'
check "changelog heading added"                 'on_origin CHANGELOG.md | grep -q "^## 1.2.0-alpha.5 - "'
check "a missing extra file is a WARNING"       'grep -q "^WARNING  Version      missing.json is not in the repository" "$R/out"'
check "failing checks are an ERROR, after push" 'grep -q "^ERROR    Checks       After-push checks failed" "$R/out" && grep -qx "==================== Checks ====================" "$R/out"'
check "checks output stays in the log"          '! grep -q "^checking$" "$R/out"'

# ── 5. a repo with no VERSION file yet ───────────────────────────────────────
new_repo three 's/^VERSION_FILE=.*/VERSION_FILE="VERSION"/'
release
echo "release — no VERSION file yet"
check "exit 0 and v0.0.1 on origin"             '[[ $(cat "$R/status") -eq 0 ]] && [[ "$(on_origin VERSION)" == "0.0.1" ]]'

# ── 7. the independent review's defects (2026-09-24), one repo each ─────────
# a. a nested "version" before the top-level one; ahead-only history; hooks that deny/hang
new_repo seven 's/^VERSION_FILE=.*/VERSION_FILE="package.json"/'
printf '{"name":"x","engines":{"version":"18.0.0"},"version":"1.0.0"}\n' > package.json
mkdir -p .githooks; printf '#!/bin/sh\nexit 1\n' > .githooks/pre-push; printf '#!/bin/sh\ntouch "%s/post-merge-ran"\n' "$R" > .githooks/post-merge
chmod +x .githooks/*; git add -A; git commit -qm nested; git push -q origin main
git config core.hooksPath .githooks
echo ahead > ahead.txt; git add ahead.txt; git -c core.hooksPath=/dev/null commit -qm ahead
release
echo "release — nested version, pre-push hook, ahead-only"
check "exit 0 despite a denying pre-push hook"  '[[ $(cat "$R/status") -eq 0 ]] && git ls-remote --tags origin | grep -q "refs/tags/v1.0.1$"'
check "the TOP-LEVEL version was bumped"        'on_origin package.json | grep -q "\"engines\":{\"version\":\"18.0.0\"},\"version\":\"1.0.1\""'
check "no hook ran in the shared checkout"      '[[ ! -f "$R/post-merge-ran" ]]'
check "ahead-only: one parent, no empty merge"  '[[ $(git --git-dir="$R/origin.git" log -1 --format=%p main | wc -w) -eq 1 ]]'
git config --unset core.hooksPath

# b. pyproject with a tool table first; an executable plain file; a non-JSON extra; CRLF [Unreleased]
new_repo eight 's/^VERSION_FILE=.*/VERSION_FILE="VERSION"/; s/^EXTRA_VERSION_FILES=.*/EXTRA_VERSION_FILES=("pyproject.toml" "Cargo.toml")/; s/^CHANGELOG=.*/CHANGELOG="CHANGELOG.md"/'
printf '2.3.0\r\n' > VERSION; chmod +x VERSION
printf '[tool.commitizen]\nversion = "0.0.9"\n\n[project]\nname = "p"\nversion = "2.3.0"\n' > pyproject.toml
printf '[package]\nname = "c"\nversion = "2.3.0"\n' > Cargo.toml
printf '# Changelog\r\n\r\n## [Unreleased]\r\n\r\n## [2.3.0] - 2026-01-01\r\n' > CHANGELOG.md
git add -A; git commit -qm files; git push -q origin main
( cd "$R/other" && git pull -q origin main && git tag v2.3.1 && git push -q origin v2.3.1 )
bash scripts/release.sh --dry-run > "$R/dry" 2>&1
release
echo "release — pyproject tables, file mode, non-JSON extra, CRLF changelog, dry run"
check "dry run names the next FREE tag"         'grep -q "would release v2.3.2" "$R/dry"'
check "exit 0 and v2.3.2 shipped"               '[[ $(cat "$R/status") -eq 0 ]] && git ls-remote --tags origin | grep -q "refs/tags/v2.3.2$"'
check "[project] bumped, tool table untouched"  'on_origin pyproject.toml | grep -q "^version = \"2.3.2\"" && on_origin pyproject.toml | grep -q "^version = \"0.0.9\""'
check "CRLF kept in VERSION"                    '[[ "$(on_origin VERSION | od -c | head -1)" == *"\r  \n"* ]]'
check "executable mode kept"                    '[[ "$(git --git-dir="$R/origin.git" ls-tree main VERSION | cut -c1-6)" == 100755 ]]'
check "a non-JSON extra is untouched + WARNING" 'on_origin Cargo.toml | grep -q "^version = \"2.3.0\"" && grep -q "Cargo.toml is neither JSON nor a pyproject.toml" "$R/out"'
check "[Unreleased] (CRLF) got its heading"     'on_origin CHANGELOG.md | grep -q "^## 2.3.2 - " && ! grep -q "Unreleased. heading" "$R/out"'

# c. a misconfigured JSON version file must stop, never ship 0.0.1
new_repo nine 's/^VERSION_FILE=.*/VERSION_FILE="app\/package.json"/'
release
echo "release — misconfigured version file"
check "stops: version unreadable, nothing tagged" '[[ $(cat "$R/status") -eq 1 ]] && grep -q "cannot read the version" "$R/out" && ! git ls-remote --tags origin | grep -q refs/tags/'

# d. an origin with no main branch says so
new_repo ten 's/^VERSION_FILE=.*/VERSION_FILE="package.json"/'
git --git-dir="$R/origin.git" branch -m main trunk 2>/dev/null; git --git-dir="$R/origin.git" symbolic-ref HEAD refs/heads/trunk
release
echo "release — origin without main"
check "the stop names the missing branch"       '[[ $(cat "$R/status") -eq 1 ]] && grep -q "has no '"'"'main'"'"' branch" "$R/out"'

# ── 6. GitHub unreachable → the one honest stop ──────────────────────────────
git remote set-url origin "$SANDBOX/nowhere.git"
release
echo "release — GitHub unreachable"
check "exit 1 and says NOT RELEASED"            '[[ $(cat "$R/status") -eq 1 ]] && grep -q "NOT RELEASED — cannot reach GitHub" "$R/out"'

if [[ $FAILED -ne 0 ]]; then echo "--- last output ---"; cat "$R/out"; exit 1; fi
echo "all checks passed"
