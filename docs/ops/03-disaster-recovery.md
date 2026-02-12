# Disaster Recovery Procedures

## Recovery Priorities

When things go wrong, fix in this order:

1. **Traefik** — without it, nothing is accessible
2. **Server Manager** — without it, nothing can be managed
3. **Deploy Server** — backup management path
4. **PostgreSQL** — app data depends on it
5. **App Instances** — individual apps

---

## Scenario: Single Service Won't Start

### Diagnosis
```bash
# Check container status
docker ps -a --filter "name={service}" --format "{{.Names}} {{.Status}}"

# Check logs for errors
docker logs {container-name} --tail 100

# Check if port is already in use
docker port {container-name}

# Check health
docker inspect {container-name} --format '{{.State.Health.Status}}'
```

### Resolution Steps
1. Check logs for the specific error
2. Verify environment variables: `docker exec {container-name} env | sort`
3. Verify network connectivity: `docker network inspect proxy`
4. Try restart: `docker restart {container-name}`
5. Try full recreate: `cd {compose-dir} && docker compose up -d --force-recreate`
6. Check disk space: `df -h /srv`
7. Check Docker disk usage: `docker system df`

---

## Scenario: Traefik Routing Broken

### Symptoms
- 502 Bad Gateway errors
- SSL certificate errors
- "Connection refused" on all services

### Diagnosis
```bash
# Check Traefik is running
docker ps --filter "name=traefik"

# Check Traefik logs
docker logs traefik --tail 200

# Check router configuration
curl -s http://localhost:8080/api/http/routers | jq '.[] | {name: .name, rule: .rule, status: .status}'

# Check services
curl -s http://localhost:8080/api/http/services | jq '.[] | {name: .name, status: .status}'
```

### Resolution
1. **If Traefik is not running:**
   ```bash
   cd /srv/traefik && docker compose up -d
   ```

2. **If SSL certificates are broken:**
   ```bash
   # Check acme.json
   ls -la /srv/traefik/acme.json
   
   # If corrupted, remove and restart (will re-issue certs)
   rm /srv/traefik/acme.json
   cd /srv/traefik && docker compose restart traefik
   ```

3. **If a specific service isn't routing:**
   ```bash
   # Verify the container is on the proxy network
   docker network inspect proxy | grep {container-name}
   
   # If not connected, reconnect
   docker network connect proxy {container-name}
   
   # Verify Traefik labels on the container
   docker inspect {container-name} --format '{{json .Config.Labels}}' | jq .
   ```

---

## Scenario: Database Connection Lost

### Symptoms
- App instances returning 500 errors
- "connection refused" or "ECONNREFUSED" in logs

### Diagnosis
```bash
# Check shared Postgres
docker ps --filter "name=matrx-postgres"
docker exec matrx-postgres pg_isready

# Check instance-specific Postgres
docker ps --filter "name=ship-{name}-db"
docker exec ship-{name}-db pg_isready -U postgres

# Check database accessibility
docker exec matrx-postgres psql -U postgres -c "\conninfo"
```

### Resolution
1. **If Postgres is down:**
   ```bash
   cd /srv/postgres && docker compose up -d
   ```

2. **If instance DB is down:**
   ```bash
   # Restart the instance database
   docker restart ship-{name}-db
   
   # Or recreate via Server Manager
   curl -X POST -H "Authorization: Bearer $TOKEN" \
     https://manager.dev.codematrx.com/api/instances/{name}/restart
   ```

3. **If data is corrupted:**
   ```bash
   # Stop the database
   docker stop ship-{name}-db
   
   # Restore from backup (if available in S3)
   # Download backup, then:
   docker exec -i ship-{name}-db psql -U postgres < backup.sql
   ```

---

## Scenario: Disk Full

### Symptoms
- Containers failing to start
- "no space left on device" errors
- Database writes failing

### Diagnosis
```bash
# Check filesystem
df -h /srv
df -h /var/lib/docker

# Check Docker disk usage
docker system df -v

# Find large files
du -sh /srv/* | sort -rh | head -20
```

### Resolution
1. **Clean Docker resources:**
   ```bash
   # Remove unused images
   docker image prune -af
   
   # Remove unused volumes (CAUTION: verify first)
   docker volume ls --filter "dangling=true"
   docker volume prune -f
   
   # Remove build cache
   docker builder prune -af
   ```

2. **Clean old logs:**
   ```bash
   # Truncate container logs
   truncate -s 0 $(docker inspect --format='{{.LogPath}}' {container-name})
   ```

