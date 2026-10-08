# THE PLATFORM SHARED CACHE (2026-10-07, approved by Arman).
#
# Two-tier caching contract: common-docs/systems/architecture/warm-cache/CONTRACT.md.
# Every aidream process keeps a small in-process copy (L1); this Valkey cache is the
# shared copy (L2) every server reads, so a person's warmed data is warm on whichever
# server their next request lands on (the ALB does not pin people to a task, by design).
# Invalidations are published on the cache's own pub/sub channel so every process drops
# its L1 copy.
#
# Serverless: no nodes to size or patch, scales with use, multi-AZ, TLS-only. Reachable
# only from inside the VPC by the services listed in the ingress rules below.
#
# The app user's password lives in Secrets Manager (/matrx/production/platform-cache,
# created outside Terraform so it never appears in a plan's diff). Services receive the
# full URL as MATRX_CACHE_URL in their runtime secret JSON.

data "aws_secretsmanager_secret_version" "platform_cache" {
  secret_id = "/matrx/production/platform-cache"
}

locals {
  platform_cache_credentials = jsondecode(data.aws_secretsmanager_secret_version.platform_cache.secret_string)
}

resource "aws_security_group" "platform_cache" {
  name        = "${local.name_prefix}-platform-cache"
  description = "Platform shared cache accepts Valkey traffic only from platform services."
  vpc_id      = aws_vpc.production.id

  tags = { Name = "${local.name_prefix}-platform-cache" }
}

resource "aws_vpc_security_group_ingress_rule" "platform_cache_from_aidream" {
  security_group_id            = aws_security_group.platform_cache.id
  referenced_security_group_id = aws_security_group.aidream.id
  description                  = "AI Dream servers"
  from_port                    = 6379
  to_port                      = 6380
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "platform_cache_from_workflow_worker" {
  security_group_id            = aws_security_group.platform_cache.id
  referenced_security_group_id = aws_security_group.workflow_worker.id
  description                  = "Workflow worker"
  from_port                    = 6379
  to_port                      = 6380
  ip_protocol                  = "tcp"
}

# Valkey user groups need no "default" user: the only user is the app user.
resource "aws_elasticache_user" "platform_cache_app" {
  user_id       = "${local.name_prefix}-cache-app"
  user_name     = local.platform_cache_credentials.username
  engine        = "valkey"
  access_string = "on ~mx:* &mx:* +@all -@dangerous"

  authentication_mode {
    type      = "password"
    passwords = [local.platform_cache_credentials.password]
  }
}

resource "aws_elasticache_user_group" "platform_cache" {
  user_group_id = "${local.name_prefix}-cache-users"
  engine        = "valkey"
  user_ids      = [aws_elasticache_user.platform_cache_app.user_id]
}

resource "aws_elasticache_serverless_cache" "platform" {
  name                 = "${local.name_prefix}-platform-cache"
  description          = "Shared L2 cache for warmed per-person and platform data (warm-cache contract)."
  engine               = "valkey"
  major_engine_version = "8"
  subnet_ids           = values(aws_subnet.private)[*].id
  security_group_ids   = [aws_security_group.platform_cache.id]
  user_group_id        = aws_elasticache_user_group.platform_cache.user_group_id

  # Guard rails, not a size: serverless bills for what is used. A cache that needs more than
  # this is a design question, not a bigger box.
  cache_usage_limits {
    data_storage {
      maximum = 5
      unit    = "GB"
    }
    ecpu_per_second {
      maximum = 20000
    }
  }

  daily_snapshot_time      = "09:00"
  snapshot_retention_limit = 1
}

output "platform_cache_endpoint" {
  description = "host:port of the platform shared cache (TLS)."
  value       = "${aws_elasticache_serverless_cache.platform.endpoint[0].address}:${aws_elasticache_serverless_cache.platform.endpoint[0].port}"
}
