# Video render worker (video cloning, lane VC-03).
#
# One Fargate task renders one video: Chromium (Playwright) + ffmpeg + the scraper's fonts mapping.
# Plan: common-docs/projects/video-cloning/PLAN.md. Launcher: aidream/aidream/services/render_jobs.
#
# Everything here is additive and separate from the browser fleet and Cloud Computer: its own ECR
# repository, log group, security group (egress only, NO ingress: the worker is never called, it
# reads its job from the environment and uploads to a presigned URL), task role (no permissions),
# task family and dormant service. The concurrency cap is an APPLICATION knob
# (platform.feature_knob video_render.max_concurrent_tasks, default 10, migration 1485); the Fargate
# vCPU account quota is the hard ceiling and is shared by every Fargate user in the account.
#
# Release-ownership guard (production-infra FEATURE.md): the task definition ignores
# container_definitions, the service ignores task_definition / platform_version / desired_count.

locals {
  render_worker_family     = "${local.name_prefix}-render-worker"
  render_worker_managed_by = "matrx-render-worker"
}

variable "render_worker_image_tag" {
  description = "Tag of the render worker image in matrx-render-worker (a full Git SHA once the release builds it; `latest` for the first push)."
  type        = string
  default     = "latest"
}

resource "aws_ecr_repository" "render_worker" {
  name                 = "matrx-render-worker"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration { scan_on_push = true }

  encryption_configuration { encryption_type = "AES256" }

  tags = { Name = "${local.name_prefix}-render-worker" }
}

resource "aws_ecr_lifecycle_policy" "render_worker" {
  repository = aws_ecr_repository.render_worker.name
  policy     = local.ecr_lifecycle_rules[20]
}

resource "aws_cloudwatch_log_group" "render_worker" {
  name              = "/matrx/production/render-worker"
  retention_in_days = 90
}

resource "aws_security_group" "render_worker" {
  name        = "${local.name_prefix}-render-worker"
  description = "Render workers accept no inbound traffic; they fetch pages and assets and upload the mp4."
  vpc_id      = aws_vpc.production.id

  egress {
    description = "Page and asset fetches, presigned uploads, progress callback"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-render-worker" }
}

# No AWS permissions: output goes to a presigned URL minted by the launcher's caller.
resource "aws_iam_role" "render_worker_task" {
  name               = "matrx-production-render-worker-task"
  path               = "/matrx/platform/"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

# 4 vCPU / 8 GB: one video per task, about one core per browser (spike VC-S2). RunTask may override
# cpu/memory per job (the launcher's cpu/memory arguments).
resource "aws_ecs_task_definition" "render_worker" {
  family                   = local.render_worker_family
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 4096
  memory                   = 8192
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.render_worker_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  # Chunks, frames in flight and the final mp4 live on local disk.
  ephemeral_storage { size_in_gib = 50 }

  container_definitions = jsonencode([{
    name      = "render-worker"
    image     = "${aws_ecr_repository.render_worker.repository_url}:${var.render_worker_image_tag}"
    essential = true

    # The launcher sets RENDER_JOB_B64 (or RENDER_JOB_URL), RENDER_RUN_ID and RENDER_JOB_ID per task.
    environment = [
      { name = "NODE_ENV", value = "production" },
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.render_worker.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "render"
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

  tags = { Name = local.render_worker_family }

  lifecycle { ignore_changes = [container_definitions] }
}

# Desired 0, never scaled: the launcher reads the PRIMARY deployment's private network shape from it
# (the same pattern as browser-worker and cloud-computer), so subnets and the SG live in one place.
resource "aws_ecs_service" "render_worker" {
  name             = "render-worker"
  cluster          = aws_ecs_cluster.production.id
  task_definition  = aws_ecs_task_definition.render_worker.arn
  desired_count    = 0
  launch_type      = "FARGATE"
  platform_version = "LATEST"

  network_configuration {
    subnets          = values(aws_subnet.private)[*].id
    security_groups  = [aws_security_group.render_worker.id]
    assign_public_ip = false
  }

  tags = { Name = "${local.name_prefix}-render-worker" }

  lifecycle { ignore_changes = [desired_count, task_definition, platform_version] }
}

# Control-plane rights for AI Dream and the workflow worker: launch, find and stop ONLY render tasks.
data "aws_iam_policy_document" "render_worker_launch" {
  statement {
    sid       = "ReadRenderService"
    actions   = ["ecs:DescribeServices"]
    resources = [aws_ecs_service.render_worker.id]
  }

  statement {
    sid       = "ReadRenderTaskDefinition"
    actions   = ["ecs:DescribeTaskDefinition"]
    resources = ["*"]
  }

  statement {
    sid       = "CountRenderTasks"
    actions   = ["ecs:ListTasks"]
    resources = ["*"]
    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [aws_ecs_cluster.production.arn]
    }
  }

  statement {
    sid       = "InspectRenderTasks"
    actions   = ["ecs:DescribeTasks", "ecs:ListTagsForResource"]
    resources = ["arn:aws:ecs:${var.aws_region}:${var.aws_account_id}:task/${aws_ecs_cluster.production.name}/*"]
  }

  statement {
    sid       = "LaunchRenderTasks"
    actions   = ["ecs:RunTask"]
    resources = ["arn:aws:ecs:${var.aws_region}:${var.aws_account_id}:task-definition/${aws_ecs_task_definition.render_worker.family}:*"]
    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [aws_ecs_cluster.production.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:RequestTag/managed-by"
      values   = [local.render_worker_managed_by]
    }
  }

  statement {
    sid       = "TagRenderTasksAtCreation"
    actions   = ["ecs:TagResource"]
    resources = ["arn:aws:ecs:${var.aws_region}:${var.aws_account_id}:task/${aws_ecs_cluster.production.name}/*"]
    condition {
      test     = "StringEquals"
      variable = "ecs:CreateAction"
      values   = ["RunTask"]
    }
  }

  statement {
    sid       = "StopOnlyRenderTasks"
    actions   = ["ecs:StopTask"]
    resources = ["arn:aws:ecs:${var.aws_region}:${var.aws_account_id}:task/${aws_ecs_cluster.production.name}/*"]
    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/managed-by"
      values   = [local.render_worker_managed_by]
    }
  }

  statement {
    sid     = "PassOnlyRenderRoles"
    actions = ["iam:PassRole"]
    resources = [
      aws_iam_role.task_execution.arn,
      aws_iam_role.render_worker_task.arn,
    ]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "render_worker_launch" {
  for_each = toset(["aidream", "workflow-worker"])
  name     = "render-worker-lifecycle"
  role     = aws_iam_role.task[each.key].id
  policy   = data.aws_iam_policy_document.render_worker_launch.json
}

output "render_worker" {
  value = {
    ecr_repository = aws_ecr_repository.render_worker.repository_url
    task_family    = aws_ecs_task_definition.render_worker.family
    security_group = aws_security_group.render_worker.id
    service        = aws_ecs_service.render_worker.name
    task_role      = aws_iam_role.render_worker_task.arn
    log_group      = aws_cloudwatch_log_group.render_worker.name
  }
}
