output "vpc_id" {
  description = "Production VPC ID."
  value       = aws_vpc.production.id
}

output "public_subnet_ids" {
  description = "Public subnets reserved for load balancers and NAT gateways."
  value       = values(aws_subnet.public)[*].id
}

output "private_subnet_ids" {
  description = "Private subnets used by Fargate tasks."
  value       = values(aws_subnet.private)[*].id
}

output "ecs_cluster_name" {
  description = "Production ECS cluster name."
  value       = aws_ecs_cluster.production.name
}

output "service_discovery_namespace" {
  description = "Private DNS namespace for service-to-service calls."
  value       = aws_service_discovery_private_dns_namespace.production.name
}

output "operator_role_arn" {
  description = "Role used by agents and human operators for routine platform operations."
  value       = aws_iam_role.operator.arn
}

output "task_execution_role_arn" {
  description = "Shared ECS task execution role."
  value       = aws_iam_role.task_execution.arn
}

output "service_ecr_repository_urls" {
  description = "ECR destinations for newly migrated services."
  value       = { for name, repository in aws_ecr_repository.service : name => repository.repository_url }
}

output "service_secret_arns" {
  description = "Secret containers populated by the credential migration, not by Terraform."
  value       = { for name, secret in aws_secretsmanager_secret.service : name => secret.arn }
}

output "supabase_east_migration_secret_arn" {
  description = "Operator-only temporary credential container for the Supabase region migration."
  value       = aws_secretsmanager_secret.supabase_east_migration.arn
}

output "supabase_migration_artifacts_bucket" {
  description = "KMS-encrypted, versioned bucket for protected Supabase rehearsal and cutover artifacts."
  value       = aws_s3_bucket.supabase_migration_artifacts.id
}

output "preview_load_balancer_dns_name" {
  description = "Direct preview endpoint. Admin is the default; send the documented Host header for workflow studio."
  value       = aws_lb.public.dns_name
}

output "workflow_studio_preview_host_header" {
  description = "Host header used to test workflow studio without creating production DNS."
  value       = local.static_web_services["workflow-studio"].host_header
}

output "aidream_preview_host_header" {
  description = "Host header used to test AI Dream without creating production DNS."
  value       = local.aidream_preview_host
}
