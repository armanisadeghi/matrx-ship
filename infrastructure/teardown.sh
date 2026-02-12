#!/usr/bin/env bash
# =============================================================================
# Matrx Server Teardown Script
# =============================================================================
# Cleanly shuts down all services in the correct order.
# Does NOT delete data volumes or config files.
# Use with caution — this stops everything.
#
# Usage: sudo bash infrastructure/teardown.sh
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[TEARDOWN]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARNING]${NC} $*"; }

echo -e "${RED}This will stop ALL Matrx services on this server.${NC}"
echo -e "${YELLOW}Data volumes will be preserved.${NC}"
read -p "Are you sure? (type 'yes' to confirm): " confirm
if [ "$confirm" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

# Stop app instances
log "Stopping app instances..."
for dir in /srv/apps/*/; do
  name=$(basename "$dir")
  if [ -f "$dir/docker-compose.yml" ]; then
    log "  Stopping $name..."
    (cd "$dir" && docker compose down) || warn "  Failed to stop $name"
  fi
done

# Stop agent environments
log "Stopping agent environments..."
if [ -f /srv/agent-envs/docker-compose.yml ]; then
  (cd /srv/agent-envs && docker compose --profile all down) || warn "Failed to stop agents"
fi

# Stop PostgreSQL
log "Stopping PostgreSQL..."
if [ -f /srv/postgres/docker-compose.yml ]; then
  (cd /srv/postgres && docker compose down) || warn "Failed to stop Postgres"
fi

# Stop Traefik (last — it's the network gateway)
log "Stopping Traefik..."
if [ -f /srv/traefik/docker-compose.yml ]; then
  (cd /srv/traefik && docker compose down) || warn "Failed to stop Traefik"
fi

echo ""
log "All services stopped."
log "Data volumes are preserved. Run 'docker volume ls' to see them."
log "To restart, use bootstrap.sh or start services individually."
