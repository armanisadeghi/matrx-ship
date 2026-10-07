#!/usr/bin/env bash
# Safe, idempotent workstation bootstrap for the committed AI Matrx machine profile.
#
#   --check    (default) report parity; change nothing; exit 1 if anything is missing
#   --drift    print ONLY files whose local copy differs from the repo; change nothing; exit 0
#              (ship-all runs this to warn; it never rewrites an active configuration)
#   --install  install what is absent (CLIs, files, links); never touch a differing file
#   --sync     --install, and also replace differing profile files AFTER backing each up
#              to <file>.pre-profile-<timestamp> (settings.json / codex config are never
#              replaced: they hold per-machine credentials and host state)
#
# The profile holds no secrets. Credential NAMES are in CREDENTIALS.md; values come from
# the vault or the gitignored .env files. Host-bound scheduler enrollment is never imported.
set -euo pipefail

mode="check"
case "${1:---check}" in
  --check) ;;
  --drift) mode="drift" ;;
  --install) mode="install" ;;
  --sync) mode="sync" ;;
  *) echo "usage: $0 [--check|--drift|--install|--sync]" >&2; exit 64 ;;
esac
writes=0; [[ "$mode" == "install" || "$mode" == "sync" ]] && writes=1

profile_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
code_root="${CODE_ROOT:-$(cd "$profile_dir/../../.." && pwd)}"
portable_root="${PORTABLE_ROOT:-$HOME/Code}"
claude_root="$HOME/.claude"
codex_root="$HOME/.codex"
launchd_root="$HOME/Library/LaunchAgents"
stamp="$(date +%Y%m%d-%H%M%S)"

missing=(); differs=(); manual=(); installed=(); ok=0
codex_template_count=0; optional_absent=0

note_ok() { ok=$((ok + 1)); }
render_template() { sed -e "s|__CODE_ROOT__|$code_root|g" -e "s|__HOME__|$HOME|g" "$1"; }

# install_file SRC DEST LABEL [replace-ok|keep-local]
install_file() {
  local source="$1" destination="$2" label="$3" policy="${4:-replace-ok}"
  if [[ -e "$destination" ]]; then
    if cmp -s <(render_template "$source") "$destination"; then note_ok; return; fi
    if [[ "$policy" == "keep-local" ]]; then
      note_ok
      manual+=("$label differs from the profile template by design (per-machine credentials/host state): $destination")
      return
    fi
    differs+=("$label: $destination")
    if [[ "$mode" == "sync" ]]; then
      cp -p "$destination" "$destination.pre-profile-$stamp"
      render_template "$source" > "$destination"
      [[ -x "$source" ]] && chmod +x "$destination"
      installed+=("replaced $label (backup: $destination.pre-profile-$stamp)")
    fi
    return
  fi
  if ((writes)); then
    mkdir -p "$(dirname "$destination")"
    render_template "$source" > "$destination"
    [[ -x "$source" ]] && chmod +x "$destination"
    installed+=("installed $label")
  elif [[ "$policy" == "optional" ]]; then
    optional_absent=$((optional_absent + 1))
  else
    missing+=("$label")
  fi
}

# install_link DEST TARGET LABEL
install_link() {
  local destination="$1" target="$2" label="$3"
  if [[ -L "$destination" ]] && [[ "$(readlink "$destination")" == "$target" ]]; then note_ok; return; fi
  if [[ -e "$destination" || -L "$destination" ]]; then
    # a real directory/file that already resolves to the same content counts as present
    if [[ -e "$destination" && "$destination" -ef "$target" ]]; then note_ok; return; fi
    # a real scripts directory whose ship-all.sh already resolves into the profile target counts as present
    if [[ -d "$destination" && -e "$destination/ship-all.sh" && "$destination/ship-all.sh" -ef "$target/ship-all.sh" ]]; then note_ok; return; fi
    manual+=("preserved local $label: $destination already exists and is not the profile link")
    return
  fi
  if ((writes)); then
    mkdir -p "$(dirname "$destination")"
    ln -s "$target" "$destination"
    installed+=("linked $label")
  else
    missing+=("$label")
  fi
}

# ---------------------------------------------------------------- CLIs
tool_missing=()
need_cli() {
  local cmd="$1" how="$2"
  if command -v "$cmd" >/dev/null 2>&1; then note_ok; return; fi
  if ((writes)); then
    if bash -c "$how" >/dev/null 2>&1 && command -v "$cmd" >/dev/null 2>&1; then
      installed+=("installed CLI $cmd"); return
    fi
    manual+=("could not install $cmd automatically; run: $how")
  fi
  tool_missing+=("$cmd")
}
if [[ "$mode" != "drift" ]]; then
  have_brew=0; command -v brew >/dev/null 2>&1 && have_brew=1
  if ((have_brew)); then
    need_cli gh "brew install gh"
    need_cli node "brew install node"
    need_cli pnpm "brew install pnpm"
    need_cli uv "brew install uv"
    need_cli supabase "brew install supabase/tap/supabase"
    need_cli python3 "brew install python"
  else
    for c in gh node pnpm uv supabase python3; do command -v "$c" >/dev/null 2>&1 && note_ok || tool_missing+=("$c"); done
    manual+=("Homebrew is absent; install it from https://brew.sh, then rerun with --install")
  fi
  need_cli vercel "npm install -g vercel"
