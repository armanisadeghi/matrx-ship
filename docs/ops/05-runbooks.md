# Operational Runbooks

## Runbook: Adding a New Ship Instance

### Via Server Manager Admin UI (Recommended)
1. Navigate to `https://manager.dev.codematrx.com/admin/`
2. Go to **Instances** tab
3. Click **Deploy New Instance**
4. Fill in:
   - **Name**: Lowercase, no spaces (becomes the subdomain)
   - **Repository**: Full GitHub URL
   - **Branch**: Branch to deploy (default: `main`)
5. Click **Deploy**
6. Monitor the build log for completion
7. Verify at `https://{name}.dev.codematrx.com`

### Via CLI/API
```bash
curl -X POST \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "myapp",
    "repo": "https://github.com/org/repo",
    "branch": "main"
  }' \
  https://manager.dev.codematrx.com/api/deploy
```

### Post-Deployment Checklist
- [ ] App accessible at `https://{name}.dev.codematrx.com`
- [ ] Database container running: `docker ps --filter "name=ship-{name}-db"`
- [ ] Health check passing
- [ ] Traefik routing confirmed
- [ ] Instance synced to Supabase

---

## Runbook: Removing a Ship Instance

### Via Admin UI
1. Go to **Instances** tab
2. Click the instance
3. Click **Remove** and confirm

### Via API
```bash
curl -X DELETE \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  https://manager.dev.codematrx.com/api/instances/myapp
```

### Cleanup Verification
- [ ] App container removed
- [ ] Database container removed
- [ ] Data directory cleaned (or backed up first)
- [ ] Supabase record updated

---

## Runbook: Updating the Server Manager

### Standard Update (via Deploy Server)
1. Go to `https://deploy.dev.codematrx.com`
2. Navigate to **Manager Control**
3. Check **Pending Changes** to see what's new
4. Click **Rebuild Manager**
5. Monitor streaming build logs
6. Verify health status shows "healthy"

### Manual Update (SSH or emergency)
```bash
# Pull latest code
cd /srv/projects/matrx-ship && git pull

# Rebuild
cd /srv/apps/server-manager
docker compose up -d --build server-manager

# Verify
docker ps --filter "name=matrx-manager" --format "{{.Status}}"
curl -s https://manager.dev.codematrx.com/health
```

---

## Runbook: Updating the Deploy Server

The Deploy server can rebuild itself:

### Via Deploy UI
1. Go to `https://deploy.dev.codematrx.com`
2. Navigate to **Deploy** page
3. Click **Self-Rebuild**
4. The page will temporarily disconnect and reconnect when the new container is ready

### Via CLI
```bash
cd /srv/projects/matrx-ship && git pull
cd /srv/apps/deploy
docker compose up -d --build
```

---

## Runbook: SSL Certificate Issues

### Symptoms
- Browser shows "Not Secure" or certificate errors
- `ERR_CERT_AUTHORITY_INVALID`

### Diagnosis
```bash
# Check cert expiry
echo | openssl s_client -connect manager.dev.codematrx.com:443 2>/dev/null | openssl x509 -noout -dates

# Check Traefik acme.json
ls -la /srv/traefik/acme.json
cat /srv/traefik/acme.json | jq '.letsencrypt.Certificates | length'

# Check Traefik logs for ACME errors
docker logs traefik 2>&1 | grep -i "acme\|certificate\|tls" | tail -20
```

### Resolution
1. **Wait** — Let's Encrypt has rate limits. Certificates auto-renew 30 days before expiry.
2. **Force renewal:**
   ```bash
   # Remove acme storage (will request new certs)
   rm /srv/traefik/acme.json
   docker restart traefik
   # Wait 2-3 minutes for new certs to be issued
   ```
3. **Check DNS** — Ensure `*.dev.codematrx.com` points to the server IP
4. **Check port 80** — Let's Encrypt HTTP-01 challenge requires port 80 to be open

---

## Runbook: Container OOM (Out of Memory)

### Symptoms
- Container keeps restarting
- `docker inspect` shows OOMKilled: true
- System is sluggish

### Diagnosis
```bash
# Check if OOM killed
docker inspect {container} --format '{{.State.OOMKilled}}'

# Check memory usage
docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}"

# Check system memory
free -h
```

### Resolution
1. **Increase container memory limit** in docker-compose.yml:
   ```yaml
   deploy:
     resources:
       limits:
         memory: 2G
   ```
2. **Restart the container:**
   ```bash
   docker compose up -d {service}
   ```
3. **Investigate the leak** — check application logs for memory-related errors

---

## Runbook: Docker Daemon Issues

### Symptoms
- `docker: Cannot connect to the Docker daemon`
- All containers down

### Resolution
```bash
# Check Docker daemon status
systemctl status docker

# Restart Docker daemon
sudo systemctl restart docker

# If that fails, check Docker logs
sudo journalctl -u docker --since "10 minutes ago"

# Nuclear option: restart the server
sudo reboot
```

### After Docker Restart
All containers should auto-restart if they have `restart: unless-stopped` or `restart: always`.

Verify:
```bash
docker ps --format "table {{.Names}}\t{{.Status}}" | sort
```

If containers didn't restart:
```bash
cd /srv/traefik && docker compose up -d
cd /srv/postgres && docker compose up -d
cd /srv/apps/server-manager && docker compose up -d
cd /srv/apps/deploy && docker compose up -d
# Ship instances will be started by the Server Manager on startup
```

---

## Runbook: Backup All Databases

### One-Time Full Backup
```bash
# Backup shared Postgres
docker exec matrx-postgres pg_dumpall -U postgres > /srv/backups/shared-$(date +%Y%m%d).sql

# Backup each instance DB
for db_container in $(docker ps --filter "name=-db" --format "{{.Names}}"); do
  instance_name=$(echo $db_container | sed 's/ship-//' | sed 's/-db//')
  docker exec $db_container pg_dumpall -U postgres > "/srv/backups/${instance_name}-$(date +%Y%m%d).sql"
done

# Upload to S3 (if configured)
aws s3 sync /srv/backups/ s3://$AWS_S3_BUCKET/backups/$(date +%Y%m%d)/
```

### Restore from Backup
```bash
# Download from S3
aws s3 cp s3://$AWS_S3_BUCKET/backups/20260101/shared-20260101.sql /tmp/restore.sql

# Restore
docker exec -i matrx-postgres psql -U postgres < /tmp/restore.sql
```

---

## Runbook: Network Connectivity Issues

### Symptoms
- Services can't reach each other
- "Name resolution failed" in logs

### Diagnosis
```bash
# Check proxy network exists
docker network ls | grep proxy

# Check which containers are on the network
docker network inspect proxy --format '{{range .Containers}}{{.Name}} {{end}}'

# Test connectivity between containers
docker exec matrx-manager curl -s http://deploy-server:3000/api/health
```

### Resolution
```bash
# Recreate proxy network (if it was deleted)
docker network create proxy

# Reconnect container to network
docker network connect proxy {container-name}

# Restart Traefik to pick up routing changes
docker restart traefik
```
