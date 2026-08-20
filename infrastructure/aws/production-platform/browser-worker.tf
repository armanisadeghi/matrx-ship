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

resource "aws_security_group" "browser_profiles" {
  name        = "${local.name_prefix}-browser-profiles"
  description = "Encrypted EFS profile storage is reachable only from the persistent browser worker."
  vpc_id      = aws_vpc.production.id

  ingress {
    description     = "NFS from the persistent browser worker"
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    security_groups = [aws_security_group.browser_worker.id]
  }

  tags = { Name = "${local.name_prefix}-browser-profiles" }
}

resource "aws_efs_file_system" "browser_profiles" {
  encrypted        = true
  performance_mode = "generalPurpose"
  throughput_mode  = "bursting"

  tags = { Name = "${local.name_prefix}-browser-profiles" }
}

resource "aws_efs_mount_target" "browser_profiles" {
  for_each = aws_subnet.private

  file_system_id  = aws_efs_file_system.browser_profiles.id
  subnet_id       = each.value.id
  security_groups = [aws_security_group.browser_profiles.id]
}

resource "aws_efs_access_point" "browser_profiles" {
  file_system_id = aws_efs_file_system.browser_profiles.id

  posix_user {
    gid = 1000
    uid = 1000
  }

  root_directory {
    path = "/browser-profiles"

    creation_info {
      owner_gid   = 1000
      owner_uid   = 1000
      permissions = "0750"
    }
  }

  tags = { Name = "${local.name_prefix}-browser-profiles" }
}

data "aws_iam_policy_document" "browser_worker_profiles" {
  statement {
    actions = [
      "elasticfilesystem:ClientMount",
      "elasticfilesystem:ClientWrite",
    ]
    resources = [aws_efs_file_system.browser_profiles.arn]

    condition {
      test     = "StringEquals"
      variable = "elasticfilesystem:AccessPointArn"
      values   = [aws_efs_access_point.browser_profiles.arn]
    }
  }
}

resource "aws_iam_role" "browser_worker_task" {
  name               = "matrx-production-browser-worker-task"
  path               = "/matrx/platform/"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "browser_worker_exec" {
  role       = aws_iam_role.browser_worker_task.name
  policy_arn = aws_iam_policy.ecs_exec_task.arn
}

resource "aws_iam_role_policy" "browser_worker_profiles" {
  name   = "write-encrypted-browser-profiles"
  role   = aws_iam_role.browser_worker_task.id
  policy = data.aws_iam_policy_document.browser_worker_profiles.json
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

}

resource "aws_ecs_task_definition" "browser_worker" {
  family                   = "matrx-production-browser-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 2048
  memory                   = 4096
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.browser_worker_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  ephemeral_storage { size_in_gib = 40 }

  volume {
    name = "browser-profiles"

    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.browser_profiles.id
      transit_encryption = "ENABLED"

      authorization_config {
        access_point_id = aws_efs_access_point.browser_profiles.id
        iam             = "ENABLED"
      }
    }
  }

  dynamic "volume" {
    for_each = toset(["worker-tmp", "worker-home", "ssm-lib", "ssm-log"])
    content { name = volume.value }
  }

  container_definitions = jsonencode([{
    name      = "browser-worker"
    image     = "${data.aws_ecr_repository.browser_worker.repository_url}:${var.browser_worker_image_tag}"
    essential = true
    # The image entrypoint initializes the empty Fargate mounts as root and
    # immediately drops every long-running process to the browser-worker user.
    readonlyRootFilesystem = true

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

    mountPoints = [
      {
        sourceVolume  = "browser-profiles"
        containerPath = "/profiles"
        readOnly      = false
      },
      {
        sourceVolume  = "worker-tmp"
        containerPath = "/tmp"
        readOnly      = false
      },
      {
        sourceVolume  = "worker-home"
        containerPath = "/home/browser-worker"
        readOnly      = false
      },
      {
        sourceVolume  = "ssm-lib"
        containerPath = "/var/lib/amazon/ssm"
        readOnly      = false
      },
      {
        sourceVolume  = "ssm-log"
        containerPath = "/var/log/amazon/ssm"
        readOnly      = false
      },
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

  depends_on = [aws_efs_mount_target.browser_profiles]

  tags = { Name = "${local.name_prefix}-browser-worker" }
}
