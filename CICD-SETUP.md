# CI/CD Setup Complete ✅

This document summarizes the CI/CD infrastructure that has been set up for matrx-ship.

## What Was Added

### 1. GitHub Actions Workflows (`.github/workflows/`)

#### **ci-cd.yml** - Main CI/CD Pipeline
- **Triggers:** Push to `main` or `develop`, Pull Requests
- **Jobs:**
  - Lint & Type Check
  - Build Application
  - Build & Push Docker Image to ghcr.io
  - Deploy to Production (main branch)
  - Deploy to Staging (develop branch)
- **Features:**
  - Automated testing and validation
  - Docker image caching for faster builds
  - Health checks after deployment
  - Automatic rollback tagging

#### **rollback.yml** - Emergency Rollback
- **Trigger:** Manual workflow dispatch
- **Purpose:** Quick rollback to previous version
- **Features:**
  - Image validation before rollback
  - Saves current version as backup
  - Health checks after rollback
  - Creates GitHub issue for tracking

#### **deploy-instance.yml** - Single Instance Deployment
- **Trigger:** Manual workflow dispatch
- **Purpose:** Deploy to specific instance
- **Features:**
  - Deploy without affecting other instances
  - Optional skip build for quick restarts
  - Instance validation
  - Health check verification

### 2. Documentation

- **`.github/workflows/README.md`** - Workflow documentation
- **`.github/DEPLOYMENT.md`** - Complete deployment guide
- **`.github/setup-ssh.sh`** - SSH key setup script

### 3. Bug Fixes Applied

All the critical fixes from earlier are included:
- ✅ Fixed SQL migration (duplicate column names)
- ✅ Added fail-fast error handling in production
- ✅ Added Docker healthchecks
- ✅ Added curl to Dockerfile
- ✅ Fixed API client JSON parsing
- ✅ Enhanced remove function with force option
- ✅ Added deployment verification to CLI

## Quick Start

### 1. Setup GitHub Secrets

Run the setup script:
```bash
.github/setup-ssh.sh
```

Then add these secrets to GitHub:
- `DEPLOY_HOST`: `srv504398.hstgr.cloud`
- `DEPLOY_USER`: `root`
- `DEPLOY_SSH_KEY`: `<private key from setup script>`

### 2. Test the Pipeline

```bash
# Create a test branch
git checkout -b test/ci-cd-setup

# Make a small change
echo "# CI/CD Test" >> README.md

# Push and create PR
git add .
git commit -m "test: verify CI/CD pipeline"
git push origin test/ci-cd-setup
```

Go to GitHub and create a Pull Request. The CI/CD pipeline will run automatically.

### 3. Deploy to Staging

```bash
# Merge to develop branch
git checkout develop
git merge test/ci-cd-setup
git push origin develop
```

This will automatically deploy to staging instances.

### 4. Deploy to Production

```bash
# Merge to main branch
git checkout main
git merge develop
git push origin main
```

This will automatically deploy to all production instances.

## Deployment Flow

```
┌─────────────────────────────────────────────────────────────┐
│ Developer pushes to main                                    │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────────────────┐
│ GitHub Actions: CI/CD Pipeline                              │
│                                                              │
│ 1. Lint & Type Check ✓                                      │
│ 2. Build Application ✓                                      │
│ 3. Build Docker Image ✓                                     │
│ 4. Push to ghcr.io ✓                                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ↓
┌─────────────────────────────────────────────────────────────┐
│ SSH to Production Server                                    │
│                                                              │
│ 1. Pull latest image from ghcr.io                           │
│ 2. Tag as matrx-ship:latest                                 │
│ 3. Save current as matrx-ship:rollback                      │
│ 4. Restart all instances:                                   │
│    - matrx-ship                                             │
│    - ai-matrx-admin                                         │
│    - matrx-sandbox                                          │
│    - ... (all instances using matrx-ship:latest)            │
│ 5. Run health checks                                        │
└─────────────────────────────────────────────────────────────┘
```

## Emergency Procedures

### Rollback

If something goes wrong:

1. Go to **Actions** → **Rollback Deployment**
2. Click **Run workflow**
3. Select **production**
4. Enter **rollback** (or specific tag)
5. Type **ROLLBACK** to confirm
6. Click **Run workflow**

### Manual Rollback (if GitHub Actions is down)

```bash
ssh root@srv504398.hstgr.cloud
docker tag matrx-ship:rollback matrx-ship:latest
cd /srv/apps
for dir in */; do
  cd "$dir"
  docker compose up -d --force-recreate app
  cd /srv/apps
done
```

## Monitoring

### View Deployment Status

- **GitHub:** Actions tab → Latest workflow run
- **Server:** `ssh root@srv504398.hstgr.cloud`
  ```bash
  docker ps
  docker logs matrx-ship --tail 100
  curl https://matrx-ship.dev.codematrx.com/api/health
  ```

### Health Checks

All instances expose `/api/health`:
```bash
curl https://matrx-ship.dev.codematrx.com/api/health
curl https://ai-matrx-admin.dev.codematrx.com/api/health
curl https://matrx-sandbox.dev.codematrx.com/api/health
```

## Next Steps

1. **Setup GitHub Secrets** (see Quick Start #1)
2. **Test the pipeline** with a small PR
3. **Configure staging** (optional)
4. **Train team** on deployment procedures
5. **Document instance-specific** configurations
6. **Set up monitoring** alerts (optional)

## Benefits

### Before CI/CD
- ❌ Manual Docker builds
- ❌ Manual SSH deployments
- ❌ No automated testing
- ❌ No rollback mechanism
- ❌ Inconsistent deployments
- ❌ Human error prone

### After CI/CD
- ✅ Automated builds on every push
- ✅ Automated deployments
- ✅ Automated testing (lint, type check, build)
- ✅ One-click rollback
- ✅ Consistent, repeatable deployments
- ✅ Audit trail (GitHub Actions logs)
- ✅ Health checks after deployment
- ✅ Staging environment support

## Security

- ✅ SSH keys stored as encrypted GitHub Secrets
- ✅ Secrets never exposed in logs
- ✅ Separate keys for CI/CD
- ✅ Docker images in private registry (ghcr.io)
- ✅ Workflow permissions properly scoped

## Support

- **Documentation:** `.github/DEPLOYMENT.md`
- **Workflow Docs:** `.github/workflows/README.md`
- **Issues:** Create GitHub issue with logs
- **Emergency:** SSH access + manual procedures documented

## Files Changed

### New Files
```
.github/
├── workflows/
│   ├── ci-cd.yml              # Main CI/CD pipeline
│   ├── rollback.yml           # Emergency rollback
│   ├── deploy-instance.yml    # Single instance deployment
│   └── README.md              # Workflow documentation
├── DEPLOYMENT.md              # Complete deployment guide
└── setup-ssh.sh               # SSH key setup script
```

### Modified Files
```
Dockerfile                     # Added curl for healthcheck
docker-compose.yml             # Added app healthcheck
src/instrumentation.ts         # Added fail-fast in production
drizzle/migrations/0002_*.sql  # Fixed duplicate column names
```

## Commit This Setup

```bash
git add .
git commit -m "feat: add CI/CD pipeline with GitHub Actions

- Add automated build, test, and deployment workflows
- Add emergency rollback workflow
- Add single instance deployment workflow
- Add comprehensive deployment documentation
- Fix SQL migration duplicate column issue
- Add fail-fast error handling in production
- Add Docker healthchecks for app containers
- Add deployment verification and monitoring

BREAKING CHANGE: Deployments now automated via GitHub Actions
"
git push origin main
```

This will trigger the first automated deployment! 🚀
