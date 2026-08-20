data "aws_ecr_repository" "aidream" {
  name = "matrx/aidream-server"
}

data "aws_kms_key" "redaction_escrow" {
  key_id = "alias/matrx-redaction-escrow"
}

locals {
  aidream_preview_host = "aidream.preview.platform.matrx.internal"

  # ECS injects the whole protected JSON secret into one temporary environment
  # value. This tiny bootstrap expands it only inside the process environment,
  # removes the wrapper value, and execs the image's canonical entrypoint.
  # Secret values never enter Terraform state or the task definition.
  runtime_secret_bootstrap = "python -c 'import json,os; env=os.environ.copy(); env.update(json.loads(env.pop(\"MATRX_RUNTIME_ENV_JSON\"))); os.execvpe(\"/app/entrypoint.sh\",[\"/app/entrypoint.sh\"],env)'"
}

data "aws_iam_policy_document" "aidream_aws_services" {
  statement {
    sid = "ListPlatformFileBuckets"
    actions = [
      "s3:GetBucketLocation",
      "s3:ListBucket",
      "s3:ListBucketMultipartUploads",
    ]
    resources = [
      "arn:aws:s3:::matrx-user-files",
      "arn:aws:s3:::cdn.matrxserver.com",
    ]
  }

  statement {
    sid = "ManagePlatformFileObjects"
    actions = [
      "s3:AbortMultipartUpload",
      "s3:DeleteObject",
      "s3:GetObject",
      "s3:GetObjectAttributes",
      "s3:ListMultipartUploadParts",
      "s3:PutObject",
    ]
    resources = [
      "arn:aws:s3:::matrx-user-files/*",
      "arn:aws:s3:::cdn.matrxserver.com/*",
    ]
  }

  statement {
    sid = "UseRedactionEscrowKey"
    actions = [
      "kms:Decrypt",
      "kms:DescribeKey",
      "kms:Encrypt",
      "kms:GetPublicKey",
    ]
    resources = [data.aws_kms_key.redaction_escrow.arn]
  }
}

resource "aws_iam_role_policy" "aidream_aws_services" {
  name   = "platform-files-and-redaction"
  role   = aws_iam_role.task["aidream"].id
  policy = data.aws_iam_policy_document.aidream_aws_services.json
}

resource "aws_security_group" "aidream" {
  name        = "${local.name_prefix}-aidream"
  description = "AI Dream accepts API traffic only from the platform load balancer."
  vpc_id      = aws_vpc.production.id

  ingress {
    description     = "API traffic from the load balancer"
    from_port       = 8000
    to_port         = 8000
    protocol        = "tcp"
    security_groups = [aws_security_group.public_alb.id]
  }

  egress {
    description = "Supabase, AI providers, S3, logs, and internal platform dependencies"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-aidream" }
}

resource "aws_lb_target_group" "aidream" {
  name        = "matrx-aidream"
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

resource "aws_lb_listener_rule" "aidream_preview" {
  listener_arn = aws_lb_listener.preview_http.arn
  priority     = 200

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.aidream.arn
  }

  condition {
    host_header { values = [local.aidream_preview_host] }
  }
}

resource "aws_lb_listener_rule" "aidream_https" {
  listener_arn = aws_lb_listener.public_https.arn
  priority     = 200

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.aidream.arn
  }

  condition {
    host_header {
      values = [
        "server-aws.app.matrxserver.com",
        "server.app.matrxserver.com",
        "stream.aimatrx.com",
      ]
    }
  }
}

