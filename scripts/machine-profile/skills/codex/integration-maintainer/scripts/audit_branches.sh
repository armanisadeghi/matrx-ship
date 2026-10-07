#!/usr/bin/env bash
set -euo pipefail

if (( $# == 0 )); then
  echo "usage: $0 <repo> [<repo> ...]" >&2
  exit 2
fi

classify_ref() {
  local repo=$1
  local canonical=$2
  local ref=$3
  local disposition unique files updated subject short_ref

  short_ref=$(git -C "$repo" for-each-ref --format='%(refname:short)' "$ref")
  updated=$(git -C "$repo" log -1 --format='%cI' "$ref")
  subject=$(git -C "$repo" log -1 --format='%s' "$ref" | tr '\t\n' '  ')

  if git -C "$repo" merge-base --is-ancestor "$ref" "$canonical"; then
    disposition="contained"
    unique=0
  else
    unique=$(git -C "$repo" cherry "$canonical" "$ref" | grep -c '^+' || true)
    if (( unique == 0 )); then
      disposition="patch-equivalent"
    elif git -C "$repo" diff --quiet "$canonical" "$ref"; then
      disposition="tree-empty"
    else
      disposition="unique"
    fi
  fi

  files=$(git -C "$repo" diff --name-only "$canonical"..."$ref" | wc -l | tr -d ' ')
  printf 'ref\t%s\t%s\tunique=%s\tfiles=%s\t%s\t%s\n' \
    "$disposition" "$updated" "$unique" "$files" "$short_ref" "$subject"
}

for repo in "$@"; do
  if ! git -C "$repo" rev-parse --git-dir >/dev/null 2>&1; then
    printf 'invalid-repository\t%s\n' "$repo" >&2
    continue
  fi

  printf 'repository\t%s\n' "$repo"
  git -C "$repo" fetch --prune origin

  canonical=refs/remotes/origin/main
  if ! git -C "$repo" show-ref --verify --quiet "$canonical"; then
    printf 'missing-canonical-ref\t%s\n' "$canonical" >&2
    continue
  fi

  primary_branch=$(git -C "$repo" symbolic-ref --quiet --short HEAD || printf 'DETACHED')
  primary_head=$(git -C "$repo" rev-parse --short HEAD)
  primary_dirty=$(git -C "$repo" status --porcelain=v1 --untracked-files=all | wc -l | tr -d ' ')
  printf 'primary\tbranch=%s\thead=%s\tdirty=%s\n' "$primary_branch" "$primary_head" "$primary_dirty"
  git -C "$repo" status --short --branch

  if git -C "$repo" show-ref --verify --quiet refs/heads/main; then
    printf 'main-divergence\t'
    git -C "$repo" rev-list --left-right --count refs/heads/main..."$canonical"
  else
    printf 'missing-local-main\trefs/heads/main\n'
  fi

  stash_count=$(git -C "$repo" stash list | wc -l | tr -d ' ')
  printf 'stashes\tcount=%s\n' "$stash_count"
  if (( stash_count > 0 )); then
    git -C "$repo" stash list --date=iso-strict
  fi

  while IFS= read -r worktree_path; do
    worktree_branch=$(git -C "$worktree_path" symbolic-ref --quiet --short HEAD || printf 'DETACHED')
    worktree_head=$(git -C "$worktree_path" rev-parse --short HEAD)
    worktree_dirty=$(git -C "$worktree_path" status --porcelain=v1 --untracked-files=all | wc -l | tr -d ' ')
    printf 'worktree\tpath=%s\tbranch=%s\thead=%s\tdirty=%s\n' \
      "$worktree_path" "$worktree_branch" "$worktree_head" "$worktree_dirty"
  done < <(git -C "$repo" worktree list --porcelain | sed -n 's/^worktree //p')

  while IFS= read -r ref; do
    [[ "$ref" != refs/remotes/origin/HEAD ]] || continue
    [[ "$ref" != "$canonical" ]] || continue
    classify_ref "$repo" "$canonical" "$ref"
  done < <(git -C "$repo" for-each-ref --format='%(refname)' refs/heads refs/remotes/origin)

  if command -v gh >/dev/null 2>&1 && gh auth status --hostname github.com >/dev/null 2>&1; then
    remote_url=$(git -C "$repo" remote get-url origin)
    if [[ "$remote_url" =~ github\.com[:/]([^/]+/[^/.]+)(\.git)?$ ]]; then
      github_repo=${BASH_REMATCH[1]}
      printf 'open-prs\trepository=%s\n' "$github_repo"
      gh pr list --repo "$github_repo" --state open \
        --json number,headRefName,baseRefName,updatedAt,title \
        --template '{{range .}}pr\t#{{.number}}\t{{.headRefName}}->{{.baseRefName}}\t{{.updatedAt}}\t{{.title}}{{"\n"}}{{end}}'
    else
      printf 'open-prs\tskipped=unrecognized-github-remote\n'
    fi
  else
    printf 'open-prs\tskipped=github-cli-unavailable-or-unauthenticated\n'
  fi
done
