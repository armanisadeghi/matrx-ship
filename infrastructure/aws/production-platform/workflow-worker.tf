resource "aws_iam_role_policy" "workflow_worker_aws_services" {
  name   = "platform-files-and-redaction"
  role   = aws_iam_role.task["workflow-worker"].id
  policy = data.aws_iam_policy_document.aidream_aws_services.json
}

resource "aws_security_group" "workflow_worker" {
  name        = "${local.name_prefix}-workflow-worker"
  description = "Workflow worker has no ingress and reaches only external/internal dependencies."
  vpc_id      = aws_vpc.production.id

  egress {
    description = "Supabase, AI providers, S3, logs, and internal platform dependencies"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-workflow-worker" }
}

resource "aws_ecs_task_definition" "workflow_worker" {
  family                   = "matrx-production-workflow-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 2048
  memory                   = 4096
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task["workflow-worker"].arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  ephemeral_storage { size_in_gib = 40 }

  container_definitions = jsonencode([{
    name       = "workflow-worker"
    image      = "${data.aws_ecr_repository.aidream.repository_url}:${var.workflow_worker_image_tag}"
    essential  = true
    entryPoint = ["/bin/sh", "-c"]
    command    = [local.runtime_secret_bootstrap]

    environment = [
      { name = "MATRX_ROLE", value = "worker" },
      { name = "MATRX_STAGE", value = "production" },
      { name = "MATRX_BROWSER_PROFILE_KMS_KEY_ID", value = aws_kms_key.browser_profiles.arn },
    ]

    secrets = [{
      name      = "MATRX_RUNTIME_ENV_JSON"
      valueFrom = aws_secretsmanager_secret.service["workflow-worker"].arn
    }]

    healthCheck = {
      command     = ["CMD-SHELL", "test \"$MATRX_ROLE\" = worker"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.application["workflow-worker"].name
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

resource "aws_ecs_service" "workflow_worker" {
  name                   = "workflow-worker"
  cluster                = aws_ecs_cluster.production.id
  task_definition        = aws_ecs_task_definition.workflow_worker.arn
  desired_count          = 0
  enable_execute_command = true
  launch_type            = "FARGATE"
  platform_version       = "LATEST"
  propagate_tags         = "SERVICE"

  # The worker may stop briefly during replacement. This prevents an
  # overlapping task from consuming an extra database connection slot.
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = values(aws_subnet.private)[*].id
    security_groups  = [aws_security_group.workflow_worker.id]
    assign_public_ip = false
  }

  tags = { Name = "${local.name_prefix}-workflow-worker" }

  depends_on = [aws_iam_role_policy.workflow_worker_aws_services]

  # The operator owns desired_count; the aidream GitHub workflow advances the
  # immutable image revision in task_definition.
  lifecycle { ignore_changes = [desired_count, task_definition] }
}
