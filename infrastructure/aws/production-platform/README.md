# Matrx production platform on AWS

This Terraform root owns the production application platform in AWS account `872515272894`,
region `us-east-1`. AI Dream, the workflow worker, the Admin Dashboard, Workflow Studio, and the
persistent browser worker run here. Coolify retains only the explicitly declared residual plane.

The foundation provides two-AZ private Fargate networking, redundant NAT gateways, private
connectivity to the existing sandbox VPC, ECS Container Insights, application and ECS Exec logs,
VPC flow logs, a seven-year multi-region CloudTrail archive, private service discovery, ECR
repositories, service-specific task roles, runtime-secret containers, and a routine operator role.

Cross-repo system-of-record: /Users/armanisadeghi/code/common-docs/systems/infrastructure/production-infrastructure/FEATURE.md — read it before touching this feature in ANY repo.

Browser-free operations use the `aws-production-operations` skill in this repository.

Terraform state is encrypted, versioned, and lock-protected at:

`s3://matrx-terraform-state-872515272894/aws/production-platform/terraform.tfstate`

## Safe operator workflow

```bash
cd infrastructure/aws/production-platform
terraform init
terraform fmt -check
terraform validate
terraform plan -out=platform.tfplan
terraform show platform.tfplan
terraform apply platform.tfplan
```

Never use `-auto-approve`. Apply only a saved plan created from the same checkout and AWS identity.
The account and region checks deliberately refuse a plan against any other target.

## Access model

- Human administration remains available through the existing AWS Identity Center administrator.
- Bootstrap Terraform currently uses the existing `matrx-admin` CLI identity.
- Routine agents and operators assume `arn:aws:iam::872515272894:role/matrx/platform/matrx-production-operator`.
- Application tasks receive service-specific IAM roles. They do not inherit operator permissions.
- Container access uses ECS Exec: no SSH ports or host keys. Commands and output are retained for
  one year in `/matrx/production/ecs-exec`, and the caller is recorded by CloudTrail.
- Runtime values live in Secrets Manager under `/matrx/production/*`. Terraform owns secret
  containers only and never stores secret values in state or source control.
- Temporary Supabase migration credentials live in the operator-only
  `/matrx/migration/supabase-east` secret and are never granted to application tasks.
- Protected database export artifacts are uploaded to the KMS-encrypted, versioned
  `matrx-supabase-migration-artifacts-872515272894` bucket. Object access is recorded by CloudTrail;
  rehearsal objects expire after 90 days and non-current versions after 30 days.

## Production boundary

Production DNS already routes the declared public services to this platform. Future topology
changes still require a service canary, multi-task failover test, rolling-deployment test, rollback
rehearsal, and a same-change update to the cross-repo system of record. The scraper remains
deliberately outside this stack.

The AWS-managed wildcard certificate for `*.app.matrxserver.com` is DNS-validated and issued. The
load balancer accepts TLS 1.2/1.3 on port 443. The permanent ACM validation CNAME must remain in the
authoritative Cloudflare zone so certificate renewal stays automatic.

## Production static applications

The admin dashboard and workflow studio run as two Fargate tasks each across separate availability
zones. The public application load balancer retains access logs for 180 days, removes unhealthy
tasks from service, and allows ECS to replace tasks without dropping below the existing healthy
count. CPU and memory target tracking can grow each service from two to four tasks.

`admin.app.matrxserver.com`, `studio.app.matrxserver.com`, and `workflows.aimatrx.com` route through
the public load balancer. The direct HTTP preview remains available for low-level routing checks:

```bash
terraform output -raw preview_load_balancer_dns_name
curl --fail --show-error "http://$(terraform output -raw preview_load_balancer_dns_name)/"
curl --fail --show-error \
  -H "Host: $(terraform output -raw workflow_studio_preview_host_header)" \
  "http://$(terraform output -raw preview_load_balancer_dns_name)/"
```

The aidream GitHub release workflow builds separate Admin Dashboard and Workflow Studio images,
tags each with the full release SHA, registers new task definitions, and waits for circuit-breaker-
protected rolling deployments to reach the exact completed state. Terraform owns service shape and
ignores the release-owned task-definition pointer.

## Production AI Dream API

AI Dream runs from the exact immutable SHA selected by `aidream_image_tag`, with two 2-vCPU/4-GB
tasks across separate availability zones and autoscaling bounds of two to eight tasks. Its target
group requires `/health/ready`, waits for real database readiness, and drains long requests for two
minutes. `server.app.matrxserver.com` is the production entry point.

On 2026-08-19, SHA `76d383772195c378c3290fc7427eaa41ffeac4dc` completed a protected rolling
deployment to task-definition revision 6. Both availability-zone tasks were healthy on image digest
`sha256:906b47758b04015d2c58832bdb84bfb44dd3d30bfbf00851dd0f258e8956f1ea`; 20/20
load-balanced version checks returned that SHA, detailed health reported database/tools/environment
OK, both AI Dream alarms were OK, and a post-deployment Terraform plan reported no drift. Coolify
remained the public production target throughout that historical migration rehearsal.

```bash
curl --fail --show-error \
  -H "Host: $(terraform output -raw aidream_preview_host_header)" \
  "http://$(terraform output -raw preview_load_balancer_dns_name)/health/ready"
```

The AI Dream task receives S3 and redaction-KMS access from its service-specific task role. Static
AWS keys are deliberately absent. ECS injects its protected Secrets Manager JSON as one temporary
bootstrap value; the bootstrap expands it into the application process environment and removes the
wrapper value before executing the image's canonical entrypoint. Terraform never reads or stores the
secret payload.

## Production workflow worker

The workflow worker is the single production scheduler/queue consumer in AWS. Its database claims
and cron watcher are safe across replicas through atomic `FOR UPDATE SKIP LOCKED` claims and fenced
leases; the operator-owned desired count is currently one. It has the same IAM-based S3/KMS access
and protected runtime-secret injection as AI Dream, so no static AWS key or SSH setup is needed.

Persistent Cloud Browser lease maintenance runs here. The browser-worker security group admits its
signed control port (`8002`) from exactly the AI Dream API and workflow-worker security groups; the
interactive stream port (`8080`) remains API-only. This distinction is load-bearing: browser actions
originate in AI Dream, while idle lease renewal originates in the workflow worker.
