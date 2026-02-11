# Deploying Matrx Ship Instances

This guide covers deploying one or more matrx-ship instances on a single server using Docker Compose. Each instance tracks a single project.

## Prerequisites 

The server needs:
- Docker and Docker Compose (v2)
- Git
- A domain or subdomain per instance (e.g., `ship-realsingles.yourdomain.com`)
- A reverse proxy (Nginx, Caddy, or Coolify's built-in Traefik) for HTTPS and routing

## Step 1: Clone the Repo

```bash
cd /opt  # or wherever you keep services
git clone https://github.com/armanisadeghi/matrx-ship.git matrx-ship-template
```

This is your template. You'll create a directory per project.

## Step 2: Create an Instance for a Project

For each project, create a separate directory with its own `.env` and `docker-compose.yml`:

```bash
# Example: create instance for "real-singles"
mkdir -p /opt/ship-instances/real-singles
cd /opt/ship-instances/real-singles

# Copy docker-compose and Dockerfile reference
cat > docker-compose.yml << 'EOF'
services:
  app:
    build: /opt/matrx-ship-template
    ports:
      - "${PORT:-3001}:3000"
    environment:
      DATABASE_URL: postgresql://ship:${POSTGRES_PASSWORD}@db:5432/ship
      MATRX_SHIP_API_KEY: ${MATRX_SHIP_API_KEY}
      PROJECT_NAME: ${PROJECT_NAME}
      VERCEL_ACCESS_TOKEN: ${VERCEL_ACCESS_TOKEN:-}
      VERCEL_PROJECT_ID: ${VERCEL_PROJECT_ID:-}
      VERCEL_TEAM_ID: ${VERCEL_TEAM_ID:-}
      VERCEL_WEBHOOK_SECRET: ${VERCEL_WEBHOOK_SECRET:-}
      GITHUB_WEBHOOK_SECRET: ${GITHUB_WEBHOOK_SECRET:-}
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: ship
      POSTGRES_USER: ship
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ship"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  pgdata:
EOF
```

## Step 3: Configure the Instance

```bash
cat > .env << 'EOF'
# Unique port for this instance (increment for each project)
PORT=3001

# Database password (generate a real one)
POSTGRES_PASSWORD=GENERATE_A_STRONG_PASSWORD_HERE

# API key (generate one or leave blank for auto-generation on first boot)
MATRX_SHIP_API_KEY=

# Display name
PROJECT_NAME=real-singles

# Vercel integration (optional — get from Vercel project settings)
VERCEL_ACCESS_TOKEN=
VERCEL_PROJECT_ID=
VERCEL_TEAM_ID=
EOF
```

To generate secure passwords/keys:
```bash
# Generate a DB password
openssl rand -hex 16

# Generate an API key
echo "sk_ship_$(openssl rand -hex 16)"
```

## Step 4: Start the Instance

```bash
cd /opt/ship-instances/real-singles
docker compose up -d
```

On first boot it will:
1. Build the Next.js app from the template
2. Start PostgreSQL
3. Run database migrations automatically
4. Seed initial v1.0.0 version
5. Generate and print an API key if you left `MATRX_SHIP_API_KEY` blank

**Check the API key from logs:**
```bash
docker compose logs app | grep "API key"
```

**Verify it's running:**
```bash
curl http://localhost:3001/api/health
```

## Step 5: Set Up Reverse Proxy

Each instance needs a subdomain. Example with Nginx:

```nginx
server {
    listen 443 ssl;
    server_name ship-realsingles.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

If using **Coolify**, just add the service via the UI and point it to the docker-compose file. Coolify handles Traefik + SSL automatically.

## Step 6: Connect a Project

On your development machine, in the project you want to track:

```bash
# Install the CLI
curl -sL https://raw.githubusercontent.com/armanisadeghi/matrx-ship/main/cli/install.sh | bash

# Configure with your instance URL and API key
# Edit .matrx-ship.json with:
#   url: https://ship-realsingles.yourdomain.com
#   apiKey: sk_ship_xxxxxxxxxxxx

# Test the connection
npx tsx scripts/matrx/ship.ts status

# Ship!
pnpm ship "first tracked commit"
```

## Running Multiple Instances

Just repeat Steps 2-5 with a different directory, port, and project name:

```
/opt/ship-instances/
  real-singles/     -> PORT=3001, ship-realsingles.yourdomain.com
  matrx-platform/   -> PORT=3002, ship-platform.yourdomain.com
  clawdbot/         -> PORT=3003, ship-clawdbot.yourdomain.com
  matrx-chrome/     -> PORT=3004, ship-chrome.yourdomain.com
```

Each gets its own PostgreSQL database, API key, and admin portal.

Resource usage per instance: ~100MB RAM for the app + ~50MB for Postgres = ~150MB each. A 2GB VPS can comfortably run 10+ instances.

## Updating All Instances

When you push updates to the matrx-ship template repo:

```bash
# Pull latest template
cd /opt/matrx-ship-template
git pull

# Rebuild each instance
cd /opt/ship-instances/real-singles
docker compose up -d --build

# Repeat for other instances, or script it:
for dir in /opt/ship-instances/*/; do
  echo "Rebuilding $(basename $dir)..."
  (cd "$dir" && docker compose up -d --build)
done
```

## Troubleshooting

**App won't start:**
```bash
docker compose logs app
```

**Database connection failed:**
```bash
docker compose logs db
docker compose exec db pg_isready -U ship
```

**Migration failed:**
Check that the `drizzle/` directory was copied into the image. Rebuild:
```bash
docker compose up -d --build --force-recreate
```

**API key not working:**
```bash
# Check what key was generated
docker compose logs app | grep -i "api key"

# Or check the database directly
docker compose exec db psql -U ship ship -c "SELECT key FROM api_keys;"
```
