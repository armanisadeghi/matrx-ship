# Cloud Computer (P1a): one persistent Linux desktop per user.
#
# Plan: common-docs/projects/cloud-computer/PLAN.md. A Cloud Computer is the
# browser worker plus a desktop (window manager, terminal, file manager), a
# writable root filesystem so agents can install software, a 100 GiB local
# disk, and a home directory on EFS behind ONE access point per user.
#
# Everything here is additive and separate from the browser fleet: its own ECR
# repository, task family, security groups, EFS file system, task role and
# control-plane policy. Nothing in browser-worker.tf / browser-fleet.tf is
# read or changed, so a machine can never consume browser capacity and a
# browser task can never mount a person's home.
#
# Per-user access points are created at runtime by the control plane
# (aidream/services/cloud_browser/cloud_computer.py). ECS cannot override an
# EFS volume at RunTask, so the control plane clones the base task definition
# below into one family per user (`matrx-production-cloud-computer-u-<id>`)
# whose only difference is that user's access point. Terraform owns the base
# family, the file system, its mount targets and the IAM that allows exactly
# that.

locals {
  cloud_computer_family     = "${local.name_prefix}-cloud-computer"
  cloud_computer_managed_by = "matrx-cloud-computer"
}

resource "aws_ecr_repository" "cloud_computer" {
  name                 = "matrx-cloud-computer"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration { scan_on_push = true }

  encryption_configuration { encryption_type = "AES256" }

  tags = { Name = "${local.name_prefix}-cloud-computer" }
}

resource "aws_ecr_lifecycle_policy" "cloud_computer" {
  repository = aws_ecr_repository.cloud_computer.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the 30 newest cloud-computer images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 30
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_security_group" "cloud_computer" {
  name        = "${local.name_prefix}-cloud-computer"
  description = "Cloud Computer machines accept private control and stream traffic only from AI Dream."
  vpc_id      = aws_vpc.production.id

  ingress {
    description     = "Signed worker control from AI Dream"
    from_port       = 8002
    to_port         = 8002
    protocol        = "tcp"
    security_groups = [aws_security_group.aidream.id]
  }

  ingress {
    description     = "Scheduled lifecycle maintenance from the workflow worker"
    from_port       = 8002
    to_port         = 8002
    protocol        = "tcp"
    security_groups = [aws_security_group.workflow_worker.id]
  }

  ingress {
    description     = "Authenticated Selkies stream proxy from AI Dream"
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.aidream.id]
  }

  egress {
    description = "Browsing, package installs and AWS service access"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-cloud-computer" }
}

resource "aws_security_group" "cloud_computer_homes" {
  name        = "${local.name_prefix}-cloud-computer-homes"
  description = "Encrypted EFS home directories are reachable only from Cloud Computer machines."
  vpc_id      = aws_vpc.production.id

  ingress {
    description     = "NFS from Cloud Computer machines"
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    security_groups = [aws_security_group.cloud_computer.id]
  }

  tags = { Name = "${local.name_prefix}-cloud-computer-homes" }
}

resource "aws_efs_file_system" "cloud_computer_homes" {
  # The control plane finds this file system by its creation token.
  creation_token   = "${local.name_prefix}-cloud-computer-homes"
  encrypted        = true
  performance_mode = "generalPurpose"
  # Elastic: a home directory is small and bursty; bursting mode would give a
  # small file system almost no baseline throughput.
  throughput_mode = "elastic"

  lifecycle_policy { transition_to_ia = "AFTER_30_DAYS" }
  lifecycle_policy { transition_to_primary_storage_class = "AFTER_1_ACCESS" }

  tags = { Name = "${local.name_prefix}-cloud-computer-homes" }
}

resource "aws_efs_backup_policy" "cloud_computer_homes" {
  file_system_id = aws_efs_file_system.cloud_computer_homes.id
  backup_policy { status = "ENABLED" }
}

resource "aws_efs_mount_target" "cloud_computer_homes" {
  for_each = aws_subnet.private

  file_system_id  = aws_efs_file_system.cloud_computer_homes.id
  subnet_id       = each.value.id
  security_groups = [aws_security_group.cloud_computer_homes.id]
}

