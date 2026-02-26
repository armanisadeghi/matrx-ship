## Complete Server Deployment Guide

Your server has **4 categories** of services. Here's every one, with the exact commands to redeploy each, how to verify health, and how to ensure zero-downtime / healthy-only deployments.

---

### Category 1: Infrastructure Services (foundation — deploy first, rarely changes)

#### 1A. Traefik (Reverse Proxy)

```bash
# Redeploy (pulls latest v3.3 image, recreates)
cd /srv/traefik && docker compose pull && docker compose up -d

# View logs / check health
docker logs traefik --tail 50 -f

# Dashboard (check routing)
# https://traefik.dev.codematrx.com (admin / see .credentials)
```

**Zero-downtime note:** Traefik is a single-instance reverse proxy. Restarting it causes a brief (~1-2s) interruption to all services. Only restart if you need to update Traefik itself. Config changes in `dynamic/` are hot-reloaded automatically with no restart needed.

#### 1B. PostgreSQL + pgAdmin (Shared Database)

```bash
# Redeploy
cd /srv/postgres && docker compose pull && docker compose up -d

# Verify health
docker exec postgres pg_isready -U matrx

# View logs
docker logs postgres --tail 50 -f
docker logs pgadmin --tail 50 -f

# pgAdmin UI: https://pg.dev.codematrx.com
```

**Zero-downtime note:** Do NOT force-recreate Postgres unless absolutely necessary — it restarts the database and briefly drops all connections. Use `docker compose pull && docker compose up -d` which only recreates if the image changed. Data is persisted in `/srv/postgres/data`.

#### 1C. Agent Environments (Sysbox VMs)

```bash
# Rebuild image and start agent-1
cd /srv/agent-envs && docker compose --profile agent1 build --no-cache && docker compose --profile agent1 up -d

# Rebuild image and start agent-2
cd /srv/agent-envs && docker compose --profile agent2 build --no-cache && docker compose --profile agent2 up -d

# Start all agents (without rebuild)
cd /srv/agent-envs && docker compose --profile all up -d

# Stop a specific agent
cd /srv/agent-envs && docker compose --profile agent1 down

# Check status
docker ps --filter "name=agent-"

# Shell into agent
docker exec -it -u agent agent-1 bash
```

**Zero-downtime note:** Agents are independent workspaces. Restarting one doesn't affect the other or any app services.

---

### Category 2: Matrx Ship App Instances (8 instances sharing one image)

These all use the `matrx-ship:latest` local Docker image:
- `aidream`
- `ai-matrx-admin`
- `matrx-dev-tools`
- `matrx-dm`
- `matrx-mcp-servers`
- `matrx-mcp-template`
- `matrx-sandbox`
- `matrx-ship`

#### Step 1: Rebuild the shared image

```bash
cd /srv/projects/matrx-ship && git pull origin main
docker build -t matrx-ship:latest .
```

#### Step 2: Redeploy ALL instances (one-liner)

```bash
for dir in /srv/apps/*/; do
  name=$(basename "$dir")
  if [ -f "$dir/docker-compose.yml" ] && grep -q "image: matrx-ship:latest" "$dir/docker-compose.yml"; then
    echo "→ Redeploying $name..."
    cd "$dir" && docker compose up -d --force-recreate app && cd /srv/apps
  fi
done
```

#### Step 2 (alternative): Redeploy a SINGLE instance

```bash
# Replace INSTANCE_NAME with any of the 8 names above
cd /srv/apps/INSTANCE_NAME && docker compose up -d --force-recreate app
```

Exact commands for each:

```bash
cd /srv/apps/aidream && docker compose up -d --force-recreate app
cd /srv/apps/ai-matrx-admin && docker compose up -d --force-recreate app
cd /srv/apps/matrx-dev-tools && docker compose up -d --force-recreate app
cd /srv/apps/matrx-dm && docker compose up -d --force-recreate app
cd /srv/apps/matrx-mcp-servers && docker compose up -d --force-recreate app
cd /srv/apps/matrx-mcp-template && docker compose up -d --force-recreate app
cd /srv/apps/matrx-sandbox && docker compose up -d --force-recreate app
cd /srv/apps/matrx-ship && docker compose up -d --force-recreate app
```

#### Step 3: Health check all instances

