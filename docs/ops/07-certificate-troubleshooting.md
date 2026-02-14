# SSL Certificate Issue — Root Cause & Solution

**Date:** 2026-02-14  
**Status:** RESOLVED  
**Issue:** New deployments getting self-signed "TRAEFIK DEFAULT CERT" instead of Let's Encrypt certificates

---

## Root Cause

### The Chain of Causation

**IPv6 healthcheck bug → container "unhealthy" → Traefik skips container → no cert issued**

1. The `generateCompose()` function in `server-manager/src/index.js` was added with a healthcheck using `http://localhost:3000/api/health`
2. Inside the Alpine-based container, `wget` resolves `localhost` to `[::1]` (IPv6) first
3. The Next.js app only listens on IPv4 (`0.0.0.0:3000` / `127.0.0.1:3000`)
4. The healthcheck fails with "Connection refused" on `[::1]:3000`
5. Docker marks the container as **unhealthy**
6. **Traefik v3's Docker provider filters out unhealthy containers entirely** — no router is created
7. With no router, no Let's Encrypt certificate is requested
8. HTTPS requests get Traefik's default self-signed cert

### Why Some Instances Worked and Others Didn't

- **Older instances** (matrx-ship, ai-matrx-admin, etc.) were created before the healthcheck was added to `generateCompose()` — they had no healthcheck, so Traefik always included them
- **Newer instances** (matrx-dm, matrx-engine, matrx-mcp-servers) were created after the healthcheck was added — they all failed the IPv6 healthcheck

### Evidence from Traefik DEBUG Logs

```
# Traefik skips unhealthy containers:
DBG Filtering unhealthy or starting container  container=app-matrx-dm  providerName=docker
DBG Filtering unhealthy or starting container  container=app-matrx-mcp-servers  providerName=docker
DBG Filtering unhealthy or starting container  container=app-matrx-engine  providerName=docker

# Meanwhile, it correctly challenges healthy containers:
DBG Trying to challenge certificate for domain [ai-matrx-admin.dev.codematrx.com]
DBG Trying to challenge certificate for domain [matrx-mcp-template.dev.codematrx.com]
```

### The IPv6 Bug (reproduced inside the container)

```bash
# Fails — wget resolves localhost to [::1] (IPv6), app doesn't listen on IPv6
$ docker exec matrx-dm wget --spider http://localhost:3000/api/health
Connecting to localhost:3000 ([::1]:3000)
wget: can't connect to remote host: Connection refused

# Works — explicit IPv4
$ docker exec matrx-dm wget --spider http://127.0.0.1:3000/api/health
Connecting to 127.0.0.1:3000 (127.0.0.1:3000)
remote file exists
```

---

## The Fix

### One-Line Fix (the actual bug)

Changed `localhost` → `127.0.0.1` in the healthcheck across 2 source files:

**`server-manager/src/index.js` — `generateCompose()` (the instance template):**
```diff
- test: ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1"]
+ test: ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1"]
```

**`docker-compose.yml` (root dev/demo compose):**
```diff
- test: ["CMD-SHELL", "curl -f http://localhost:3000/api/health || exit 1"]
+ test: ["CMD-SHELL", "curl -f http://127.0.0.1:3000/api/health || exit 1"]
```

### Also Fixed (from previous agent's incorrect analysis)

- **`server-manager/src/index.js`**: Replaced the useless `requestCertificate()` function (which just curled the domain 5 times) with `waitForCertificate()` that actually polls container health first, then verifies the cert
- **`/srv/scripts/request-certificate.sh`**: Rewritten as a diagnostic tool that checks DNS, container health, Traefik labels, proxy network, and cert status
- **`.github/workflows/deploy-instance.yml`**: Updated with proper health-check-then-cert-verify flow

### Deployed Fix

Fixed the 3 affected instance compose files on disk and recreated the containers:
```bash
# Fixed /srv/apps/matrx-dm/docker-compose.yml
# Fixed /srv/apps/matrx-engine/docker-compose.yml
# Fixed /srv/apps/matrx-mcp-servers/docker-compose.yml
# Then: docker compose up -d --force-recreate app
```

---

## Verification

After the fix, all instances are healthy with Let's Encrypt certs:

```
matrx-dm:          health=healthy  cert=Let's Encrypt ✅
matrx-engine:      health=healthy  cert=Let's Encrypt ✅
matrx-mcp-servers: health=healthy  cert=Let's Encrypt ✅
matrx-ship:        health=no-hc    cert=Let's Encrypt ✅
ai-matrx-admin:    health=no-hc    cert=Let's Encrypt ✅
ai-dream:          health=no-hc    cert=Let's Encrypt ✅
matrx-sandbox:     health=no-hc    cert=Let's Encrypt ✅
matrx-dev-tools:   health=no-hc    cert=Let's Encrypt ✅
matrx-mcp-template:health=no-hc    cert=Let's Encrypt ✅
```

---

## Key Lessons

1. **Always use `127.0.0.1` instead of `localhost` in Docker healthchecks.** Alpine Linux resolves `localhost` to IPv6 `[::1]` first. Most apps (including Next.js) only listen on IPv4.

2. **Traefik v3 skips unhealthy containers entirely.** The Docker provider won't create a router for a container that Docker reports as unhealthy. No router → no cert → default self-signed cert. Certificate issues are always a symptom of something else.

3. **Certificate "tricks" (curling the domain) don't work.** Traefik requests certs automatically when it creates a router for a healthy container. You can't force it by making HTTPS requests.

---

## Files Changed (in source repo: `/srv/projects/matrx-ship`)

| File | Change |
|------|--------|
| `server-manager/src/index.js` | `localhost` → `127.0.0.1` in `generateCompose()` healthcheck |
| `server-manager/src/index.js` | `requestCertificate()` → `waitForCertificate()` |
| `docker-compose.yml` | `localhost` → `127.0.0.1` in healthcheck |
| `.github/workflows/deploy-instance.yml` | Proper health→cert verification flow |
| `/srv/scripts/request-certificate.sh` | Rewritten as diagnostic tool |
