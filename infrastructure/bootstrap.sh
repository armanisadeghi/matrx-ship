#!/usr/bin/env bash
# =============================================================================
# Matrx Server Bootstrap Script
# =============================================================================
# Takes a fresh Ubuntu 22.04 VPS from zero to a fully operational Matrx platform.
#
# Prerequisites:
#   - Fresh Ubuntu 22.04 LTS server with root/sudo access
#   - A .env.bootstrap file with all required secrets (see env-vars.md)
#   - DNS: *.dev.codematrx.com pointing to this server's IP
#
# Usage:
#   1. Clone the matrx-ship repo
#   2. Copy .env.bootstrap.example to .env.bootstrap and fill in secrets
#   3. Run: sudo bash infrastructure/bootstrap.sh
#
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${SCRIPT_DIR}/.env.bootstrap"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${GREEN}[BOOTSTRAP]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARNING]${NC} $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*" >&2; }
step() { echo -e "\n${BLUE}=== Step $1: $2 ===${NC}"; }

# =============================================================================
# Pre-flight checks
# =============================================================================

if [ "$(id -u)" -ne 0 ]; then
  err "This script must be run as root (or with sudo)"
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  err "Missing $ENV_FILE — copy .env.bootstrap.example and fill in secrets"
  exit 1
fi

# shellcheck source=/dev/null
source "$ENV_FILE"

# Verify required variables
REQUIRED_VARS=(
  DOMAIN
  TRAEFIK_DASHBOARD_AUTH
  POSTGRES_USER
  POSTGRES_PASSWORD
  POSTGRES_DB
  PGADMIN_EMAIL
  PGADMIN_PASSWORD
  MANAGER_BEARER_TOKEN
  AWS_ACCESS_KEY_ID
  AWS_SECRET_ACCESS_KEY
  AWS_DEFAULT_REGION
  S3_BACKUP_BUCKET
  GITHUB_REPO_URL
)

for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var:-}" ]; then
    err "Required variable $var is not set in $ENV_FILE"
    exit 1
  fi
done

log "All required environment variables present"

# =============================================================================
# Step 1: System packages
# =============================================================================
step 1 "Installing system packages"

apt-get update
apt-get install -y \
  apt-transport-https ca-certificates curl gnupg lsb-release \
  ufw fail2ban jq htop unzip git

# =============================================================================
# Step 2: Docker Engine (pinned to 28.5.2)
# =============================================================================
step 2 "Installing Docker Engine 28.5.2"

if command -v docker &>/dev/null; then
  log "Docker already installed: $(docker --version)"
else
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list
  apt-get update
  # Pin to 28.5.x — Docker 29+ breaks Traefik v3.3
  apt-get install -y docker-ce=5:28.5.* docker-ce-cli=5:28.5.* containerd.io docker-compose-plugin
  apt-mark hold docker-ce docker-ce-cli
  systemctl enable docker
  systemctl start docker
  log "Docker installed and pinned to 28.5.x"
fi

# =============================================================================
# Step 3: Sysbox (for agent VMs)
# =============================================================================
step 3 "Installing Sysbox runtime"

if command -v sysbox-runc &>/dev/null; then
  log "Sysbox already installed"
else
  SYSBOX_VERSION="0.6.7"
  SYSBOX_DEB="sysbox-ce_${SYSBOX_VERSION}-0.linux_amd64.deb"
  curl -fsSLO "https://downloads.nestybox.com/sysbox/releases/v${SYSBOX_VERSION}/${SYSBOX_DEB}"
  apt-get install -y "./${SYSBOX_DEB}"
  rm -f "${SYSBOX_DEB}"
  log "Sysbox ${SYSBOX_VERSION} installed"
fi

# =============================================================================
# Step 4: Node.js 22 LTS + pnpm
# =============================================================================
step 4 "Installing Node.js 22 LTS and pnpm"

if command -v node &>/dev/null; then
  log "Node.js already installed: $(node --version)"
else
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
  npm install -g pnpm
  log "Node.js $(node --version) + pnpm installed"
fi

# =============================================================================
# Step 5: Firewall
# =============================================================================
step 5 "Configuring UFW firewall"

ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp   # SSH
ufw allow 80/tcp   # HTTP
ufw allow 443/tcp  # HTTPS
ufw --force enable
log "UFW configured: SSH, HTTP, HTTPS only"

# =============================================================================
# Step 6: Docker network
# =============================================================================
step 6 "Creating Docker proxy network"

bash "${SCRIPT_DIR}/network/setup.sh"

# =============================================================================
# Step 7: Directory structure
# =============================================================================
step 7 "Creating directory structure"

mkdir -p /srv/{traefik/acme,traefik/dynamic,postgres/data,postgres/init,agent-envs/images,apps/backups,projects}

# =============================================================================
# Step 8: Clone source repos
# =============================================================================
step 8 "Cloning source repositories"

if [ -d /srv/projects/matrx-ship ]; then
  log "matrx-ship already cloned, pulling latest..."
  cd /srv/projects/matrx-ship && git pull origin main
