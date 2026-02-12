# Deployment Guide

Complete guide for deploying matrx-ship using GitHub Actions CI/CD.

## Table of Contents

- [Overview](#overview)
- [Initial Setup](#initial-setup)
- [Deployment Workflows](#deployment-workflows)
- [Emergency Procedures](#emergency-procedures)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)

## Overview

### Architecture

```
┌─────────────────┐
│ GitHub Repo     │
│ (main/develop)  │
└────────┬────────┘
         │ push
         ↓
┌─────────────────┐
│ GitHub Actions  │
│ • Lint          │
│ • Build         │
│ • Test          │
│ • Docker Build  │
└────────┬────────┘
         │ push image
         ↓
┌─────────────────┐
│ GitHub Registry │
│ (ghcr.io)       │
└────────┬────────┘
         │ SSH deploy
         ↓
┌─────────────────────────────────┐
│ Production Server               │
│ ┌─────────────────────────────┐ │
│ │ /srv/apps/                  │ │
│ │ ├── matrx-ship/             │ │
│ │ ├── ai-matrx-admin/         │ │
│ │ ├── matrx-sandbox/          │ │
│ │ └── ...                     │ │
│ └─────────────────────────────┘ │
└─────────────────────────────────┘
```

### Deployment Environments

| Environment | Branch | URL | Auto-Deploy |
|-------------|--------|-----|-------------|
| Production | `main` | `https://manager.dev.codematrx.com` | ✅ Yes |
| Staging | `develop` | `https://staging-manager.dev.codematrx.com` | ✅ Yes |

## Initial Setup

### 1. Generate SSH Keys

Run the setup script:

```bash
.github/setup-ssh.sh
```

Or manually:

```bash
ssh-keygen -t ed25519 -C "github-actions-matrx-ship" \
  -f ~/.ssh/github-actions-matrx-ship -N ""
```

### 2. Add Public Key to Server

```bash
ssh-copy-id -i ~/.ssh/github-actions-matrx-ship.pub root@srv504398.hstgr.cloud
```

Or manually:

```bash
ssh root@srv504398.hstgr.cloud
cat >> ~/.ssh/authorized_keys << 'EOF'
<paste public key here>
EOF
chmod 600 ~/.ssh/authorized_keys
```

### 3. Configure GitHub Secrets

Go to: `https://github.com/armanisadeghi/matrx-ship/settings/secrets/actions`

Add these secrets:

| Name | Value | Required |
|------|-------|----------|
| `DEPLOY_HOST` | `srv504398.hstgr.cloud` | ✅ Yes |
| `DEPLOY_USER` | `root` | ✅ Yes |
| `DEPLOY_SSH_KEY` | `<private key content>` | ✅ Yes |
| `DEPLOY_PORT` | `22` | ⚪ Optional |
| `STAGING_DEPLOY_HOST` | `<staging server>` | ⚪ Optional |
| `STAGING_DEPLOY_USER` | `deploy` | ⚪ Optional |
| `STAGING_DEPLOY_SSH_KEY` | `<staging key>` | ⚪ Optional |

### 4. Test SSH Connection

```bash
ssh -i ~/.ssh/github-actions-matrx-ship root@srv504398.hstgr.cloud
```

### 5. Verify Server Setup

On the server, ensure:

```bash
# Docker is installed and running
docker --version
docker compose version

# Instances directory exists
ls -la /srv/apps/

# At least one instance is configured
ls -la /srv/apps/matrx-ship/
```

## Deployment Workflows

### Automatic Deployment

#### Production (main branch)

```bash
git checkout main
git pull origin main

# Make your changes
git add .
git commit -m "feat: add new feature"
git push origin main
```

**What happens:**
1. GitHub Actions triggers on push
2. Runs lint and type checks
3. Builds the application
4. Builds Docker image and pushes to ghcr.io
5. SSHs into production server
6. Pulls latest image
7. Restarts all matrx-ship instances
8. Runs health checks

**Timeline:** ~5-10 minutes

#### Staging (develop branch)

```bash
git checkout develop
git pull origin develop

# Make your changes
git add .
git commit -m "feat: add new feature"
git push origin develop
```

**What happens:** Same as production, but deploys to staging instances only.

### Manual Deployment

#### Deploy Specific Instance

Use this when you want to deploy to a single instance without affecting others:

1. Go to: `Actions` → `Deploy Specific Instance`
2. Click `Run workflow`
3. Enter instance name (e.g., `matrx-ship`)
4. Choose whether to skip Docker build
5. Click `Run workflow`

**Use cases:**
- Testing a deployment on one instance
- Restarting a specific instance
- Quick deployment without full rebuild

#### Deploy Without Build

If you just want to restart instances with the existing image:

1. Go to: `Actions` → `Deploy Specific Instance`
2. Check `Skip Docker build`
3. Enter instance name or leave blank for all
4. Click `Run workflow`

## Emergency Procedures

### Rollback Deployment

If a deployment causes issues:

1. Go to: `Actions` → `Rollback Deployment`
2. Click `Run workflow`
3. Select environment (production/staging)
4. Enter image tag to rollback to:
   - `rollback` - Previous version (auto-saved)
   - `main-abc1234` - Specific commit SHA
   - `20240101-120000` - Specific timestamp tag
5. Type `ROLLBACK` to confirm
6. Click `Run workflow`

**What happens:**
1. Validates image exists
2. Saves current version as `pre-rollback`
3. Tags target image as `latest`
4. Restarts all instances
5. Runs health checks
6. Creates GitHub issue for tracking

**Timeline:** ~2-3 minutes

### Manual Rollback (SSH)

If GitHub Actions is unavailable:

```bash
ssh root@srv504398.hstgr.cloud

# Tag rollback version as latest
docker tag matrx-ship:rollback matrx-ship:latest

# Restart all instances
cd /srv/apps
for dir in */; do
  if [ -f "$dir/docker-compose.yml" ]; then
    cd "$dir"
    docker compose up -d --force-recreate app
    cd /srv/apps
  fi
done

# Check health
curl https://matrx-ship.dev.codematrx.com/api/health
```

### Force Remove Broken Instance

If an instance is completely broken:

```bash
# Using CLI (recommended)
pnpm ship:force-remove mcp-servers --delete-data

# Or manually via SSH
ssh root@srv504398.hstgr.cloud
cd /srv/apps/mcp-servers
docker compose down -v --remove-orphans
cd /srv/apps
rm -rf mcp-servers
```

## Monitoring

### View Deployment Status

**GitHub Actions:**
- Go to: `Actions` tab
- Click on latest workflow run
- View logs for each job

**Server Logs:**
```bash
ssh root@srv504398.hstgr.cloud

# View instance logs
docker logs matrx-ship --tail 100 -f

# View all instances
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Check health
curl https://matrx-ship.dev.codematrx.com/api/health | jq
```

### Health Checks

Each instance exposes a health endpoint:

```bash
# Check specific instance
curl https://matrx-ship.dev.codematrx.com/api/health

# Expected response
{
  "status": "ok",
  "service": "matrx-ship",
  "version": "0.1.0",
  "buildNumber": 42,
  "timestamp": "2026-02-12T05:30:00.000Z"
}
```

### Monitoring Tools

**Docker Stats:**
```bash
docker stats --no-stream
```

**Container Health:**
```bash
docker inspect matrx-ship --format='{{.State.Health.Status}}'
```

**Database Status:**
```bash
docker exec db-matrx-ship pg_isready -U ship
```

## Troubleshooting

### Deployment Fails

#### SSH Connection Error

**Symptom:** `Permission denied (publickey)`

**Solution:**
```bash
# Verify SSH key on server
ssh root@srv504398.hstgr.cloud "cat ~/.ssh/authorized_keys"

# Test SSH connection
ssh -i ~/.ssh/github-actions-matrx-ship root@srv504398.hstgr.cloud

# Verify GitHub secret is correct
# Go to Settings → Secrets → DEPLOY_SSH_KEY
```

#### Docker Pull Fails

**Symptom:** `Error response from daemon: pull access denied`

**Solution:**
```bash
# Check if image was pushed
# Go to: Packages → matrx-ship

# Manually pull to test
docker pull ghcr.io/armanisadeghi/matrx-ship:latest

# Check GITHUB_TOKEN permissions
# Go to Settings → Actions → General → Workflow permissions
# Ensure "Read and write permissions" is enabled
```

#### Build Fails

**Symptom:** `Error: Build failed with exit code 1`

**Solution:**
```bash
# Test build locally
pnpm install
pnpm build

# Check for TypeScript errors
pnpm tsc --noEmit

# Check for linting errors
pnpm lint
```

### Instance Not Starting

#### Health Check Fails

**Symptom:** `/api/health` returns 503 or times out

**Solution:**
```bash
ssh root@srv504398.hstgr.cloud

# Check container logs
docker logs matrx-ship --tail 100

# Check database
docker logs db-matrx-ship --tail 50

# Check container status
docker ps -a | grep matrx-ship

# Restart if needed
cd /srv/apps/matrx-ship
docker compose restart
```

#### Migration Fails

**Symptom:** `Migration failed` in logs

**Solution:**
```bash
# Check migration logs
docker logs matrx-ship 2>&1 | grep -i migration

# Access database
docker exec -it db-matrx-ship psql -U ship ship

# Check migrations table
SELECT * FROM drizzle_migrations;

# If needed, manually fix and restart
cd /srv/apps/matrx-ship
docker compose restart app
```

#### Database Connection Error

**Symptom:** `relation "app_version" does not exist`

**Solution:**
```bash
# Check database is healthy
docker exec db-matrx-ship pg_isready -U ship

# Check database logs
docker logs db-matrx-ship --tail 50

# Verify DATABASE_URL
cd /srv/apps/matrx-ship
cat .env | grep DATABASE_URL

# Restart both containers
docker compose restart
```

### Performance Issues

#### High CPU Usage

```bash
# Check container stats
docker stats --no-stream

# Check processes inside container
docker exec matrx-ship ps aux

# Check logs for errors
docker logs matrx-ship --tail 200 | grep -i error
```

#### High Memory Usage

```bash
# Check memory usage
docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}"

# Restart to clear memory
cd /srv/apps/matrx-ship
docker compose restart app
```

## Best Practices

### Development Workflow

1. **Create feature branch:**
   ```bash
   git checkout -b feature/my-feature
   ```

2. **Make changes and test locally:**
   ```bash
   pnpm dev
   pnpm build
   pnpm tsc --noEmit
   ```

3. **Push to feature branch:**
   ```bash
   git push origin feature/my-feature
   ```

4. **Create Pull Request to `develop`**

5. **After PR merge, test in staging:**
   - Automatic deployment to staging
   - Verify at staging URL

6. **Create PR from `develop` to `main`**

7. **After merge, automatic production deployment**

### Deployment Checklist

Before deploying to production:

- [ ] All tests pass locally
- [ ] TypeScript compiles without errors
- [ ] Linter passes
- [ ] Changes tested in staging
- [ ] Database migrations tested
- [ ] Health checks pass
- [ ] No breaking changes
- [ ] Documentation updated
- [ ] Rollback plan ready

### Security Best Practices

- ✅ Use separate SSH keys for CI/CD
- ✅ Rotate SSH keys every 90 days
- ✅ Never commit secrets to repository
- ✅ Use GitHub Secrets for sensitive data
- ✅ Limit SSH key permissions (deploy user)
- ✅ Monitor deployment logs
- ✅ Enable 2FA on GitHub
- ✅ Review workflow changes carefully

## Support

For deployment issues:

1. Check this documentation
2. Review workflow logs in Actions tab
3. Check server logs via SSH
4. Contact DevOps team
5. Create GitHub issue with logs

## Additional Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Docker Documentation](https://docs.docker.com/)
- [Next.js Deployment](https://nextjs.org/docs/deployment)
- [Workflow README](.github/workflows/README.md)
