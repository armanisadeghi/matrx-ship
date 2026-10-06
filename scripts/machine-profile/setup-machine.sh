#!/usr/bin/env bash
# Safe workstation bootstrap for the committed AI Matrx machine profile.
# It never imports host-bound scheduler identities or overwrites local state.
set -euo pipefail

mode="check"
case "${1:---check}" in
  --check) ;;
  --install) mode="install" ;;
  *) echo "usage: $0 [--check|--install]" >&2; exit 64 ;;
esac

profile_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
code_root="${CODE_ROOT:-$(cd "$profile_dir/../../.." && pwd)}"
portable_root="$HOME/Code"
claude_root="$HOME/.claude"
codex_root="$HOME/.codex"
launchd_root="$HOME/Library/LaunchAgents"

missing=()
manual=()
changed=0
codex_template_count=0

for command in gh vercel pnpm uv node python3 supabase; do
  command -v "$command" >/dev/null 2>&1 || missing+=("$command")
done

same_or_missing() {
  local source="$1" destination="$2"
  [[ ! -e "$destination" ]] || cmp -s "$source" "$destination"
}

render_template() {
  sed -e "s|__CODE_ROOT__|$code_root|g" -e "s|__HOME__|$HOME|g" "$1"
}

install_file() {
  local source="$1" destination="$2" label="$3"
  if [[ -e "$destination" ]] && ! cmp -s <(render_template "$source") "$destination"; then
    manual+=("preserved local $label: $destination differs from the committed profile")
    return
  fi
  if [[ ! -e "$destination" ]]; then
    if [[ "$mode" == "install" ]]; then
      mkdir -p "$(dirname "$destination")"
      render_template "$source" > "$destination"
      changed=$((changed + 1))
    else
      missing+=("$label")
    fi
  fi
}

install_link() {
  local destination="$1" target="$2" label="$3"
  if [[ -L "$destination" ]] && [[ "$(readlink "$destination")" == "$target" ]]; then
    return
  fi
  if [[ -e "$destination" || -L "$destination" ]]; then
    manual+=("preserved local $label: $destination already exists")
    return
  fi
  if [[ "$mode" == "install" ]]; then
    mkdir -p "$(dirname "$destination")"
    ln -s "$target" "$destination"
    changed=$((changed + 1))
  else
    missing+=("$label")
  fi
}

install_link "$portable_root/scripts" "$code_root/matrx-ship/scripts" "~/Code/scripts link"
install_link "$portable_root/CLAUDE.md" "$code_root/common-docs/workspace-root/CLAUDE.md" "~/Code/CLAUDE.md link"

install_file "$profile_dir/config/claude-CLAUDE.md" "$claude_root/CLAUDE.md" "Claude instructions"
install_file "$profile_dir/config/codex-AGENTS.md" "$codex_root/AGENTS.md" "Codex instructions"

while IFS= read -r source; do
  relative="${source#"$profile_dir/claude-scheduled-tasks/"}"
  install_file "$source" "$claude_root/scheduled-tasks/$relative" "Claude task $relative"
done < <(find "$profile_dir/claude-scheduled-tasks" -type f -name SKILL.md | sort)

# TOMLs are templates, not a native Codex import. They intentionally stay out
# of ~/.codex/automations until a local Codex scheduler enrolls a new task.
while IFS= read -r source; do
  name="$(basename "$(dirname "$source")")"
  install_file "$source" "$codex_root/automation-templates/$name.toml" "non-active Codex template $name"
  codex_template_count=$((codex_template_count + 1))
done < <(find "$profile_dir/codex-automations" -type f -name automation.toml | sort)

while IFS= read -r source; do
  name="$(basename "$source")"
  destination="$launchd_root/$name"
  if [[ -e "$destination" ]] && ! cmp -s <(sed -e "s|__CODE_ROOT__|$code_root|g" -e "s|__HOME__|$HOME|g" "$source") "$destination"; then
    manual+=("preserved local launchd job $name: $destination differs from the committed profile")
  elif [[ ! -e "$destination" ]]; then
    if [[ "$mode" == "install" ]]; then
      mkdir -p "$launchd_root"
      sed -e "s|__CODE_ROOT__|$code_root|g" -e "s|__HOME__|$HOME|g" "$source" > "$destination"
      changed=$((changed + 1))
    else
      missing+=("launchd job $name")
    fi
  fi
done < <(find "$profile_dir/launchd" -type f -name '*.plist' | sort)

if [[ "$mode" == "install" ]]; then
  manual+=("launchd job files were copied only; load or enable them locally after reviewing their target checkout")
fi
manual+=("sign in locally where needed: gh auth login; vercel login")
manual+=("Supabase: use existing CLI auth or the connected MCP; if the token expired, repair it through an authorized noninteractive flow (do not run supabase login/logout or recreate a Keychain entry)")
manual+=("Claude schedule cadence/enablement is host runtime state; enroll ship-all-claude at :13 and :43 locally")
manual+=("Codex task/thread/project identities are host-bound; enroll $codex_template_count local schedules from ~/.codex/automation-templates")

echo "Machine profile: $profile_dir"
echo "Mode: $mode"
echo "CLI missing: ${missing[*]:-none}"
echo "Files installed this run: $changed"
printf '%s\n' "Manual actions:"
printf '  - %s\n' "${manual[@]}"
if [[ "$mode" == "check" ]] && ((${#missing[@]})); then
  exit 1
fi