# A machine may mount the homes file system only through an access point the
# control plane created (tagged managed-by), never the file system root.
data "aws_iam_policy_document" "cloud_computer_homes" {
  statement {
    actions = [
      "elasticfilesystem:ClientMount",
      "elasticfilesystem:ClientWrite",
    ]
    resources = [aws_efs_file_system.cloud_computer_homes.arn]

    condition {
      test     = "Bool"
      variable = "elasticfilesystem:AccessedViaMountTarget"
      values   = ["true"]
    }
    condition {
      test     = "Null"
      variable = "elasticfilesystem:AccessPointArn"
      values   = ["false"]
    }
  }
}

resource "aws_iam_role" "cloud_computer_task" {
  name               = "matrx-production-cloud-computer-task"
  path               = "/matrx/platform/"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "cloud_computer_exec" {
  role       = aws_iam_role.cloud_computer_task.name
  policy_arn = aws_iam_policy.ecs_exec_task.arn
}

resource "aws_iam_role_policy" "cloud_computer_homes" {
  name   = "mount-own-home-access-point"
  role   = aws_iam_role.cloud_computer_task.id
  policy = data.aws_iam_policy_document.cloud_computer_homes.json
}

# The BASE definition. It has no home volume: the control plane copies it into
# a per-user family and adds that user's access point (see header). CPU and
# memory here are the 4 vCPU / 16 GB size; RunTask overrides them per launch
# (ruling 15: 4 vCPU / 16 GB and 8 vCPU / 16 GB).
resource "aws_ecs_task_definition" "cloud_computer" {
  family                   = local.cloud_computer_family
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 4096
  memory                   = 16384
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.cloud_computer_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  ephemeral_storage { size_in_gib = 100 }

  container_definitions = jsonencode([{
    name      = "cloud-computer"
    image     = "${aws_ecr_repository.cloud_computer.repository_url}:${var.cloud_computer_image_tag}"
    essential = true
    # Agents install software, so the root filesystem is writable.
    readonlyRootFilesystem = false

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
      { name = "BROWSER_WORKER_ID", value = "00000000-0000-0000-0000-000000000000" },
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
        awslogs-stream-prefix = "cloud-computer"
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

  tags = { Name = local.cloud_computer_family }
}

# Desired 0, never scaled: the control plane reads the PRIMARY deployment's
# private network configuration from it (the same pattern as browser-worker),
# so subnets and the security group live in exactly one place.
resource "aws_ecs_service" "cloud_computer" {
  name                   = "cloud-computer"
  cluster                = aws_ecs_cluster.production.id
  task_definition        = aws_ecs_task_definition.cloud_computer.arn
  desired_count          = 0
  enable_execute_command = true
  launch_type            = "FARGATE"
  platform_version       = "LATEST"

  network_configuration {
    subnets          = values(aws_subnet.private)[*].id
    security_groups  = [aws_security_group.cloud_computer.id]
    assign_public_ip = false
  }

  depends_on = [aws_efs_mount_target.cloud_computer_homes]

  tags = { Name = "${local.name_prefix}-cloud-computer" }

  lifecycle { ignore_changes = [task_definition, platform_version] }
}

# Control-plane rights: create and delete per-user access points, register a
# per-user task family, launch/stop machines it tagged. Scoped to the
# managed-by tag so it can never touch a browser task or another resource.
data "aws_iam_policy_document" "cloud_computer_fleet" {
  statement {
    sid       = "ReadCloudComputerService"
    actions   = ["ecs:DescribeServices"]
    resources = [aws_ecs_service.cloud_computer.id]
  }

  statement {
    sid       = "ReadTaskDefinitions"
    actions   = ["ecs:DescribeTaskDefinition"]
    resources = ["*"]
  }

  statement {
    sid       = "RegisterPerUserFamilies"
    actions   = ["ecs:RegisterTaskDefinition"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "aws:RequestTag/managed-by"
      values   = [local.cloud_computer_managed_by]
    }
  }

  statement {
    sid       = "FindMachines"
    actions   = ["ecs:ListTasks"]
    resources = ["*"]
    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [aws_ecs_cluster.production.arn]
    }
  }

  statement {
    sid       = "InspectMachines"
    actions   = ["ecs:DescribeTasks", "ecs:ListTagsForResource"]
    resources = ["arn:aws:ecs:${var.aws_region}:${var.aws_account_id}:task/${aws_ecs_cluster.production.name}/*"]
  }

  statement {
    sid       = "LaunchMachines"
    actions   = ["ecs:RunTask"]
    resources = ["arn:aws:ecs:${var.aws_region}:${var.aws_account_id}:task-definition/${local.cloud_computer_family}*:*"]
    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [aws_ecs_cluster.production.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:RequestTag/managed-by"
      values   = [local.cloud_computer_managed_by]
    }
  }

  statement {
    sid     = "TagAtCreation"
    actions = ["ecs:TagResource"]
    resources = [
      "arn:aws:ecs:${var.aws_region}:${var.aws_account_id}:task/${aws_ecs_cluster.production.name}/*",
      "arn:aws:ecs:${var.aws_region}:${var.aws_account_id}:task-definition/${local.cloud_computer_family}*:*",
    ]
    condition {
      test     = "StringEquals"
      variable = "ecs:CreateAction"
      values   = ["RunTask", "RegisterTaskDefinition"]
    }
  }

  statement {
    sid       = "StopOnlyOwnedMachines"
    actions   = ["ecs:StopTask"]
    resources = ["arn:aws:ecs:${var.aws_region}:${var.aws_account_id}:task/${aws_ecs_cluster.production.name}/*"]
    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/managed-by"
      values   = [local.cloud_computer_managed_by]
    }
  }

  statement {
    sid     = "PassOnlyCloudComputerRoles"
    actions = ["iam:PassRole"]
    resources = [
      aws_iam_role.task_execution.arn,
      aws_iam_role.cloud_computer_task.arn,
    ]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }

  statement {
    sid       = "FindHomesFileSystem"
    actions   = ["elasticfilesystem:DescribeFileSystems"]
    resources = ["*"]
  }

  statement {
    sid       = "ReadHomeAccessPoints"
    actions   = ["elasticfilesystem:DescribeAccessPoints"]
    resources = [aws_efs_file_system.cloud_computer_homes.arn]
  }

  statement {
    sid       = "CreateHomeAccessPoints"
    actions   = ["elasticfilesystem:CreateAccessPoint", "elasticfilesystem:TagResource"]
    resources = [aws_efs_file_system.cloud_computer_homes.arn]
    condition {
      test     = "StringEquals"
      variable = "aws:RequestTag/managed-by"
      values   = [local.cloud_computer_managed_by]
    }
  }

  statement {
    sid       = "TagNewHomeAccessPoints"
    actions   = ["elasticfilesystem:TagResource"]
    resources = ["arn:aws:elasticfilesystem:${var.aws_region}:${var.aws_account_id}:access-point/*"]
    condition {
      test     = "StringEquals"
      variable = "elasticfilesystem:CreateAction"
      values   = ["CreateAccessPoint"]
    }
  }

  statement {
    sid       = "DeleteOwnedHomeAccessPoints"
    actions   = ["elasticfilesystem:DeleteAccessPoint"]
    resources = ["arn:aws:elasticfilesystem:${var.aws_region}:${var.aws_account_id}:access-point/*"]
    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/managed-by"
      values   = [local.cloud_computer_managed_by]
    }
  }
}

resource "aws_iam_role_policy" "cloud_computer_fleet" {
  for_each = toset(["aidream", "workflow-worker"])
  name     = "cloud-computer-lifecycle"
  role     = aws_iam_role.task[each.key].id
  policy   = data.aws_iam_policy_document.cloud_computer_fleet.json
}

output "cloud_computer" {
  value = {
    ecr_repository = aws_ecr_repository.cloud_computer.repository_url
    task_family    = aws_ecs_task_definition.cloud_computer.family
    homes_fs_id    = aws_efs_file_system.cloud_computer_homes.id
    security_group = aws_security_group.cloud_computer.id
    service        = aws_ecs_service.cloud_computer.name
    task_role      = aws_iam_role.cloud_computer_task.arn
  }
}

variable "cloud_computer_image_tag" {
  description = "AI Dream Git SHA of the Cloud Computer image (browser worker + desktop) in matrx-cloud-computer."
  type        = string
  default     = "54ae1711e5516d212b60f4fa7e1a3860534b9326"

  validation {
    condition     = can(regex("^[0-9a-f]{40}$", var.cloud_computer_image_tag))
    error_message = "Cloud Computer images must be deployed by a full 40-character Git SHA."
  }
}
