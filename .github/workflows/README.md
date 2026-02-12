# GitHub Actions Workflows

This directory contains CI/CD workflows for automated building, testing, and deployment of matrx-ship.

## Workflows

### 1. CI/CD Pipeline (`ci-cd.yml`)

**Triggers:**
- Push to `main` or `develop` branches
- Pull requests to `main` or `develop`

**Jobs:**
1. **Lint & Type Check** - Validates TypeScript and runs linter
2. **Build** - Builds the Next.js application
3. **Docker** - Builds and pushes Docker image to GitHub Container Registry
4. **Deploy Production** - Deploys to production (main branch only)
5. **Deploy Staging** - Deploys to staging (develop branch only)

**Deployment Flow:**
```
Push to main → Lint → Build → Docker Build → Deploy to Production
Push to develop → Lint → Build → Docker Build → Deploy to Staging
```

### 2. Rollback Deployment (`rollback.yml`)

**Triggers:** Manual workflow dispatch

**Purpose:** Emergency rollback to a previous Docker image version

**Usage:**
1. Go to Actions → Rollback Deployment
2. Click "Run workflow"
3. Select environment (production/staging)
4. Enter the image tag to rollback to (e.g., `main-abc1234` or `rollback`)
5. Type `ROLLBACK` to confirm
6. Click "Run workflow"

**Features:**
- Validates image exists before rollback
- Saves current version as `pre-rollback` for recovery
- Runs health checks after rollback
- Creates GitHub issue to track the incident

### 3. Deploy Specific Instance (`deploy-instance.yml`)

**Triggers:** Manual workflow dispatch

**Purpose:** Deploy to a specific instance without affecting others

**Usage:**
1. Go to Actions → Deploy Specific Instance
2. Click "Run workflow"
3. Enter instance name (e.g., `matrx-ship`, `ai-matrx-admin`)
4. Optionally skip Docker build to use existing image
5. Click "Run workflow"

**Use Cases:**
- Deploy to a single instance for testing
- Restart a specific instance after configuration changes
- Quick deployment without full rebuild

## Required GitHub Secrets

Configure these secrets in your repository settings (Settings → Secrets and variables → Actions):

### Production Deployment

| Secret | Description | Example |
|--------|-------------|---------|
| `DEPLOY_HOST` | Production server hostname or IP | `srv504398.hstgr.cloud` |
| `DEPLOY_USER` | SSH username | `root` |
| `DEPLOY_SSH_KEY` | Private SSH key for authentication | `-----BEGIN OPENSSH PRIVATE KEY-----...` |
| `DEPLOY_PORT` | SSH port (optional, defaults to 22) | `22` |

### Staging Deployment (Optional)

| Secret | Description | Example |
|--------|-------------|---------|
| `STAGING_DEPLOY_HOST` | Staging server hostname (falls back to DEPLOY_HOST) | `staging.example.com` |
| `STAGING_DEPLOY_USER` | SSH username for staging (falls back to DEPLOY_USER) | `deploy` |
| `STAGING_DEPLOY_SSH_KEY` | Private SSH key for staging (falls back to DEPLOY_SSH_KEY) | `-----BEGIN OPENSSH PRIVATE KEY-----...` |
| `STAGING_DEPLOY_PORT` | SSH port for staging (falls back to DEPLOY_PORT) | `22` |

### Automatic Secrets

These are provided automatically by GitHub:

- `GITHUB_TOKEN` - Used for GitHub Container Registry authentication
- `github.actor` - The user who triggered the workflow
- `github.sha` - The commit SHA that triggered the workflow

## Setup Instructions

### 1. Generate SSH Key Pair

On your local machine:

```bash
ssh-keygen -t ed25519 -C "github-actions-matrx-ship" -f ~/.ssh/github-actions-matrx-ship
```

### 2. Add Public Key to Server

Copy the public key to your deployment server:

