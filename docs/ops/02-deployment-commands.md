# Deployment Commands Reference

## Quick Reference

| Service | Rebuild Command | Verify Command |
|---------|----------------|----------------|
| Traefik | `cd /srv/traefik && docker compose up -d` | `docker inspect traefik --format '{{.State.Health.Status}}'` |
| Server Manager | `cd /srv/apps/server-manager && docker compose up -d --build` | `curl -s https://manager.dev.codematrx.com/health` |
| Deploy Server | `cd /srv/apps/deploy && docker compose up -d --build` | `curl -s https://deploy.dev.codematrx.com/api/health` |
| PostgreSQL | `cd /srv/postgres && docker compose up -d` | `docker exec matrx-postgres pg_isready` |
| pgAdmin | `cd /srv/postgres && docker compose up -d pgadmin` | `curl -s https://pgadmin.dev.codematrx.com` |
| Ship Instance | Via Server Manager API or admin UI | `curl -s https://{name}.dev.codematrx.com` |

---

## Traefik

Traefik rarely needs redeployment. Configuration changes are picked up dynamically.

### Restart Traefik
```bash
cd /srv/traefik
docker compose restart traefik
```

### Full Recreate (preserves certs)
```bash
cd /srv/traefik
docker compose down
docker compose up -d
```

### View Logs
```bash
docker logs traefik --tail 100 -f
```

### Verify Routing
```bash
# Check Traefik dashboard
curl -s https://traefik.dev.codematrx.com/api/http/routers | jq '.[].rule'

# Check specific service routing
curl -sv https://manager.dev.codematrx.com/health 2>&1 | head -30
```

---

## Server Manager (Matrx Manager)

### Standard Rebuild (Zero Downtime)
```bash
cd /srv/apps/server-manager

# Pull latest source code
cd /srv/projects/matrx-ship && git pull

# Rebuild and restart (Docker handles zero-downtime swap)
cd /srv/apps/server-manager
docker compose up -d --build server-manager
```

### Force Full Recreate
```bash
cd /srv/apps/server-manager
docker compose down
docker compose up -d --build
```

### View Logs
```bash
# Live logs
docker logs matrx-manager --tail 200 -f

# Last 500 lines
docker logs matrx-manager --tail 500
```

### Health Check
```bash
curl -s https://manager.dev.codematrx.com/health | jq .
```

### Check Container Status
```bash
docker inspect matrx-manager --format '{{.State.Status}} ({{.State.Health.Status}})'
```

---

## Deploy Server

### Standard Rebuild
```bash
cd /srv/apps/deploy

# Pull latest source
cd /srv/projects/matrx-ship && git pull

# Rebuild
cd /srv/apps/deploy
docker compose up -d --build
```

### View Logs
```bash
docker logs deploy-server --tail 200 -f
```

### Health Check
```bash
curl -s https://deploy.dev.codematrx.com/api/health | jq .
```

---

## Ship App Instances

Instances are managed through the Server Manager. Direct Docker commands are for emergency use only.

### Via Server Manager API
```bash
# List all instances
curl -s -H "Authorization: Bearer $MANAGER_TOKEN" \
  https://manager.dev.codematrx.com/api/instances | jq .

# Deploy/rebuild an instance
curl -X POST -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"myapp","repo":"https://github.com/user/repo","branch":"main"}' \
  https://manager.dev.codematrx.com/api/deploy

# Remove an instance
curl -X DELETE -H "Authorization: Bearer $MANAGER_TOKEN" \
  https://manager.dev.codematrx.com/api/instances/myapp
```

### Direct Emergency Commands
```bash
# List all Ship containers
docker ps --filter "name=ship-" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Restart specific instance
docker restart ship-myapp

# View instance logs
docker logs ship-myapp --tail 200 -f

# View instance database logs
docker logs ship-myapp-db --tail 100 -f
```

---

## PostgreSQL (Shared)

### Restart
```bash
cd /srv/postgres
docker compose restart postgres
```

### Check Status
```bash
docker exec matrx-postgres pg_isready
docker exec matrx-postgres psql -U postgres -c "SELECT version();"
```

### List Databases
```bash
docker exec matrx-postgres psql -U postgres -c "\l"
```

### Backup
```bash
docker exec matrx-postgres pg_dumpall -U postgres > /srv/backups/postgres-$(date +%Y%m%d-%H%M%S).sql
```

---

## Agent Environments

### Rebuild Agent Images
```bash
cd /srv/agent-envs
docker compose build
docker compose up -d
```

### List Running Agents
```bash
docker ps --filter "name=agent-" --format "table {{.Names}}\t{{.Status}}"
```

---

## System-Wide Commands

### View All Running Containers
```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | sort
```

### Check Disk Usage
```bash
docker system df
df -h /srv
```

### Clean Up Unused Images/Volumes
```bash
# Remove unused images (safe — keeps images in use)
docker image prune -f

# Remove unused volumes (CAUTION — verify no data volumes are orphaned first)
docker volume prune -f

# Full cleanup (removes everything unused)
docker system prune -f
```

### View Docker Network
```bash
# List containers on proxy network
docker network inspect proxy --format '{{range .Containers}}{{.Name}} {{end}}'
```

---

## Pulling Latest Code

Always pull code before rebuilding:

```bash
cd /srv/projects/matrx-ship
git fetch origin
git log --oneline HEAD..origin/main  # See what's new
git pull origin main
```

## Checking What's Deployed vs. What's Available

```bash
# Current deployed commit (Server Manager)
docker inspect matrx-manager --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'

# Latest commit in repo
cd /srv/projects/matrx-ship && git log -1 --format="%H %s"

# Diff between deployed and available
git diff HEAD~1..HEAD --stat
```
