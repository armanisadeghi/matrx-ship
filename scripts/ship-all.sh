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
# THE ROUND OUTLIVES ITS CALLER (2026-10-21): a real round runs detached, one at a time, and this
# caller streams its output (ship_all_detached.py header). A dry run, or MATRX_SHIP_ALL_ATTACHED=1,
# runs in the foreground as before (so does --help).
case " $* " in *" --dry-run "*|*" --help "*|*" -h "*) MATRX_SHIP_ALL_ATTACHED=1 ;; esac
if [[ "${MATRX_SHIP_ALL_ATTACHED:-}" != "1" && "${MATRX_SHIP_ALL_DETACHED:-}" != "1" ]]; then
    exec python3 "$HERE/ship_all_detached.py" "$@"
fi
exec python3 "$HERE/ship_all.py" "$@"
