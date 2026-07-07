#!/usr/bin/env bash
# Install (or refresh) the Ship pull-deploy systemd units on the /srv host.
# Idempotent — re-run after editing pull-deploy.sh or the unit files.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

install -m 0755 "$DIR/../pull-deploy.sh" /usr/local/bin/matrx-ship-deploy-runner
cp "$DIR/matrx-ship-deploy.service" /etc/systemd/system/
cp "$DIR/matrx-ship-deploy.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now matrx-ship-deploy.timer

echo "Installed. Next runs:"
systemctl list-timers matrx-ship-deploy.timer --no-pager
echo "Logs: journalctl -u matrx-ship-deploy.service -f"
