# Secret location matrix

Check both configured state and runtime state. A blank result must name the exact account/project/region/environment searched.

## Local workstations and repositories

- Tracked files, untracked files, ignored `.env*`, secret JSON, credential files, shell profiles, tool configs, `.npmrc`, `.pypirc`, cloud CLI configs, macOS Keychain references, local databases, logs, crash dumps, terminal transcripts, editor history, clipboard-derived scratch files, downloads, and backups.
- Every relevant repository, worktree, submodule, stash, tag, remote ref, and full Git history. Scan packed objects and LFS where used.
- Docker/Compose env files, build args, build cache, image history/layers, local volumes, running and stopped containers, Kubernetes manifests, Helm values, and generated deployment artifacts.
- Search identifiers first. For value checks, compare SHA-256 prefixes and suppress matching lines.

## GitHub and CI/CD

- Repository, environment, organization, Codespaces, Dependabot, and Actions secrets/variables.
- Workflow files, action inputs, build logs/artifacts/caches, release assets, packages, deployment environments, and GitHub secret-scanning alerts.
- Other CI providers connected to the repository, including deploy hooks and bot/app credentials.

## Coolify

- Team shared variables; project and environment variables; every application/service variable, including normal, preview, build-time, and compose-specific records.
- All environments, not only production: active, preview, development, stopped, and failed deployments.
- Running and stopped container environments, image metadata/layers, mounted env files, Docker volumes, deployment artifacts, host filesystem copies, backup jobs, and the Coolify database/configuration records.
- Redeploy/restart after edits, then inspect the newly running container. A Coolify UI save alone is not evidence.

Current estate entry points:

- Coolify control plane: `https://coolify.app.matrxserver.com`
- Primary aidream production: `https://server.app.matrxserver.com`
- aidream development: `https://dev.app.matrxserver.com`

## Matrx Server Manager and non-Coolify servers

- Manager secret stores at `https://manager.dev.codematrx.com/admin/secrets`.
- Hosted-service records, application deployments, generated env files, per-host stores, and SSM-backed EC2 env files.
- On each host: systemd unit `Environment`/`EnvironmentFile`, process-manager configs, Docker/Compose, cron, user profiles, application directories, release directories, shared envs, logs, backups, and running process/container environments.
- Enumerate servers from the manager first; do not treat the currently open server as the server list.
- Compare the live process/container fingerprint with the exact Manager or host env file used on the next restart. After **Apply**, refresh/re-read that persisted store before accepting success; a one-off runtime update can otherwise hide a stale key that will return on recreate.

## Vercel

- Every team and project, across Production, Preview, and Development.
- Shared environment variables, project variables, framework/build settings, integrations, deploy hooks, edge/function runtime config, old deployments, build logs, and local `.vercel` state.
- Redeploy the affected environment and verify the production/preview URL after changing variables.

## AWS

- Enumerate every authorized account, role, organization member account, partition, and enabled region.
- Secrets Manager, SSM Parameter Store, AppConfig, KMS aliases/grants, IAM user access keys, IAM roles/policies, and service-linked credentials.
- Lambda env/layers/versions, ECS task definitions/services, EKS Secrets/ConfigMaps/workloads, Batch definitions/jobs, EC2 user data/tags/launch templates/Auto Scaling, Elastic Beanstalk, App Runner, Lightsail, Amplify, CloudFormation/CDK outputs and parameters, CodeBuild/CodePipeline, Glue, EMR, SageMaker, Step Functions, EventBridge targets, and API Gateway authorizers/integrations.
- S3 config/env/backups, ECR image layers, CloudWatch logs, snapshots/AMIs, and stopped resources.
- Query all regions even when the known workload lives in one region.

## Google Cloud and Firebase

- Enumerate every supplied organization, folder, project, billing-linked project, and account. Record inaccessible projects rather than silently skipping them.
- Google Auth Platform OAuth clients, deleted/recoverable clients, authorized origins/redirects, consent-screen scopes, test users, and user grants.
- API Keys inventory, restrictions, API targets, last-use telemetry where available, and deleted-key recovery state.
- IAM service accounts, every user-managed key ID, workload identity federation, service-account impersonation, default service accounts, and domain-wide delegation.
- Secret Manager; Cloud Run services/jobs; Cloud Functions generations; App Engine; Compute metadata/startup scripts/templates; GKE Secrets/workloads; Cloud Build; Artifact Registry; Composer; Dataflow; Workflows; Scheduler; Firebase Functions/Hosting extensions/config; and local Firebase Admin JSON copies.
- After deletion, list the exact OAuth client, API-key resource, or service-account key ID again to prove absence.

## Supabase and databases

- Every Supabase organization/project, Edge Function secret, project secret, CLI/local env, integration setting, database webhook, Vault entry, and deployment log.
- AI Matrx canonical user/org application vault: `users.user_secrets` and its organization-scoped access path. Query metadata/key names and ownership; never select decrypted values into output.
- Database rows that store tokens, API keys, encrypted blobs, legacy vault pointers, or safe credential metadata. Check soft-deleted rows and migration/history tables without restoring secrets accidentally.

## Other provider consoles

- DNS/CDN/Cloudflare, email/SMS, payments, observability, AI-model providers, registries, package managers, mobile app stores, browser-extension stores, analytics, CMS, and SaaS integrations.
- For each provider, enumerate organizations/workspaces and service accounts, not only the default dashboard.

## Credential ledger fields

Use one row per credential consumer:

| Field | Meaning |
|---|---|
| provider/resource | Immutable provider ID, key ID, client ID, or secret ARN/name |
| fingerprint | SHA-256 prefix only |
| owner | Account, organization, project, region |
| store | Console/store and exact path or app/environment |
| runtime | Process, container, function, task, or deployment consuming it |
| purpose | API/product capability actually proven |
| state | old, replacement, revoked, inaccessible, or historical-only |
| evidence | Query/canary/deployment/production check and timestamp |
| action owner | Who can finish an inaccessible item |

## Rotation sequence

`inventory → replacement → least-privilege restriction → provider canary → update every saved store → deploy/restart → runtime verification → production test → old-fingerprint resweep → revoke/delete → provider absence check → final all-estate sweep`
