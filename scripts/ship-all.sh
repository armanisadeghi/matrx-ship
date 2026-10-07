#!/usr/bin/env bash
# ship-all.sh — run ./ship.sh in every repo under the code folder that needs it; skip the rest.
# Details, options and output: scripts/ship_all.py (header).
#   scripts/ship-all.sh                 # ship everything that needs it
#   scripts/ship-all.sh --dry-run       # only report what would ship
#   scripts/ship-all.sh --only matrx-frontend,aidream
SELF="${BASH_SOURCE[0]}"
while [[ -L "$SELF" ]]; do SELF="$(cd "$(dirname "$SELF")" && cd "$(dirname "$(readlink "$SELF")")" && pwd)/$(basename "$(readlink "$SELF")")"; done
HERE="$(cd "$(dirname "$SELF")" && pwd)"
# Warn (never change anything) when this machine's agent files differ from the committed profile.
[[ -x "$HERE/machine-profile/setup-machine.sh" ]] && bash "$HERE/machine-profile/setup-machine.sh" --drift >&2 || true
exec python3 "$HERE/ship_all.py" "$@"
