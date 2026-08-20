data "aws_ecr_repository" "browser_worker" {
  name = "matrx-browser-worker"
}

resource "aws_security_group" "browser_worker" {
  name        = "${local.name_prefix}-browser-worker"
  description = "Persistent Cloud Browser worker accepts private control and stream traffic only from AI Dream."
  vpc_id      = aws_vpc.production.id

  ingress {
    description     = "Signed worker control from AI Dream"
    from_port       = 8002
    to_port         = 8002
    protocol        = "tcp"
    security_groups = [aws_security_group.aidream.id]
  }

  ingress {
    description     = "Authenticated Selkies stream proxy from AI Dream"
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.aidream.id]
  }

  egress {
    description = "Browser navigation and AWS service access"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-browser-worker" }
}

resource "aws_service_discovery_service" "browser_worker" {
  name = "matrx-browser-worker"

  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.production.id
    routing_policy = "MULTIVALUE"

    dns_records {
      ttl  = 10
      type = "A"
    }
  }

  health_check_custom_config {}
}

resource "aws_ecs_task_definition" "browser_worker" {
  family                   = "matrx-production-browser-worker"
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
    name      = "browser-worker"
    image     = "${data.aws_ecr_repository.browser_worker.repository_url}:${var.browser_worker_image_tag}"
    essential = true

    portMappings = [
      {
        name          = "control"
        containerPort = 8002
        hostPort      = 8002
        protocol      = "tcp"
        appProtocol   = "http"
      },
      {
        name          = "stream"
        containerPort = 8080
        hostPort      = 8080
        protocol      = "tcp"
      },
    ]

    environment = [
      { name = "BROWSER_WORKER_ID", value = "00000000-0000-0000-0000-000000000102" },
      { name = "BROWSER_WORKER_TOKEN_ISSUER", value = "matrx-broker" },
      { name = "BROWSER_WORKER_PORT", value = "8002" },
      { name = "DISPLAY", value = ":99" },
    ]

    secrets = [{
      name      = "BROWSER_WORKER_PUBLIC_KEY_PEM"
      valueFrom = "${aws_secretsmanager_secret.service["aidream"].arn}:BROWSER_WORKER_PUBLIC_KEY_PEM::"
    }]

    healthCheck = {
      command     = ["CMD-SHELL", "curl -fsS http://localhost:8002/health >/dev/null || exit 1"]
      interval    = 30
      timeout     = 10
      retries     = 3
      startPeriod = 60
    }

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.application["aidream"].name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "browser-worker"
      }
    }

    linuxParameters = { initProcessEnabled = true }
    stopTimeout     = 120
    ulimits = [{
      name      = "nofile"
      softLimit = 65536
      hardLimit = 65536
    }]
  }])
}

resource "aws_ecs_service" "browser_worker" {
  name                   = "browser-worker"
  cluster                = aws_ecs_cluster.production.id
  task_definition        = aws_ecs_task_definition.browser_worker.arn
  desired_count          = 1
  enable_execute_command = true
  launch_type            = "FARGATE"
  platform_version       = "LATEST"
  propagate_tags         = "SERVICE"

  # The current control plane has one fixed worker identity. Never overlap two
  # tasks carrying that identity during a replacement; dynamic fleet placement
  # is a separate, explicit scaling milestone.
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = values(aws_subnet.private)[*].id
    security_groups  = [aws_security_group.browser_worker.id]
    assign_public_ip = false
  }

  service_registries {
    registry_arn = aws_service_discovery_service.browser_worker.arn
  }

  tags = { Name = "${local.name_prefix}-browser-worker" }
}
