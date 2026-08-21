---
name: aws-production-operations
description: Operate, inspect, diagnose, and safely deploy the AI Matrx ECS/Fargate production platform in AWS us-east-1 without browser access. Use for AWS platform status, ECS services/tasks, CloudWatch logs, alarms, ECR images, ECS Exec, Terraform changes, failover checks, or migration-stage verification.
---

# AWS production operations

The source of truth is `infrastructure/aws/production-platform`. The canonical topology and migration
gates are `../common-docs/systems/infrastructure/production-infrastructure/FEATURE.md` from the workspace root.

## Identity and safety preflight

Use the restricted role for routine work:

```bash
export AWS_PROFILE=matrx-production
export AWS_REGION=us-east-1
aws sts get-caller-identity
```

The returned ARN must contain `assumed-role/matrx-production-operator/`, account `872515272894`, and
region must be `us-east-1`. Stop otherwise. Do not fall back to `matrx-admin`; it is bootstrap and
break-glass access. Do not print, copy, or inspect secret values during status work.

## Fast status

```bash
aws ecs describe-services \
  --cluster matrx-production \
  --services admin-dashboard workflow-studio aidream workflow-worker browser-worker matrx-files matrx-seo \
  --query 'services[].{service:serviceName,status:status,desired:desiredCount,running:runningCount,pending:pendingCount,rollout:deployments[0].rolloutState}' \
  --output table

aws cloudwatch describe-alarms \
  --alarm-name-prefix matrx-production- \
  --query 'MetricAlarms[].{alarm:AlarmName,state:StateValue,reason:StateReason}' \
  --output table
```

An absent service is expected until its migration stage begins. A present service is healthy only
when desired equals running, pending is zero, rollout is completed, alarms are OK, and its consumer
test passes.

## Logs

```bash
aws logs tail /matrx/production/SERVICE --since 30m --follow
```

Valid service names: `admin-dashboard`, `workflow-studio`, `aidream`, `workflow-worker`, `matrx-files`,
and `matrx-seo`. The `browser-worker` shares `/matrx/production/aidream`; select log streams whose
name begins with `browser-worker/`. Start at the first error in time, not the last cascade. ECS Exec audit output is in
`/matrx/production/ecs-exec`; network evidence is in `/matrx/production/vpc-flow`.

## Tasks, placement, and load-balancer health

```bash
aws ecs list-tasks --cluster matrx-production --service-name SERVICE
aws ecs describe-tasks --cluster matrx-production --tasks TASK_ARN
aws elbv2 describe-target-health --target-group-arn TARGET_GROUP_ARN
```

For redundant services, prove at least two healthy targets and two distinct availability zones.
`RUNNING` alone is insufficient; the load balancer must report `healthy`.

## Audited shell access

There is no SSH path. Select a running task, then use ECS Exec:

```bash
aws ecs execute-command \
  --cluster matrx-production \
  --task TASK_ARN \
  --container SERVICE \
  --interactive \
  --command '/bin/sh'
```

Use this for diagnosis, never durable repair. Fix the image/configuration in source and redeploy.
The caller is captured in CloudTrail and session output is retained in the ECS Exec log group.

## Terraform change procedure

```bash
cd infrastructure/aws/production-platform
terraform init
terraform fmt -check -recursive
terraform validate
terraform plan -out=platform.tfplan
terraform show platform.tfplan
terraform apply platform.tfplan
terraform plan -detailed-exitcode
```

Never use `-auto-approve`, an unsaved plan, or an old plan. Before applying, state the exact add/change/
destroy counts. Any destruction, DNS change, Supabase change, security-boundary widening, or change to
an existing EC2 workload requires the matching migration gate; additive preview resources do not.
The closing detailed plan must return exit code 0 (`No changes`). Plan files are disposable and must
never be committed.

## Image and deployment rules

- Build for `linux/amd64`; never copy host `node_modules` into a Docker build.
- Push a full 40-character Git SHA tag to ECR. Never deploy `latest`.
- An ordinary `aidream` main-branch push may build/cache an image and refresh the EC2 replica, but it
  does not own production ECS. Production moves only when the root `pyproject.toml` version advances
  through the canonical release process or an operator explicitly dispatches the deployment workflow.
  The release script dispatches its immutable version tag into a dedicated production concurrency lane;
  ordinary replica builds cannot cancel it. The workflow updates `workflow-worker` first, then
  `aidream`, and verifies the exact SHA. It does not replace `browser-worker` unless the explicit
  `deploy_browser_worker=true` input is set.