3. **Remove old backups:**
   ```bash
   ls -la /srv/backups/
   # Remove backups older than 7 days
   find /srv/backups/ -mtime +7 -delete
   ```

---

## Scenario: Complete Server Loss (Fresh VPS Recovery)

This is the nuclear option. Use when the VPS is unrecoverable.

### Prerequisites
- Access to source code repos (GitHub)
- Environment variables (stored in team password manager or Supabase)
- AWS S3 credentials for backup access

### Recovery Steps

1. **Provision fresh VPS** (Ubuntu 22.04+ recommended, 4GB+ RAM)

2. **Run bootstrap script:**
   ```bash
   git clone https://github.com/yourorg/matrx-ship.git /srv/projects/matrx-ship
   cd /srv/projects/matrx-ship/infrastructure
   
   # Copy and fill in environment variables
   cp .env.bootstrap.example .env.bootstrap
   nano .env.bootstrap  # Fill in all required values
   
   # Run bootstrap
   chmod +x bootstrap.sh
   ./bootstrap.sh
   ```

3. **Restore state from Supabase:**
   ```bash
   # The Server Manager will auto-sync from Supabase on startup if configured
   # Verify sync:
   curl -s -H "Authorization: Bearer $TOKEN" \
     https://manager.dev.codematrx.com/api/supabase/status
   
   # If needed, trigger manual restore:
   curl -X POST -H "Authorization: Bearer $TOKEN" \
     https://manager.dev.codematrx.com/api/supabase/restore
   ```

4. **Restore databases from S3 backups:**
   ```bash
   # Download latest backup from S3
   aws s3 ls s3://your-bucket/backups/
   aws s3 cp s3://your-bucket/backups/latest.sql /tmp/restore.sql
   
   # Restore
   docker exec -i matrx-postgres psql -U postgres < /tmp/restore.sql
   ```

5. **Verify all services:**
   ```bash
   # Check all containers
   docker ps --format "table {{.Names}}\t{{.Status}}"
   
   # Check health endpoints
   curl -s https://manager.dev.codematrx.com/health
   curl -s https://deploy.dev.codematrx.com/api/health
   ```

6. **Redeploy app instances:**
   ```bash
   # Instances will be recreated from Supabase state
   # Trigger full sync
   curl -X POST -H "Authorization: Bearer $TOKEN" \
     https://manager.dev.codematrx.com/api/supabase/restore
   ```

---

## Scenario: Server Manager Down, Need Emergency Access

The Deploy server is your lifeline.

1. **Access Deploy server:** `https://deploy.dev.codematrx.com`
2. **Navigate to Manager Control** (primary page)
3. **Check Manager status** — see container state, health, resource usage
4. **View Manager logs** — identify the failure cause
5. **Attempt rebuild** — use the "Rebuild Manager" button
6. **Check environment variables** — ensure no misconfig
7. **If rebuild fails,** use the terminal to SSH into the Deploy container and run Docker commands directly

### Emergency CLI via Deploy Server

If the Deploy UI is also failing, you can still hit API endpoints:

```bash
# Check manager status
curl -s -H "Authorization: Bearer $DEPLOY_TOKEN" \
  https://deploy.dev.codematrx.com/api/manager/status | jq .

# View manager logs
curl -s -H "Authorization: Bearer $DEPLOY_TOKEN" \
  https://deploy.dev.codematrx.com/api/manager/logs?lines=200

# Trigger rebuild
curl -X POST -H "Authorization: Bearer $DEPLOY_TOKEN" \
  https://deploy.dev.codematrx.com/api/rebuild-manager
```

---

## Rollback Procedures

### Rolling Back Server Manager
```bash
# Via Deploy Server UI: Navigate to Manager Control → Rollback section

# Via CLI:
cd /srv/apps/server-manager
docker compose down
# Edit docker-compose.yml to use previous image tag
docker compose up -d
```

### Rolling Back App Instance
```bash
# Via Server Manager UI: Navigate to instance → Builds → Rollback

# Via API:
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"build_id":"previous-build-id"}' \
  https://manager.dev.codematrx.com/api/instances/{name}/rollback
```

---

## Monitoring Checklist

Run these checks daily or after any deployment:

- [ ] All containers healthy: `docker ps --format "{{.Names}}: {{.Status}}" | grep -v healthy`
- [ ] Disk usage under 80%: `df -h /srv`
- [ ] Docker disk usage reasonable: `docker system df`
- [ ] All endpoints responding: check health URLs
- [ ] Supabase sync working: check audit logs in Supabase
- [ ] SSL certificates valid: `curl -sv https://manager.dev.codematrx.com 2>&1 | grep "expire date"`
