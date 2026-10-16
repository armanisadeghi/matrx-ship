resource "aws_security_group" "aidream_internal_alb" {
  name        = "${local.name_prefix}-aidream-internal-alb"
  description = "Private AI Dream entry point for the peered sandbox VPC."
  vpc_id      = aws_vpc.production.id

  ingress {
    description = "HTTP from the peered sandbox VPC"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = [data.aws_vpc.legacy.cidr_block]
  }

  ingress {
    description = "HTTP from the production VPC"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = [aws_vpc.production.cidr_block]
  }

  egress {
    description = "AI Dream tasks in the production VPC"
    from_port   = 8000
    to_port     = 8000
    protocol    = "tcp"
    cidr_blocks = [aws_vpc.production.cidr_block]
  }

  tags = { Name = "${local.name_prefix}-aidream-internal-alb" }
}

resource "aws_lb" "aidream_internal" {
  name                       = "matrx-aidream-internal"
  internal                   = true
  load_balancer_type         = "application"
  security_groups            = [aws_security_group.aidream_internal_alb.id]
  subnets                    = values(aws_subnet.private)[*].id
  enable_deletion_protection = true
  drop_invalid_header_fields = true
  idle_timeout               = 300

  access_logs {
    bucket  = aws_s3_bucket.access_logs.id
    prefix  = "alb-internal-aidream"
    enabled = true
  }

  depends_on = [aws_s3_bucket_policy.access_logs]
}

resource "aws_lb_target_group" "aidream_internal" {
  name        = "matrx-aidream-internal"
  port        = 8000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.production.id

  deregistration_delay = 120

  # A COPY THAT DIES LEAVES ROTATION IN SECONDS (2026-10-15). An api copy that
  # crashed (exit 139) kept receiving ~half of all traffic for ~60s — 268 and 192
  # failed connections at 02:36Z and 03:40Z — because the only exit was the
  # health check (30s x 3). Anomaly mitigation shifts traffic off a target whose
  # error rate jumps, within seconds and without waiting for a health check; it
  # requires weighted_random (no stickiness or slow start is used here).
  load_balancing_algorithm_type     = "weighted_random"
  load_balancing_anomaly_mitigation = "on"

  # /health/serving, never /health/ready: /ready re-pings the shared database,
  # so a database outage fails it on every target at once and ECS replaces the
  # whole fleet (2026-09-25 07:34 PT — server 502 until 07:45:50, seven minutes
  # after the database was back). /serving = "booted and not draining".
  # APPLY ORDER: apply this only once the live aidream image serves
  # /health/serving (curl https://server.app.matrxserver.com/health/serving → 200);
  # an older image answers it 404 and the target group would fail every task.
  # Guard: aidream/services/runtime/tests/test_deploy_drain.py
  health_check {
    # 10s x 2 = a dead copy is out in ~20s, not up to 90s. The 5s timeout still
    # clears the worst event-loop stall seen (3.2s, GC); if every target fails at
    # once the load balancer fails OPEN and keeps routing to all of them.
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 2
    interval            = 10
    timeout             = 5
    path                = "/health/serving"
    protocol            = "HTTP"
    matcher             = "200-399"
  }
}

resource "aws_lb_listener" "aidream_internal" {
  load_balancer_arn = aws_lb.aidream_internal.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.aidream_internal.arn
  }
}

resource "aws_route53_zone" "internal_services" {
  name = "internal.matrxserver.com"

  vpc {
    vpc_id = aws_vpc.production.id
  }

  tags = { Name = "${local.name_prefix}-internal-services" }

  # The legacy VPC is managed by the standalone association below. Preserve
  # both live associations when Terraform refreshes the zone resource itself.
  lifecycle { ignore_changes = [vpc] }
}

resource "aws_route53_zone_association" "internal_services_legacy_vpc" {
  zone_id = aws_route53_zone.internal_services.zone_id
  vpc_id  = data.aws_vpc.legacy.id
}

resource "aws_route53_record" "aidream_internal" {
  zone_id = aws_route53_zone.internal_services.zone_id
  name    = "aidream.${aws_route53_zone.internal_services.name}"
  type    = "A"

  alias {
    name                   = aws_lb.aidream_internal.dns_name
    zone_id                = aws_lb.aidream_internal.zone_id
    evaluate_target_health = true
  }
}