resource "aws_ecs_task_definition" "aidream" {
  family                   = "matrx-production-aidream"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 2048
  memory                   = 4096
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task["aidream"].arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  ephemeral_storage { size_in_gib = 40 }

  container_definitions = jsonencode([{
    name       = "aidream"
    image      = "${data.aws_ecr_repository.aidream.repository_url}:${var.aidream_image_tag}"
    essential  = true
    entryPoint = ["/bin/sh", "-c"]
    command    = [local.runtime_secret_bootstrap]

    portMappings = [{
      name          = "http"
      containerPort = 8000
      hostPort      = 8000
      protocol      = "tcp"
      appProtocol   = "http"
    }]

    environment = [
      { name = "HOST", value = "0.0.0.0" },
      { name = "PORT", value = "8000" },
      { name = "MATRX_ROLE", value = "app_server" },
      { name = "MATRX_STAGE", value = "production" },
    ]

    secrets = [{
      name      = "MATRX_RUNTIME_ENV_JSON"
      valueFrom = aws_secretsmanager_secret.service["aidream"].arn
    }]

    healthCheck = {
      command     = ["CMD-SHELL", "curl -fsS http://localhost:8000/health/ready >/dev/null || exit 1"]
      interval    = 30
      timeout     = 10
      retries     = 3
      startPeriod = 120
    }

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.application["aidream"].name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "ecs"
      }
    }

    linuxParameters        = { initProcessEnabled = true }
    readonlyRootFilesystem = false
    stopTimeout            = 120
    ulimits = [{
      name      = "nofile"
      softLimit = 65536
      hardLimit = 65536
    }]
  }])
}

resource "aws_ecs_service" "aidream" {
  name                   = "aidream"
  cluster                = aws_ecs_cluster.production.id
  task_definition        = aws_ecs_task_definition.aidream.arn
  desired_count          = 2
  enable_execute_command = true
  launch_type            = "FARGATE"
  platform_version       = "LATEST"
  propagate_tags         = "SERVICE"

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  # Production startup synchronizes the platform catalog before the API is
  # mounted and has been observed taking just over four minutes. Keep the old
  # healthy tasks serving while replacements complete that bounded startup.
  health_check_grace_period_seconds = 600

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = values(aws_subnet.private)[*].id
    security_groups  = [aws_security_group.aidream.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.aidream.arn
    container_name   = "aidream"
    container_port   = 8000
  }

  tags       = { Name = "${local.name_prefix}-aidream" }
  depends_on = [aws_lb_listener_rule.aidream_preview, aws_iam_role_policy.aidream_aws_services]

  lifecycle { ignore_changes = [desired_count] }
}

resource "aws_appautoscaling_target" "aidream" {
  max_capacity       = 8
  min_capacity       = 2
  resource_id        = "service/${aws_ecs_cluster.production.name}/${aws_ecs_service.aidream.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "aidream_cpu" {
  name               = "aidream-cpu-55"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.aidream.resource_id
  scalable_dimension = aws_appautoscaling_target.aidream.scalable_dimension
  service_namespace  = aws_appautoscaling_target.aidream.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = 55
    scale_in_cooldown  = 600
    scale_out_cooldown = 60
    predefined_metric_specification { predefined_metric_type = "ECSServiceAverageCPUUtilization" }
  }
}

resource "aws_appautoscaling_policy" "aidream_memory" {
  name               = "aidream-memory-70"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.aidream.resource_id
  scalable_dimension = aws_appautoscaling_target.aidream.scalable_dimension
  service_namespace  = aws_appautoscaling_target.aidream.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = 70
    scale_in_cooldown  = 600
    scale_out_cooldown = 60
    predefined_metric_specification { predefined_metric_type = "ECSServiceAverageMemoryUtilization" }
  }
}

resource "aws_cloudwatch_metric_alarm" "aidream_healthy_hosts" {
  alarm_name          = "matrx-production-aidream-fewer-than-two-healthy-tasks"
  alarm_description   = "AI Dream no longer has a healthy API task in both availability zones."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HealthyHostCount"
  comparison_operator = "LessThanThreshold"
  threshold           = 2
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  period              = 60
  statistic           = "Minimum"
  treat_missing_data  = "breaching"

  dimensions = {
    LoadBalancer = aws_lb.public.arn_suffix
    TargetGroup  = aws_lb_target_group.aidream.arn_suffix
  }
}

resource "aws_cloudwatch_metric_alarm" "aidream_target_5xx" {
  alarm_name          = "matrx-production-aidream-target-5xx"
  alarm_description   = "AI Dream returned more than ten server errors in five minutes."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 10
  evaluation_periods  = 1
  period              = 300
  statistic           = "Sum"
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = aws_lb.public.arn_suffix
    TargetGroup  = aws_lb_target_group.aidream.arn_suffix
  }
}
