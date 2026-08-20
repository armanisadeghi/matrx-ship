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

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 10
    path                = "/health/ready"
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

resource "aws_route53_zone_association" "production_namespace_legacy_vpc" {
  zone_id = aws_service_discovery_private_dns_namespace.production.hosted_zone
  vpc_id  = data.aws_vpc.legacy.id
}

resource "aws_route53_record" "aidream_internal" {
  zone_id = aws_service_discovery_private_dns_namespace.production.hosted_zone
  name    = "aidream.${aws_service_discovery_private_dns_namespace.production.name}"
  type    = "A"

  alias {
    name                   = aws_lb.aidream_internal.dns_name
    zone_id                = aws_lb.aidream_internal.zone_id
    evaluate_target_health = true
  }
}
