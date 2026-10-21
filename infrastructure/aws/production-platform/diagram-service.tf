# Diagram service (legible-diagrams L3): the always-on, private Node service around @ai-matrx/diagrams.
#
# POST /validate, POST /render, GET /measure-script, GET /health. No Chromium, no database. Called ONLY by AI Dream
# (aidream/aidream/services/diagram_client) over Cloud Map: http://diagram-service.platform.matrx.internal:8003.
# Plan: common-docs/projects/legible-diagrams/PLAN.md (L3). Always-on size approved by Arman 2026-10-21.
#
# One task at the smallest Fargate size (0.25 vCPU / 512 MiB; measured resident set ~300 MB after 90 renders).
# Release ownership (production-infra FEATURE.md): the task definition ignores container_definitions and the service
# ignores task_definition / platform_version; aidream's deploy.yml `build-diagram-service` pushes the image and
# registers each revision. desired_count is Terraform's (1): this service is always on.
#
# Service token: the HMAC secret is the key DIAGRAM_SERVICE_TOKEN inside the existing aidream runtime secret
# (/matrx/production/aidream). AI Dream reads the same key from its own runtime environment, together with
# DIAGRAM_SERVICE_URL, so one value serves both ends and nothing new is stored.

locals {
  diagram_service_family = "${local.name_prefix}-diagram-service"
  diagram_service_port   = 8003
}

variable "diagram_service_image_tag" {
  description = "Tag of the diagram service image in matrx-diagram-service (a full Git SHA once the release builds it; `latest` for the first push)."
  type        = string
  default     = "latest"
}

resource "aws_ecr_repository" "diagram_service" {
  name                 = "matrx-diagram-service"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration { scan_on_push = true }

  encryption_configuration { encryption_type = "AES256" }

  tags = { Name = local.diagram_service_family }
}

resource "aws_ecr_lifecycle_policy" "diagram_service" {
  repository = aws_ecr_repository.diagram_service.name
  policy     = local.ecr_lifecycle_rules[20]
}

resource "aws_cloudwatch_log_group" "diagram_service" {
  name              = "/matrx/production/diagram-service"
  retention_in_days = 90
}

resource "aws_security_group" "diagram_service" {
  name        = local.diagram_service_family
  description = "The diagram service accepts signed calls only from AI Dream and the workflow worker."
  vpc_id      = aws_vpc.production.id

  ingress {
    description     = "Signed diagram calls from AI Dream"
    from_port       = local.diagram_service_port
    to_port         = local.diagram_service_port
    protocol        = "tcp"
    security_groups = [aws_security_group.aidream.id]
  }

  ingress {
    description     = "Signed diagram calls from the workflow worker"
    from_port       = local.diagram_service_port
    to_port         = local.diagram_service_port
    protocol        = "tcp"
    security_groups = [aws_security_group.workflow_worker.id]
  }

  # Image pull, log delivery and secret fetch; the service itself calls nothing.
  egress {
    description = "ECR, CloudWatch Logs and Secrets Manager"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = local.diagram_service_family }
}

# No AWS permissions: the service reads nothing and writes nothing outside its own response.
resource "aws_iam_role" "diagram_service_task" {
  name               = "matrx-production-diagram-service-task"
  path               = "/matrx/platform/"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_service_discovery_service" "diagram_service" {
  name = "diagram-service"

  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.production.id
    routing_policy = "MULTIVALUE"

    dns_records {
      ttl  = 10
      type = "A"
    }
  }
}

resource "aws_ecs_task_definition" "diagram_service" {
  family                   = local.diagram_service_family
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.diagram_service_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name      = "diagram-service"
    image     = "${aws_ecr_repository.diagram_service.repository_url}:${var.diagram_service_image_tag}"
    essential = true

    portMappings = [{
      name          = "http"
      containerPort = local.diagram_service_port
      hostPort      = local.diagram_service_port
      protocol      = "tcp"
      appProtocol   = "http"
    }]

    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "DIAGRAM_SERVICE_PORT", value = tostring(local.diagram_service_port) },
      # Keep V8 inside the 512 MiB task so a leak is a clean restart, not an OOM kill of a half-written response.
      { name = "NODE_OPTIONS", value = "--max-old-space-size=320" },
    ]

    secrets = [{
      name      = "DIAGRAM_SERVICE_TOKEN"
      valueFrom = "${aws_secretsmanager_secret.service["aidream"].arn}:DIAGRAM_SERVICE_TOKEN::"
    }]

    healthCheck = {
      command     = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:${local.diagram_service_port}/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 15
    }

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.diagram_service.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "diagram"
      }
    }

    linuxParameters = { initProcessEnabled = true }
    stopTimeout     = 30
    ulimits = [{
      name      = "nofile"
      softLimit = 65536
      hardLimit = 65536
    }]
  }])

  tags = { Name = local.diagram_service_family }

  lifecycle { ignore_changes = [container_definitions] }
}

resource "aws_ecs_service" "diagram_service" {
  name             = "diagram-service"
  cluster          = aws_ecs_cluster.production.id
  task_definition  = aws_ecs_task_definition.diagram_service.arn
  desired_count    = 1
  launch_type      = "FARGATE"
  platform_version = "LATEST"
  propagate_tags   = "SERVICE"

  # One task: replace it without a gap in the other direction (start the new task, then stop the old one).
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = values(aws_subnet.private)[*].id
    security_groups  = [aws_security_group.diagram_service.id]
    assign_public_ip = false
  }

  service_registries {
    registry_arn = aws_service_discovery_service.diagram_service.arn
  }

  tags = { Name = local.diagram_service_family }

  lifecycle { ignore_changes = [task_definition, platform_version] }
}

# Always on: fewer than one running task means every diagram check answers "layout not checked".
resource "aws_cloudwatch_metric_alarm" "diagram_service_running" {
  alarm_name          = "matrx-production-diagram-service-not-running"
  alarm_description   = "The diagram service has no running task; generated diagrams are shown as 'layout not checked' until it returns."
  namespace           = "ECS/ContainerInsights"
  metric_name         = "RunningTaskCount"
  comparison_operator = "LessThanThreshold"
  threshold           = 1
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  period              = 60
  statistic           = "Minimum"
  treat_missing_data  = "breaching"

  dimensions = {
    ClusterName = aws_ecs_cluster.production.name
    ServiceName = aws_ecs_service.diagram_service.name
  }
}

resource "aws_cloudwatch_metric_alarm" "diagram_service_memory" {
  alarm_name          = "matrx-production-diagram-service-memory-high"
  alarm_description   = "The diagram service averaged more than 85 percent memory for 15 minutes; the 0.25 vCPU / 512 MiB task size needs review."
  namespace           = "AWS/ECS"
  metric_name         = "MemoryUtilization"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 85
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  period              = 300
  statistic           = "Average"

  # No data means no running task, which the running-count alarm already states.
  treat_missing_data = "notBreaching"

  dimensions = {
    ClusterName = aws_ecs_cluster.production.name
    ServiceName = aws_ecs_service.diagram_service.name
  }
}
