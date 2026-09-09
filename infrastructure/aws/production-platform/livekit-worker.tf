# Canonical LiveKit room worker (Meet Realtime Intelligence, MRI-B1).
#
# One image, one more runtime role: this is the aidream image running with
# MATRX_ROLE=livekit_worker, dispatched by the image's own entrypoint.sh
# exactly like the workflow worker (MATRX_ROLE=worker). There is deliberately
# NO command override — a command override could silently boot the wrong
# process, which is the failure class entrypoint.sh's role switch exists to
# prevent.
#
# It replaces the hand-created `meet-note-taker` ECS service. That service is
# still live and is NOT touched here; it is drained and deleted by MRI-C6 only
# after this worker has served a verified meeting.
#
# desired_count 2 across AZs (D13) since MRI-C3 passed on 2026-09-09; the
# initial rollout ran at 0 until the image carried the livekit_worker role.
# Terraform ignores desired_count from then on (see the lifecycle block below).

resource "aws_security_group" "livekit_worker" {
  name        = "${local.name_prefix}-livekit-worker"
  description = "LiveKit room worker has no ingress and reaches only external/internal dependencies."
  vpc_id      = aws_vpc.production.id

  egress {
    description = "LiveKit Cloud (wss), Supabase, speech-to-text providers, S3, and logs"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-livekit-worker" }
}

# Least privilege: the task role may read its OWN runtime secret and nothing
# else. Container log delivery is the execution role's job, and ECS Exec comes
# from the shared `ecs_exec_task` policy attached in iam.tf. The worker never
# touches S3, KMS, or any AI provider (D2: reasoning never runs in this
# process), so it deliberately does NOT get the aidream_aws_services policy the
# workflow worker carries.
data "aws_iam_policy_document" "livekit_worker_secret" {
  statement {
    sid = "ReadOwnRuntimeSecret"
    actions = [
      "secretsmanager:DescribeSecret",
      "secretsmanager:GetSecretValue",
    ]
    resources = [aws_secretsmanager_secret.service["livekit-worker"].arn]
  }
}

resource "aws_iam_role_policy" "livekit_worker_secret" {
  name   = "read-own-runtime-secret"
  role   = aws_iam_role.task["livekit-worker"].id
  policy = data.aws_iam_policy_document.livekit_worker_secret.json
}

resource "aws_ecs_task_definition" "livekit_worker" {
  family                   = "matrx-production-livekit-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 2048
  memory                   = 8192
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task["livekit-worker"].arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name      = "livekit-worker"
    image     = "${data.aws_ecr_repository.aidream.repository_url}:${var.livekit_worker_image_tag}"
    essential = true

    environment = [
      { name = "MATRX_STAGE", value = "production" },
      { name = "MATRX_ROLE", value = "livekit_worker" },
    ]

    # Every value comes from this service's OWN secret container, whose WHOLE
    # string is the flat runtime document (the same convention as aidream and
    # workflow-worker): MATRX_RUNTIME_ENV_JSON is the bare secret ARN and the
    # image expands the document; the four LiveKit values are top-level keys of
    # that same document, read as individual JSON-key selectors so the worker's
    # registration identity is legible in the task definition. A nested
    # document (secret key MATRX_RUNTIME_ENV_JSON inside the secret) breaks
    # render_ecs_task_definition.jq, which appends `:KEY::` to this ARN on every
    # release — proven 2026-09-08 by ResourceInitializationError at C1.
    secrets = [
      {
        name      = "MATRX_RUNTIME_ENV_JSON"
        valueFrom = aws_secretsmanager_secret.service["livekit-worker"].arn
      },
      {
        name      = "LIVEKIT_URL"
        valueFrom = "${aws_secretsmanager_secret.service["livekit-worker"].arn}:LIVEKIT_URL::"
      },
      {
        name      = "LIVEKIT_API_KEY"
        valueFrom = "${aws_secretsmanager_secret.service["livekit-worker"].arn}:LIVEKIT_API_KEY::"
      },
      {
        name      = "LIVEKIT_API_SECRET"
        valueFrom = "${aws_secretsmanager_secret.service["livekit-worker"].arn}:LIVEKIT_API_SECRET::"
      },
      {
        name      = "LIVEKIT_AGENT_NAME"
        valueFrom = "${aws_secretsmanager_secret.service["livekit-worker"].arn}:LIVEKIT_AGENT_NAME::"
      },
    ]

    # The LiveKit agents SDK serves its worker health endpoint on 8081. `curl`
    # is installed in the aidream runtime image (Dockerfile runtime stage).
    healthCheck = {
      command     = ["CMD-SHELL", "curl -f http://localhost:8081/ || exit 1"]
      interval    = 30
      timeout     = 10
      retries     = 3
      startPeriod = 90
    }

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.application["livekit-worker"].name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "ecs"
      }
    }

    linuxParameters        = { initProcessEnabled = true }
    readonlyRootFilesystem = false

    # D9: a release is a fast, honest handoff, not a drain. The job flushes,
    # stamps handoff_pending, and leaves within seconds; 120s is headroom, not
    # a drain window.
    stopTimeout = 120
    ulimits = [{
      name      = "nofile"
      softLimit = 65536
      hardLimit = 65536
    }]
  }])

  # RELEASE-OWNED CONTENT (drift class fixed 2026-09-08, MRI-B2).
  # aidream/scripts/deploy_ecs_primary.sh registers a new revision of this
  # family on every release: render_ecs_task_definition.jq rewrites the
  # container image and, for the runtime-secret services, expands
  # MATRX_RUNTIME_ENV_JSON into materialized `secrets` entries. Terraform's
  # tracked revision is therefore always behind the live one, and re-asserting
  # this block would register a phantom revision and deregister the tracked one
  # on every untargeted apply. Terraform owns the SHAPE (family, cpu, memory,
  # roles, volumes, runtime platform) and the initial definition; the release
  # pipeline owns the container content.
  # To change container content deliberately: edit this block, then
  # `terraform apply -replace=aws_ecs_task_definition.livekit_worker` (registers a new revision; it does NOT deploy
  # — a release or an explicit `aws ecs update-service` does that).
  lifecycle { ignore_changes = [container_definitions] }
}

resource "aws_ecs_service" "livekit_worker" {
  name                   = "livekit-worker"
  cluster                = aws_ecs_cluster.production.id
  task_definition        = aws_ecs_task_definition.livekit_worker.arn
  desired_count          = 2
  enable_execute_command = true
  launch_type            = "FARGATE"
  platform_version       = "LATEST"
  propagate_tags         = "SERVICE"

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = values(aws_subnet.private)[*].id
    security_groups  = [aws_security_group.livekit_worker.id]
    assign_public_ip = false
  }

  tags = { Name = "${local.name_prefix}-livekit-worker" }

  depends_on = [aws_iam_role_policy.livekit_worker_secret]

  # The operator owns desired_count (MRI-C1 raises it from 0 to 1); the aidream
  # release workflow advances the immutable image revision in task_definition.
  # No autoscaling by design (D13) — measure a concurrent-room load test first.
  # ECS resolves `LATEST` to a concrete Fargate platform version on the live
  # service, and nothing in the release pipeline sets platform_version.
  # aidream and workflow-worker already read back `1.4.0`, so re-asserting
  # `LATEST` is a zero-value change that would force a production deployment.
  # LATEST stays the declared intent; the read-back value is ignored. To move a
  # service to a specific platform version, set it here AND drop it from
  # ignore_changes — that is a deliberate deployment.
  lifecycle { ignore_changes = [desired_count, task_definition, platform_version] }
}