fi

# ---------------------------------------------------------------- links
install_link "$portable_root/scripts" "$code_root/matrx-ship/scripts" "~/Code/scripts link"
install_link "$portable_root/CLAUDE.md" "$code_root/common-docs/workspace-root/CLAUDE.md" "~/Code/CLAUDE.md link"
install_link "$portable_root/AGENTS.md" "CLAUDE.md" "~/Code/AGENTS.md link"

# ---------------------------------------------------------------- instructions + config
install_file "$profile_dir/config/claude-CLAUDE.md" "$claude_root/CLAUDE.md" "Claude instructions"
install_file "$profile_dir/config/codex-AGENTS.md" "$codex_root/AGENTS.md" "Codex instructions"
install_file "$profile_dir/config/claude-settings.json" "$claude_root/settings.json" "Claude settings (permissions, hooks)" keep-local
install_file "$profile_dir/config/codex-config.toml" "$codex_root/config.toml" "Codex config" keep-local

# ---------------------------------------------------------------- skills
while IFS= read -r source; do
  relative="${source#"$profile_dir/skills/claude/"}"
  install_file "$source" "$claude_root/skills/$relative" "Claude skill $relative"
done < <(find "$profile_dir/skills/claude" -type f | sort)
while IFS= read -r source; do
  relative="${source#"$profile_dir/skills/codex/"}"
  install_file "$source" "$codex_root/skills/$relative" "Codex skill $relative"
done < <(find "$profile_dir/skills/codex" -type f | sort)

# ---------------------------------------------------------------- scheduled tasks
while IFS= read -r source; do
  relative="${source#"$profile_dir/claude-scheduled-tasks/"}"
  install_file "$source" "$claude_root/scheduled-tasks/$relative" "Claude task $relative"
done < <(find "$profile_dir/claude-scheduled-tasks" -type f -name SKILL.md | sort)

# Codex TOMLs are templates, not a native import: identities are host-bound.
while IFS= read -r source; do
  name="$(basename "$(dirname "$source")")"
  install_file "$source" "$codex_root/automation-templates/$name.toml" "non-active Codex template $name" optional
  codex_template_count=$((codex_template_count + 1))
done < <(find "$profile_dir/codex-automations" -type f -name automation.toml | sort)

# ---------------------------------------------------------------- launchd (copied, never loaded)
while IFS= read -r source; do
  name="$(basename "$source")"
  install_file "$source" "$launchd_root/$name" "launchd job $name"
done < <(find "$profile_dir/launchd" -type f -name '*.plist' | sort)

# ---------------------------------------------------------------- drift mode: warn only
if [[ "$mode" == "drift" ]]; then
  if ((${#differs[@]})); then
    echo "machine-profile drift: ${#differs[@]} local file(s) differ from the committed profile"
    printf '  - %s\n' "${differs[@]}"
    echo "  review, then: bash $profile_dir/setup-machine.sh --sync   (backs up each file first)"
  fi
  exit 0
fi

# ---------------------------------------------------------------- logins
login_needed=()
command -v gh >/dev/null 2>&1 && { gh auth status >/dev/null 2>&1 || login_needed+=("gh auth login"); }
command -v vercel >/dev/null 2>&1 && { vercel whoami >/dev/null 2>&1 || login_needed+=("vercel login"); }
manual+=("Supabase: use existing CLI auth or the connected MCP; do not run supabase login/logout or recreate a Keychain entry")
manual+=("Claude cadence/enablement is host runtime state: enroll ship-all-claude at :13 and :43 on every machine (see SCHEDULES.md for every task)")
manual+=("Codex identities are host-bound: enroll chosen schedules from ~/.codex/automation-templates (see SCHEDULES.md)")
manual+=("launchd job files are copied only; load them locally after reviewing their target checkout")
manual+=("dev-server hooks referenced by settings.json come from matrx-frontend: run 'pnpm setup:agent-harness' there")
manual+=("fill each repo .env from the vault using CREDENTIALS.md (names only)")

echo "Machine profile: $profile_dir"
echo "Mode: $mode   Code root: $code_root"
echo
echo "PARITY REPORT"
echo "  present and identical : $ok"
echo "  CLIs missing          : ${tool_missing[*]:-none}"
echo "  files missing         : ${#missing[@]}"
((${#missing[@]})) && printf '      - %s\n' "${missing[@]}"
echo "  files differing       : ${#differs[@]}"
((${#differs[@]})) && printf '      - %s\n' "${differs[@]}"
echo "  changes this run      : ${#installed[@]}"
((${#installed[@]})) && printf '      - %s\n' "${installed[@]}"
echo "  logins needed         : ${login_needed[*]:-none detected}"
echo "  Codex templates       : $codex_template_count in profile, $optional_absent not yet rendered to ~/.codex/automation-templates (optional; only needed to enroll a schedule)"
echo "Manual actions:"
printf '  - %s\n' "${manual[@]}"

if [[ "$mode" == "check" ]] && (( ${#missing[@]} + ${#tool_missing[@]} )); then
  exit 1
fi
exit 0