```bash
ssh-copy-id -i ~/.ssh/github-actions-matrx-ship.pub root@srv504398.hstgr.cloud
```

Or manually add it to `~/.ssh/authorized_keys` on the server.

### 3. Add Private Key to GitHub Secrets

1. Copy the private key:
   ```bash
   cat ~/.ssh/github-actions-matrx-ship
   ```

2. Go to GitHub repository → Settings → Secrets and variables → Actions
3. Click "New repository secret"
4. Name: `DEPLOY_SSH_KEY`
5. Value: Paste the entire private key (including `-----BEGIN` and `-----END` lines)
6. Click "Add secret"

### 4. Add Other Secrets

Repeat step 3 for:
- `DEPLOY_HOST`: `srv504398.hstgr.cloud`
- `DEPLOY_USER`: `root`
- `DEPLOY_PORT`: `22` (optional)

### 5. Enable GitHub Container Registry

The workflows automatically push Docker images to GitHub Container Registry (ghcr.io). No additional setup required - it uses the `GITHUB_TOKEN` automatically.

## Monitoring Deployments

### View Workflow Runs

1. Go to the "Actions" tab in your repository
2. Click on a workflow run to see details
3. Click on a job to see logs

### Health Checks

After deployment, the workflow automatically checks:
- `/api/health` endpoint for each instance
- Container status
- Response time

### Rollback if Needed

If a deployment fails or causes issues:

1. Go to Actions → Rollback Deployment
2. Run workflow with previous working tag
3. Monitor the rollback process
4. Verify health checks pass

## Deployment Architecture

```
GitHub Repository
  ↓ (push to main)
GitHub Actions
  ↓ (build & push)
GitHub Container Registry (ghcr.io)
  ↓ (pull via SSH)
Production Server (/srv/apps/)
  ├── matrx-ship/
  ├── ai-matrx-admin/
  ├── matrx-sandbox/
  └── ... (other instances)
```

## Troubleshooting

### Deployment Fails with SSH Error

**Problem:** `Permission denied (publickey)`

**Solution:**
1. Verify SSH key is correct in GitHub secrets
2. Ensure public key is in `~/.ssh/authorized_keys` on server
3. Check SSH key permissions on server: `chmod 600 ~/.ssh/authorized_keys`

### Docker Pull Fails

**Problem:** `Error response from daemon: pull access denied`

**Solution:**
1. Verify `GITHUB_TOKEN` has package read permissions
2. Check if the image was successfully pushed in the Docker job
3. Verify image name matches: `ghcr.io/armanisadeghi/matrx-ship`

### Health Check Fails

**Problem:** Health check returns 503 or times out

**Solution:**
1. Check container logs: `docker logs <instance-name>`
2. Verify database migrations ran successfully
3. Check if containers are running: `docker ps`
4. Review application logs for errors

### Instance Not Found

**Problem:** `Instance directory not found`

**Solution:**
1. Verify instance name is correct (case-sensitive)
2. Check available instances: `ls /srv/apps/`
3. Ensure instance was created via `pnpm ship:init`

## Best Practices

1. **Always test in staging first** - Push to `develop` branch before `main`
2. **Monitor deployments** - Watch the Actions tab during deployments
3. **Keep rollback ready** - Know the last working image tag
4. **Document changes** - Use clear commit messages
5. **Health checks** - Always verify health endpoints after deployment
6. **Gradual rollout** - Use deploy-instance workflow to test one instance first

## Security Notes

- SSH private keys are stored as encrypted secrets in GitHub
- Secrets are never exposed in logs
- Only repository admins can view/edit secrets
- Use separate SSH keys for CI/CD (don't reuse personal keys)
- Rotate SSH keys periodically
- Use deploy keys with minimal permissions

## Support

For issues with workflows:
1. Check workflow logs in Actions tab
2. Review this documentation
3. Check server logs: `docker logs <instance-name>`
4. Contact DevOps team