```bash
for dir in /srv/apps/*/; do
  name=$(basename "$dir")
  if [ -f "$dir/docker-compose.yml" ] && grep -q "image: matrx-ship:latest" "$dir/docker-compose.yml"; then
    subdomain=$(grep -oP 'Host\(`\K[^`]+' "$dir/docker-compose.yml" | head -1)
    echo -n "  $name → "
    curl -sf "https://$subdomain/api/health" && echo "" || echo "UNHEALTHY"
  fi
done
```

#### View logs for a specific instance

```bash
docker logs matrx-ship --tail 100 -f       # app logs
docker logs db-matrx-ship --tail 50 -f      # its database logs

# For any instance, the pattern is:
docker logs INSTANCE_NAME --tail 100 -f       # app
docker logs db-INSTANCE_NAME --tail 50 -f     # db
```

---

### Category 3: Custom-Built Services (build from source, not the shared image)

#### 3A. Deploy Service (deploy UI)

```bash
cd /srv/apps/deploy && docker compose build --no-cache deploy-app && docker compose up -d --force-recreate deploy-app

# Check health
docker logs matrx-deploy --tail 50 -f

# URL: https://deploy.dev.codematrx.com
```

#### 3B. Server Manager

```bash
cd /srv/apps/server-manager && docker compose build --no-cache server-manager && docker compose up -d --force-recreate server-manager

# Check health
docker logs matrx-manager --tail 50 -f

# URL: https://manager.dev.codematrx.com
```

**Note:** Both of these build from `/srv/projects/matrx-ship/deploy` and `/srv/projects/matrx-ship/server-manager` respectively. If you updated the matrx-ship source code, you need to rebuild these too.

---

### Category 4: Sandbox Orchestrator (Python/FastAPI)

```bash
# Production mode (real Postgres + S3)
cd /srv/projects/matrx-sandbox && docker compose --profile production build --no-cache orchestrator-prod && docker compose --profile production up -d orchestrator-prod

# Local dev mode (with LocalStack)
cd /srv/projects/matrx-sandbox && docker compose build --no-cache orchestrator && docker compose up -d

# Check health
docker logs $(docker ps -qf "ancestor=*orchestrator*" | head -1) --tail 50 -f
```

---

### Full Redeploy Script (Everything, in order)

Here's the complete sequence to redeploy the entire server safely:

```bash
#!/bin/bash
set -e

echo "=== 1. Pull latest source ==="
cd /srv/projects/matrx-ship && git pull origin main

echo "=== 2. Build shared matrx-ship image ==="
docker build -t matrx-ship:latest .

echo "=== 3. Redeploy all matrx-ship instances ==="
for dir in /srv/apps/*/; do
  name=$(basename "$dir")
  if [ -f "$dir/docker-compose.yml" ] && grep -q "image: matrx-ship:latest" "$dir/docker-compose.yml"; then
    echo "  → $name"
    (cd "$dir" && docker compose up -d --force-recreate app)
  fi
done

echo "=== 4. Rebuild & redeploy custom services ==="
echo "  → deploy"
(cd /srv/apps/deploy && docker compose build --no-cache deploy-app && docker compose up -d --force-recreate deploy-app)

echo "  → server-manager"
(cd /srv/apps/server-manager && docker compose build --no-cache server-manager && docker compose up -d --force-recreate server-manager)

echo "=== 5. Wait for startup ==="
sleep 15

echo "=== 6. Health checks ==="
for dir in /srv/apps/*/; do
  name=$(basename "$dir")
  if [ -f "$dir/docker-compose.yml" ]; then
    subdomain=$(grep -oP 'Host\(`\K[^`]+' "$dir/docker-compose.yml" | head -1)
    if [ -n "$subdomain" ]; then
      status=$(curl -sf -o /dev/null -w "%{http_code}" "https://$subdomain/api/health" 2>/dev/null || echo "FAIL")
      echo "  $name ($subdomain) → $status"
    fi
  fi
done
```

---

### Ensuring Healthy-Only Deployments (Zero Downtime)

Your current setup uses `--force-recreate` which kills the old container then starts a new one — there **is** a brief gap. Here's how to make each category safer:

**For the matrx-ship instances**, the best approach available with single-container compose:

```bash
# Build the new image FIRST (before touching any running container)
docker build -t matrx-ship:new .

# Test the new image in isolation
docker run --rm -d --name test-ship -p 3099:3000 matrx-ship:new
sleep 5
curl -f http://localhost:3099/api/health && echo "NEW IMAGE IS HEALTHY" || echo "NEW IMAGE FAILED - ABORTING"
docker stop test-ship

# Only if healthy, tag it as latest and roll out
docker tag matrx-ship:new matrx-ship:latest

# Then redeploy instances one at a time with health verification
for dir in /srv/apps/*/; do
  name=$(basename "$dir")
  if [ -f "$dir/docker-compose.yml" ] && grep -q "image: matrx-ship:latest" "$dir/docker-compose.yml"; then
    echo "Deploying $name..."
    (cd "$dir" && docker compose up -d --force-recreate app)
    sleep 8
    subdomain=$(grep -oP 'Host\(`\K[^`]+' "$dir/docker-compose.yml" | head -1)
    for i in 1 2 3 4 5 6; do
      curl -sf "https://$subdomain/api/health" > /dev/null && echo "  ✓ $name healthy" && break
      [ "$i" -eq 6 ] && echo "  ✗ $name UNHEALTHY — check logs: docker logs $name --tail 50"
      sleep 5
    done
  fi
done
```

**For custom-build services (deploy, server-manager):**

```bash
# Build without affecting running container
cd /srv/apps/deploy && docker compose build deploy-app
# Then recreate — old stops, new starts
docker compose up -d --force-recreate deploy-app
```

---

### Diagnosing Problems

```bash
# See what's running / stopped / restarting
docker ps -a --format "table {{.Names}}\t{{.Image}}\t{{.Status}}" | sort

# Find containers in restart loops
docker ps -a --filter "status=restarting"

# Check a specific container's logs
docker logs CONTAINER_NAME --tail 200 -f

# Check container resource usage
docker stats --no-stream

# Inspect a container's config/state
docker inspect CONTAINER_NAME | jq '.[0].State'

# Check if ports are exposed correctly
docker port CONTAINER_NAME

# Check Traefik routing (see which routers/services are detected)
curl -sf -u admin:ZrJxwtBmb6/U40czciWEN8PenWIcScb6 https://traefik.dev.codematrx.com/api/http/routers | jq '.[] | {name, status, rule}'

# Check the Docker network
docker network inspect proxy

# Check disk space (images/volumes can fill up)
docker system df
df -h /
```

---

### Summary Table

| # | Service | Type | Directory | Deploy Command |
|---|---------|------|-----------|---------------|
| 1 | Traefik | Infrastructure | `/srv/traefik` | `cd /srv/traefik && docker compose pull && docker compose up -d` |
| 2 | PostgreSQL + pgAdmin | Infrastructure | `/srv/postgres` | `cd /srv/postgres && docker compose pull && docker compose up -d` |
| 3 | Agent-1 | Infrastructure | `/srv/agent-envs` | `cd /srv/agent-envs && docker compose --profile agent1 up -d` |
| 4 | Agent-2 | Infrastructure | `/srv/agent-envs` | `cd /srv/agent-envs && docker compose --profile agent2 up -d` |
| 5 | aidream | Ship instance | `/srv/apps/aidream` | `cd /srv/apps/aidream && docker compose up -d --force-recreate app` |
| 6 | ai-matrx-admin | Ship instance | `/srv/apps/ai-matrx-admin` | `cd /srv/apps/ai-matrx-admin && docker compose up -d --force-recreate app` |
| 7 | matrx-dev-tools | Ship instance | `/srv/apps/matrx-dev-tools` | `cd /srv/apps/matrx-dev-tools && docker compose up -d --force-recreate app` |
| 8 | matrx-dm | Ship instance | `/srv/apps/matrx-dm` | `cd /srv/apps/matrx-dm && docker compose up -d --force-recreate app` |
| 9 | matrx-mcp-servers | Ship instance | `/srv/apps/matrx-mcp-servers` | `cd /srv/apps/matrx-mcp-servers && docker compose up -d --force-recreate app` |
| 10 | matrx-mcp-template | Ship instance | `/srv/apps/matrx-mcp-template` | `cd /srv/apps/matrx-mcp-template && docker compose up -d --force-recreate app` |
| 11 | matrx-sandbox | Ship instance | `/srv/apps/matrx-sandbox` | `cd /srv/apps/matrx-sandbox && docker compose up -d --force-recreate app` |
| 12 | matrx-ship | Ship instance | `/srv/apps/matrx-ship` | `cd /srv/apps/matrx-ship && docker compose up -d --force-recreate app` |
| 13 | Deploy UI | Custom build | `/srv/apps/deploy` | `cd /srv/apps/deploy && docker compose build --no-cache deploy-app && docker compose up -d --force-recreate deploy-app` |
| 14 | Server Manager | Custom build | `/srv/apps/server-manager` | `cd /srv/apps/server-manager && docker compose build --no-cache server-manager && docker compose up -d --force-recreate server-manager` |
| 15 | Sandbox Orchestrator | Python/FastAPI | `/srv/projects/matrx-sandbox` | `cd /srv/projects/matrx-sandbox && docker compose --profile production up -d --build orchestrator-prod` |

**Important:** For services 5-12, you must first rebuild the shared image (`docker build -t matrx-ship:latest .` in `/srv/projects/matrx-ship`) before the `--force-recreate` will pick up code changes. The recreate just restarts the container from the local `matrx-ship:latest` tag.