- Use `browser_image_only=true` to build and publish an immutable browser-worker image without moving
  any runtime. Before `deploy_browser_worker=true`, stop admitting new browser runs, checkpoint and
  stop every active run, and prove the current checkpoint for each profile is verified. The current
  fixed worker identity cannot overlap old and new tasks; replacing it without that drain loses the
  live process even though the durable profile remains recoverable.
- AI Dream builds outside Coolify must pass Docker build args `GIT_SHA=<full SHA>` and
  `BUILD_TIME=<UTC timestamp>`; after deployment, `/health/version` must return that SHA rather than
  `unknown`.
- Confirm the ECR digest, task definition image, and running task digest agree.
- Use a circuit-breaker-protected rolling ECS deployment, wait for service stability, then exercise
  the real endpoint and dependent systems.
- Do not use the AWS CLI stock `services-stable` waiter for AI Dream. The intentional one-at-a-time
  two-task rollout can exceed its roughly ten-minute window. Require one completed deployment, the
  exact task definition, desired equal to running, and zero pending for up to thirty minutes.
- AI Dream performs catalog synchronization before mounting its API and has a measured startup time
  just over four minutes. Its ECS service therefore uses a 600-second load-balancer health grace
  period. During that window, require the previous healthy pair to remain in service; do not shorten
  the grace period or treat an initializing target as capacity. A task stopped after the grace period
  is a real failure and requires its stopped reason plus CloudWatch startup logs.
- A deployment is complete only after task loss, rolling replacement, and rollback are proven for
  that service class.

## Failure rehearsal

Only rehearse on a duplicate service before DNS cutover. Stop one task with a written reason, issue
continuous requests, wait for ECS stability, and verify two healthy targets in two AZs afterward.
Do not stop the last healthy target. After production cutover, follow the fleet-incident skill for an
unplanned outage and preserve evidence before changing state.

## Secrets

Terraform creates secret containers but never their values. Use stdin or a protected file descriptor
for an approved copy operation, verify key names and consumers without emitting values, and remove
temporary material immediately. Never use `echo SECRET`, command-line JSON containing values, shell
history, Terraform variables/state, logs, documentation, or Git. A secret update is incomplete until
the task is replaced and the consumer passes its live test.

## Persistent Cloud Browser acceptance

The worker is private: do not add a public listener, public IP, or SSH rule. AI Dream reaches
`matrx-browser-worker.platform.matrx.internal:8002` for signed control and port `8080` for the
authenticated Selkies proxy. Active profiles mount encrypted EFS at `/profiles`; the AI Dream task
role, not the worker, owns the exact KMS/S3 checkpoint permissions.

After deployment, prove all of the following:

```bash
aws ecs describe-services \
  --cluster matrx-production \
  --services browser-worker \
  --query 'services[0].{desired:desiredCount,running:runningCount,pending:pendingCount,rollout:deployments[0].rolloutState,task:taskDefinition}'

aws logs tail /matrx/production/aidream --since 15m --log-stream-name-prefix browser-worker

aws cloudwatch describe-alarms \
  --alarm-names matrx-production-browser-worker-not-running matrx-production-browser-worker-memory-high
```

Then use `https://www.aimatrx.com/chat/new` → globe → Cloud Browser and complete create, harmless
navigate, screenshot, human takeover, stop/checkpoint, and reopen/restore. `stream.aimatrx.com` must
resolve to the AWS load balancer before takeover acceptance; `turn.aimatrx.com` remains the TURN host.
Never send a real Vault credential to a third-party site without the user's action-time confirmation.

## Cutover boundary

Routine operators may inspect, deploy an already-approved SHA, scale within declared bounds, and
replace unhealthy tasks. They may not move DNS, migrate Supabase, retire Coolify/EC2, widen public
access, or delete protected data outside the explicit stage ledger and rollback window.