else
  git clone "${GITHUB_REPO_URL}" /srv/projects/matrx-ship
fi

# Clone other repos if URLs provided
if [ -n "${SANDBOX_REPO_URL:-}" ]; then
  if [ -d /srv/projects/matrx-sandbox ]; then
    cd /srv/projects/matrx-sandbox && git pull origin main
  else
    git clone "${SANDBOX_REPO_URL}" /srv/projects/matrx-sandbox
  fi
fi

if [ -n "${MCP_TEMPLATE_REPO_URL:-}" ]; then
  if [ -d /srv/projects/matrx-mcp-template ]; then
    cd /srv/projects/matrx-mcp-template && git pull origin main
  else
    git clone "${MCP_TEMPLATE_REPO_URL}" /srv/projects/matrx-mcp-template
  fi
fi

# =============================================================================
# Step 9: Deploy infrastructure configs
# =============================================================================
step 9 "Deploying infrastructure configs"

# Traefik
cp "${SCRIPT_DIR}/traefik/traefik.yml" /srv/traefik/traefik.yml
cp "${SCRIPT_DIR}/traefik/docker-compose.yml" /srv/traefik/docker-compose.yml
cp "${SCRIPT_DIR}/traefik/dynamic/tls.yml" /srv/traefik/dynamic/tls.yml
cat > /srv/traefik/.env << EOF
DOMAIN=${DOMAIN}
TRAEFIK_DASHBOARD_AUTH=${TRAEFIK_DASHBOARD_AUTH}
EOF
chmod 600 /srv/traefik/.env
touch /srv/traefik/acme/acme.json
chmod 600 /srv/traefik/acme/acme.json

# PostgreSQL
cp "${SCRIPT_DIR}/postgres/docker-compose.yml" /srv/postgres/docker-compose.yml
cp "${SCRIPT_DIR}/postgres/init/01-extensions.sql" /srv/postgres/init/01-extensions.sql
cat > /srv/postgres/.env << EOF
POSTGRES_USER=${POSTGRES_USER}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=${POSTGRES_DB}
PGADMIN_EMAIL=${PGADMIN_EMAIL}
PGADMIN_PASSWORD=${PGADMIN_PASSWORD}
EOF
chmod 600 /srv/postgres/.env

# Agent environments
cp "${SCRIPT_DIR}/agent-envs/docker-compose.yml" /srv/agent-envs/docker-compose.yml
mkdir -p /srv/agent-envs/images
cp "${SCRIPT_DIR}/agent-envs/images/Dockerfile.agent" /srv/agent-envs/images/Dockerfile.agent

log "Infrastructure configs deployed"

# =============================================================================
# Step 10: Start Traefik
# =============================================================================
step 10 "Starting Traefik reverse proxy"

cd /srv/traefik && docker compose up -d
sleep 5
if docker ps --filter "name=traefik" --filter "status=running" -q | grep -q .; then
  log "Traefik is running"
else
  err "Traefik failed to start — check: docker logs traefik"
  exit 1
fi

# =============================================================================
# Step 11: Start PostgreSQL
# =============================================================================
step 11 "Starting PostgreSQL + pgAdmin"

cd /srv/postgres && docker compose up -d
log "Waiting for PostgreSQL to be healthy..."
for i in $(seq 1 30); do
  if docker exec postgres pg_isready -U "${POSTGRES_USER}" >/dev/null 2>&1; then
    log "PostgreSQL is healthy"
    break
  fi
  [ "$i" -eq 30 ] && { err "PostgreSQL failed health check after 30 attempts"; exit 1; }
  sleep 2
done

# =============================================================================
# Step 12: Build matrx-ship Docker image
# =============================================================================
step 12 "Building matrx-ship:latest Docker image"

cd /srv/projects/matrx-ship
docker build -t matrx-ship:latest .
log "matrx-ship:latest image built"

# =============================================================================
# Step 13: Deploy Server Manager
# =============================================================================
step 13 "Deploying Server Manager"

mkdir -p /srv/apps/server-manager
cp "${REPO_DIR}/server-manager/Dockerfile" /srv/apps/server-manager/ 2>/dev/null || true

cat > /srv/apps/server-manager/docker-compose.yml << 'COMPOSE'
services:
  server-manager:
    build:
      context: /srv/projects/matrx-ship/server-manager
      dockerfile: Dockerfile
    container_name: matrx-manager
    restart: unless-stopped
    env_file:
      - .env
    environment:
      NODE_ENV: production
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /srv:/host-srv
      - /data:/host-data
    networks:
      - proxy
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.matrx-manager.rule=Host(`manager.DOMAIN_SUFFIX`)"
      - "traefik.http.routers.matrx-manager.entrypoints=websecure"
      - "traefik.http.routers.matrx-manager.tls.certresolver=letsencrypt"
      - "traefik.http.services.matrx-manager.loadbalancer.server.port=3000"

networks:
  proxy:
    external: true
COMPOSE

