# Setting Up a New Ship Instance from Scratch

This guide walks through deploying a brand-new Ship application instance on the server.

## Prerequisites

- Server Manager running and healthy
- Valid `MANAGER_BEARER_TOKEN`
- Source code repository accessible (public or with GITHUB_TOKEN configured)
- DNS wildcard configured for `*.dev.codematrx.com`

---

## Step 1: Prepare Your Repository

Your repository must have:

1. A `Dockerfile` in the root (or the Server Manager's default template will be used)
2. A `package.json` with a `build` and `start` script
3. Environment variables documented

### Minimal Dockerfile Example

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
EXPOSE 3000
CMD ["pnpm", "start"]
```

---

## Step 2: Deploy via Server Manager

### Option A: Admin UI

1. Go to `https://manager.dev.codematrx.com/admin/`
2. Click **Instances** → **Deploy New Instance**
3. Enter:
   - **Name**: `myapp` (lowercase, alphanumeric + hyphens only)
   - **Repository URL**: `https://github.com/org/myapp`
   - **Branch**: `main`
4. Click **Deploy**
5. Watch the build logs

### Option B: API

```bash
curl -X POST \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "myapp",
    "repo": "https://github.com/org/myapp",
    "branch": "main",
    "env": {
      "DATABASE_URL": "auto",
      "CUSTOM_VAR": "value"
    }
  }' \
  https://manager.dev.codematrx.com/api/deploy
```

### Option C: CLI

```bash
npx matrx-ship deploy \
  --name myapp \
  --repo https://github.com/org/myapp \
  --branch main
```

---

## Step 3: What Happens During Deployment

The Server Manager automatically:

1. **Creates a dedicated Postgres container** (`ship-myapp-db`) with its own data volume
2. **Generates a `docker-compose.yml`** for the instance with proper Traefik labels
3. **Clones the repository** and checks out the specified branch
4. **Builds the Docker image** from the Dockerfile
5. **Starts the app container** (`ship-myapp`) connected to the `proxy` network
6. **Configures environment variables** including the `DATABASE_URL` pointing to the dedicated DB
7. **Syncs the deployment record** to Supabase (if configured)
8. **Logs the deployment** in the audit trail

---

## Step 4: Verify Deployment

```bash
# Check containers
docker ps --filter "name=ship-myapp" --format "table {{.Names}}\t{{.Status}}"

# Expected output:
# ship-myapp      Up 2 minutes (healthy)
# ship-myapp-db   Up 2 minutes

# Check health
curl -s https://myapp.dev.codematrx.com

# Check database connection
docker exec ship-myapp-db pg_isready -U postgres
```

---

## Step 5: Configure Custom Environment Variables

### Via Admin UI
1. Go to **Instances** → select `myapp`
2. Click **Environment** tab
3. Add/modify variables
4. Click **Save & Restart**

### Via API
```bash
curl -X PUT \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"env": {"NEW_VAR": "value"}}' \
  https://manager.dev.codematrx.com/api/instances/myapp/env
```

---

## Step 6: Set Up Database Schema

If your app uses database migrations:

```bash
# Run migrations inside the app container
docker exec ship-myapp npx drizzle-kit push

# Or connect directly to the database
docker exec -it ship-myapp-db psql -U postgres
```

---

## Troubleshooting

### Build fails
- Check build logs in the Server Manager UI
- Verify `Dockerfile` syntax
- Ensure all dependencies are available
- Check that the repository is accessible

### App starts but returns 502
- Verify the app listens on port 3000
- Check app logs: `docker logs ship-myapp --tail 100`
- Verify the container is on the proxy network

### Database connection fails
- Check `DATABASE_URL` is set correctly
- Verify DB container is running: `docker ps --filter "name=ship-myapp-db"`
- Test connection: `docker exec ship-myapp-db psql -U postgres -c "SELECT 1;"`

### DNS not resolving
- Verify wildcard DNS: `dig myapp.dev.codematrx.com`
- Check Traefik is routing: `curl -H "Host: myapp.dev.codematrx.com" http://localhost`
