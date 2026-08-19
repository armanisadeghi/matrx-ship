# Matrx production platform on AWS

This Terraform root owns the new latency-sensitive application platform in AWS account
`872515272894`, region `us-east-1`. It is additive during migration: applying it does not change
Coolify DNS, Vercel, Supabase, the scraper, or either existing EC2 workload.

The foundation provides two-AZ private Fargate networking, redundant NAT gateways, private
connectivity to the existing sandbox VPC, ECS Container Insights, application and ECS Exec logs,
VPC flow logs, a seven-year multi-region CloudTrail archive, private service discovery, ECR
repositories, service-specific task roles, runtime-secret containers, and a routine operator role.

The full cross-system topology and stage ledger live in
`common-docs/systems/production-infrastructure/FEATURE.md`. Browser-free operations use the
`aws-production-operations` skill in this repository.

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

This root must not create or move production DNS until the parallel service passes its service
canary, multi-task failover test, rolling-deployment test, and rollback rehearsal. The scraper is
deliberately outside this stack. Supabase migration has its own rehearsal and cutover gate.

The AWS-managed wildcard certificate for `*.app.matrxserver.com` is requested here but cannot be
used until its `public_certificate_validation_records` output has been added to the authoritative
Cloudflare zone. That validation record does not move application traffic. Production service
records stay unchanged until the separate cutover step.

## Parallel static-service preview

The admin dashboard and workflow studio run as two Fargate tasks each across separate availability
zones. The public application load balancer retains access logs for 180 days, removes unhealthy
tasks from service, and allows ECS to replace tasks without dropping below the existing healthy
count. CPU and memory target tracking can grow each service from two to four tasks.

No production hostname points at this load balancer. Retrieve and test the direct preview endpoint:

```bash
terraform output -raw preview_load_balancer_dns_name
curl --fail --show-error "http://$(terraform output -raw preview_load_balancer_dns_name)/"
curl --fail --show-error \
  -H "Host: $(terraform output -raw workflow_studio_preview_host_header)" \
  "http://$(terraform output -raw preview_load_balancer_dns_name)/"
```

The static images are pinned to a full Git SHA. Changing `static_web_image_tag` creates a new task
definition and a circuit-breaker-protected rolling deployment; mutable `latest` tags are forbidden.

## AI Dream preview

AI Dream runs from the exact immutable SHA selected by `aidream_image_tag`, with two 2-vCPU/4-GB
tasks across separate availability zones and autoscaling bounds of two to eight tasks. Its target
group requires `/health/ready`, waits for real database readiness, and drains long requests for two
minutes. No production DNS points at the preview rule.

On 2026-08-19, SHA `76d383772195c378c3290fc7427eaa41ffeac4dc` completed a protected rolling
deployment to task-definition revision 6. Both availability-zone tasks were healthy on image digest
`sha256:906b47758b04015d2c58832bdb84bfb44dd3d30bfbf00851dd0f258e8956f1ea`; 20/20
load-balanced version checks returned that SHA, detailed health reported database/tools/environment
OK, both AI Dream alarms were OK, and a post-deployment Terraform plan reported no drift. Coolify
remained the public production target throughout.

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

## Dormant workflow worker

The workflow worker task definition and ECS service exist with desired count zero. This is
intentional: its database claims and cron watcher are designed for multiple replicas with atomic
`FOR UPDATE SKIP LOCKED` claims and fenced leases, but starting the AWS copy while Coolify is live
would still make AWS an active production consumer. A controlled canary requires its own migration
gate. The dormant task already has the same IAM-based S3/KMS access and protected runtime-secret
injection as AI Dream, so no static AWS key or SSH setup is needed when that gate opens.