# Replace domain placeholder
sed -i "s/DOMAIN_SUFFIX/${DOMAIN}/g" /srv/apps/server-manager/docker-compose.yml

cat > /srv/apps/server-manager/.env << EOF
MANAGER_BEARER_TOKEN=${MANAGER_BEARER_TOKEN}

# AWS S3
AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION}
S3_BACKUP_BUCKET=${S3_BACKUP_BUCKET}
EOF
chmod 600 /srv/apps/server-manager/.env

cd /srv/apps/server-manager && docker compose build && docker compose up -d
log "Server Manager deployed at https://manager.${DOMAIN}"

# =============================================================================
# Step 14: Deploy the Deploy Server
# =============================================================================
step 14 "Deploying Deploy Server"

mkdir -p /srv/apps/deploy

cat > /srv/apps/deploy/docker-compose.yml << 'COMPOSE'
services:
  deploy-app:
    build:
      context: /srv/projects/matrx-ship/deploy
      dockerfile: Dockerfile
    container_name: matrx-deploy
    restart: unless-stopped
    env_file:
      - .env
    environment:
      NODE_ENV: production
      HOST_SRV_PATH: /host-srv
      AWS_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID}
      AWS_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY}
      AWS_DEFAULT_REGION: ${AWS_DEFAULT_REGION}
      S3_BACKUP_BUCKET: ${S3_BACKUP_BUCKET}
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /srv:/host-srv
    networks:
      - proxy
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.matrx-deploy.rule=Host(`deploy.DOMAIN_SUFFIX`)"
      - "traefik.http.routers.matrx-deploy.entrypoints=websecure"
      - "traefik.http.routers.matrx-deploy.tls.certresolver=letsencrypt"
      - "traefik.http.services.matrx-deploy.loadbalancer.server.port=3000"

networks:
  proxy:
    external: true
COMPOSE

sed -i "s/DOMAIN_SUFFIX/${DOMAIN}/g" /srv/apps/deploy/docker-compose.yml

cat > /srv/apps/deploy/.env << EOF
# AWS S3 — server backups & image archival
AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION}
S3_BACKUP_BUCKET=${S3_BACKUP_BUCKET}
EOF
chmod 600 /srv/apps/deploy/.env

cd /srv/apps/deploy && docker compose build && docker compose up -d
log "Deploy Server deployed at https://deploy.${DOMAIN}"

# =============================================================================
# Step 15: Create credentials file
# =============================================================================
step 15 "Creating credentials file"

cat > /srv/.credentials << EOF
# Matrx Server Credentials
# Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")
# chmod 600 — do not commit to source control

[PostgreSQL]
User: ${POSTGRES_USER}
Password: ${POSTGRES_PASSWORD}
Database: ${POSTGRES_DB}

[pgAdmin]
Email: ${PGADMIN_EMAIL}
Password: ${PGADMIN_PASSWORD}

[Server Manager]
URL: https://manager.${DOMAIN}
Bearer Token: ${MANAGER_BEARER_TOKEN}

[Deploy App]
URL: https://deploy.${DOMAIN}

[AWS S3]
Bucket: ${S3_BACKUP_BUCKET}
Region: ${AWS_DEFAULT_REGION}
EOF
chmod 600 /srv/.credentials

# =============================================================================
# Step 16: Health checks
# =============================================================================
step 16 "Running health checks"

echo ""
HEALTHY=0
UNHEALTHY=0

check_service() {
  local name=$1
  local container=$2
  if docker ps --filter "name=${container}" --filter "status=running" -q | grep -q .; then
    log "  $name ($container): RUNNING"
    HEALTHY=$((HEALTHY + 1))
  else
    err "  $name ($container): NOT RUNNING"
    UNHEALTHY=$((UNHEALTHY + 1))
  fi
}

check_service "Traefik" "traefik"
check_service "PostgreSQL" "postgres"
check_service "pgAdmin" "pgadmin"
check_service "Server Manager" "matrx-manager"
check_service "Deploy App" "matrx-deploy"

echo ""
log "Health check complete: ${HEALTHY} healthy, ${UNHEALTHY} unhealthy"

if [ $UNHEALTHY -gt 0 ]; then
  warn "Some services failed to start. Check logs with: docker logs <container-name>"
fi

# =============================================================================
# Done
# =============================================================================

echo ""
echo -e "${GREEN}=============================================${NC}"
echo -e "${GREEN}  Bootstrap complete!${NC}"
echo -e "${GREEN}=============================================${NC}"
echo ""
echo "  Server Manager: https://manager.${DOMAIN}/admin"
echo "  Deploy App:     https://deploy.${DOMAIN}"
echo "  Traefik:        https://traefik.${DOMAIN}"
echo "  pgAdmin:        https://pg.${DOMAIN}"
echo ""
echo "  Credentials:    /srv/.credentials"
echo ""
echo "  Next steps:"
echo "    1. Verify DNS is pointing to this server"
echo "    2. Wait ~60s for Let's Encrypt certificates"
echo "    3. Open the Server Manager and create app instances"
echo ""
