# Cloud Browser cold start: SOCI lazy loading for the browser worker image.
#
# Measured 2026-09-17: every dedicated Fargate browser task spent 62-64 s in
# pullStartedAt -> pullStoppedAt on the 1.807 GB, 18-layer
# `matrx-browser-worker` image. Fargate platform version 1.4.0 lazy-loads a
# container image automatically WHEN, AND ONLY WHEN, a SOCI Index Manifest v1
# artifact exists in ECR for that exact image manifest. No task definition,
# service, or application change is involved — the index is the whole switch.
#
# This file is the index factory: an ECR image push fans out through EventBridge
# into a CodeBuild project that pulls the pushed manifest into containerd,
# builds the v1 index with the soci CLI, and pushes it back as a referrer of the
# same manifest. It owns nothing that already exists — every resource here is
# additive, and nothing in the browser worker's task definition or service is
# touched.
#
# The silent-failure hazard is the reason for the alarms below: when the index
# is missing, Fargate does NOT fail — it quietly falls back to a full 62 s pull.
# A degraded cold start looks exactly like a healthy one from the outside, so
# the absence of an index must scream on its own.

variable "browser_worker_soci_versions" {
  description = "Pinned toolchain for the browser-worker SOCI index builder. soci >= 0.15 still produces Index Manifest v1 (`soci create` + `soci push`), which is the only form Fargate 1.4.0 lazy-loads; `soci convert` (v2) produces a different image and would NOT be picked up."
  type = object({
    soci       = string
    containerd = string
  })
  default = {
    soci       = "0.15.0"
    containerd = "2.1.4"
  }

  validation {
    condition = (
      can(regex("^[0-9]+\\.[0-9]+\\.[0-9]+$", var.browser_worker_soci_versions.soci)) &&
      can(regex("^[0-9]+\\.[0-9]+\\.[0-9]+$", var.browser_worker_soci_versions.containerd))
    )
    error_message = "Pin the soci and containerd toolchain to exact semantic versions."
  }
}

locals {
  browser_worker_soci_project    = "${local.name_prefix}-browser-worker-soci-index"
  browser_worker_soci_namespace  = "Matrx/CloudBrowser"
  browser_worker_soci_repository = data.aws_ecr_repository.browser_worker.name
}

resource "aws_cloudwatch_log_group" "browser_worker_soci" {
  name              = "/matrx/production/browser-worker-soci-index"
  retention_in_days = 90

  tags = { Name = local.browser_worker_soci_project }
}

data "aws_iam_policy_document" "browser_worker_soci_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["codebuild.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "browser_worker_soci" {
  name               = "matrx-production-browser-worker-soci-index"
  path               = "/matrx/platform/"
  assume_role_policy = data.aws_iam_policy_document.browser_worker_soci_assume.json
}

data "aws_iam_policy_document" "browser_worker_soci" {
  # ECR's authorization token is account-wide by API design and cannot be
  # scoped to a repository. Every action that touches image content below is
  # pinned to the single browser worker repository ARN.
  statement {
    sid       = "AuthenticateToEcr"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "ReadAndWriteOnlyTheBrowserWorkerRepository"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:DescribeImages",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:ListImages",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = [data.aws_ecr_repository.browser_worker.arn]
  }

  statement {
    sid = "WriteOwnBuildLogs"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.browser_worker_soci.arn}:*"]
  }

  statement {
    sid       = "ReportIndexPresence"
    actions   = ["cloudwatch:PutMetricData"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "cloudwatch:namespace"
      values   = [local.browser_worker_soci_namespace]
    }
  }
}

resource "aws_iam_role_policy" "browser_worker_soci" {
  name   = "build-browser-worker-soci-index"
  role   = aws_iam_role.browser_worker_soci.id
  policy = data.aws_iam_policy_document.browser_worker_soci.json
}

resource "aws_codebuild_project" "browser_worker_soci" {
  name          = local.browser_worker_soci_project
  description   = "Builds and pushes the SOCI Index Manifest v1 for every matrx-browser-worker image so Fargate 1.4.0 lazy-loads it instead of pulling 1.8 GB."
  service_role  = aws_iam_role.browser_worker_soci.arn
  build_timeout = 20

  artifacts { type = "NO_ARTIFACTS" }

  environment {
    # The soci CLI needs a containerd content store, which needs a privileged
    # container. LARGE is chosen for network and CPU: the build pulls the whole
    # 1.8 GB image and computes a zTOC per layer.
    compute_type    = "BUILD_GENERAL1_LARGE"
    image           = "aws/codebuild/standard:7.0"
    type            = "LINUX_CONTAINER"
    privileged_mode = true

    environment_variable {
      name  = "REPOSITORY_NAME"
      value = local.browser_worker_soci_repository
    }

    environment_variable {
      name  = "REPOSITORY_URI"
      value = data.aws_ecr_repository.browser_worker.repository_url
    }

    environment_variable {
      name  = "METRIC_NAMESPACE"
      value = local.browser_worker_soci_namespace
    }

    environment_variable {
      name  = "SOCI_VERSION"
      value = var.browser_worker_soci_versions.soci
    }

    environment_variable {
      name  = "CONTAINERD_VERSION"
      value = var.browser_worker_soci_versions.containerd
    }

    # Overridden per invocation by the EventBridge input transformer. The
    # default is the mutable `latest` tag so an operator can start the project
    # by hand with no overrides and still index the live image.
    environment_variable {
      name  = "IMAGE_DIGEST"
      value = "latest"
    }
  }

  logs_config {
    cloudwatch_logs {
      group_name  = aws_cloudwatch_log_group.browser_worker_soci.name
      stream_name = "build"
    }
  }

  source {
    type      = "NO_SOURCE"
    buildspec = <<-BUILDSPEC
      version: 0.2

      phases:
        install:
          commands:
            - set -eux
            - curl -fsSL "https://github.com/awslabs/soci-snapshotter/releases/download/v$SOCI_VERSION/soci-snapshotter-$SOCI_VERSION-linux-amd64-static.tar.gz" -o /tmp/soci.tgz
            - tar -C /usr/local/bin -xzf /tmp/soci.tgz soci soci-snapshotter-grpc
            - curl -fsSL "https://github.com/containerd/containerd/releases/download/v$CONTAINERD_VERSION/containerd-$CONTAINERD_VERSION-linux-amd64.tar.gz" -o /tmp/containerd.tgz
            - tar -C /usr/local -xzf /tmp/containerd.tgz
            - soci --version
        pre_build:
          commands:
            - set -eux
            # The index artifact is itself an image in the same repository, so
            # indexing it would loop. EventBridge already filters it out; this
            # is the second, local refusal.
            - |
              case "$IMAGE_DIGEST" in
                sha256-*|*.soci) echo "Refusing to index a SOCI artifact ($IMAGE_DIGEST)."; exit 0 ;;
              esac
            - |
              case "$IMAGE_DIGEST" in
                sha256:*) IMAGE_REF="$REPOSITORY_URI@$IMAGE_DIGEST" ;;
                *)        IMAGE_REF="$REPOSITORY_URI:$IMAGE_DIGEST" ;;
              esac
              echo "IMAGE_REF=$IMAGE_REF" > /tmp/soci.env
            - /usr/local/bin/containerd > /tmp/containerd.log 2>&1 &
            - timeout 90 sh -c 'until /usr/local/bin/ctr version >/dev/null 2>&1; do sleep 1; done'
            - aws ecr get-login-password --region "$AWS_REGION" > /tmp/ecr-password
        build:
          commands:
            - set -eux
            - . /tmp/soci.env
            - /usr/local/bin/ctr images pull --user "AWS:$(cat /tmp/ecr-password)" "$IMAGE_REF"
            - soci create "$IMAGE_REF"
            - soci push --user "AWS:$(cat /tmp/ecr-password)" "$IMAGE_REF"
        post_build:
          commands:
            # Presence in ECR is the only proof that counts: a build that
            # "succeeded" without a readable index artifact is a silent 62 s
            # pull, and must report itself missing.
            - |
              set +e
              MISSING=1
              . /tmp/soci.env 2>/dev/null
              INDEX_DIGEST=$(soci index ls --ref "$IMAGE_REF" -q 2>/dev/null | head -n 1)
              if [ -n "$INDEX_DIGEST" ]; then
                MEDIA=$(aws ecr describe-images \
                  --repository-name "$REPOSITORY_NAME" \
                  --image-ids "imageDigest=$INDEX_DIGEST" \
                  --query 'imageDetails[0].artifactMediaType' --output text 2>/dev/null)
                if [ "$MEDIA" = "application/vnd.amazon.soci.index.v1+json" ]; then
                  MISSING=0
                fi
              fi
              echo "soci index for $IMAGE_REF -> digest=$INDEX_DIGEST missing=$MISSING"
              aws cloudwatch put-metric-data \
                --namespace "$METRIC_NAMESPACE" \
                --metric-name SociIndexMissing \
                --dimensions "Repository=$REPOSITORY_NAME" \
                --unit Count --value "$MISSING"
              exit "$MISSING"
    BUILDSPEC
  }

  tags = { Name = local.browser_worker_soci_project }
}

data "aws_iam_policy_document" "browser_worker_soci_events_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "browser_worker_soci_events" {
  name               = "matrx-production-browser-worker-soci-events"
  path               = "/matrx/platform/"
  assume_role_policy = data.aws_iam_policy_document.browser_worker_soci_events_assume.json
}

data "aws_iam_policy_document" "browser_worker_soci_events" {
  statement {
    sid       = "StartOnlyTheSociIndexBuild"
    actions   = ["codebuild:StartBuild"]
    resources = [aws_codebuild_project.browser_worker_soci.arn]
  }
}

resource "aws_iam_role_policy" "browser_worker_soci_events" {
  name   = "start-browser-worker-soci-index-build"
  role   = aws_iam_role.browser_worker_soci_events.id
  policy = data.aws_iam_policy_document.browser_worker_soci_events.json
}

resource "aws_cloudwatch_event_rule" "browser_worker_soci" {
  name        = "${local.name_prefix}-browser-worker-image-pushed"
  description = "A successful image push to matrx-browser-worker builds its SOCI index so Fargate lazy-loads the next cold start."

  event_pattern = jsonencode({
    source      = ["aws.ecr"]
    detail-type = ["ECR Image Action"]
    detail = {
      "action-type"     = ["PUSH"]
      result            = ["SUCCESS"]
      "repository-name" = [local.browser_worker_soci_repository]
      # The pushed SOCI index lands in the same repository. Indexing an index
      # is meaningless and would recurse, so untagged and `sha256-…`-tagged
      # referrer artifacts never reach the builder. `anything-but` also
      # requires the field to be present, which excludes untagged pushes.
      "image-tag" = [{ "anything-but" = { prefix = "sha256-" } }]
    }
  })

  tags = { Name = "${local.name_prefix}-browser-worker-image-pushed" }
}

resource "aws_cloudwatch_event_target" "browser_worker_soci" {
  rule     = aws_cloudwatch_event_rule.browser_worker_soci.name
  arn      = aws_codebuild_project.browser_worker_soci.arn
  role_arn = aws_iam_role.browser_worker_soci_events.arn

  input_transformer {
    input_paths = {
      digest = "$.detail.image-digest"
    }

    input_template = jsonencode({
      environmentVariablesOverride = [{
        name  = "IMAGE_DIGEST"
        value = "<digest>"
        type  = "PLAINTEXT"
      }]
    })
  }
}

# ---------------------------------------------------------------------------
# A missing index degrades silently. These three alarms cover the three ways
# it can go missing, so none of them can hide behind a healthy-looking task.
#
# Note on routing: this Terraform root declares no SNS topic and no account SNS
# topic exists (verified 2026-09-17); every existing alarm in monitoring.tf is
# likewise action-less and is read from the alarm console and the production
# dashboard. These follow that same convention rather than inventing a topic
# with no subscriber — a notification path nobody receives is exactly the
# silent failure this guard exists to prevent. When a real notification target
# is introduced, wire every alarm in this root at once.
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "browser_worker_soci_index_missing" {
  alarm_name          = "matrx-production-browser-worker-soci-index-missing"
  alarm_description   = "An image was pushed to matrx-browser-worker and no SOCI Index Manifest v1 artifact could be read back from ECR for it. Cold starts silently fall back to a full ~62 s image pull until this is fixed: start the ${local.browser_worker_soci_project} CodeBuild project with IMAGE_DIGEST set to the image's digest."
  namespace           = local.browser_worker_soci_namespace
  metric_name         = "SociIndexMissing"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  period              = 1200
  statistic           = "Maximum"

  # No push in the window means nothing to index; the two alarms below cover a
  # push whose build never reported at all.
  treat_missing_data = "notBreaching"

  dimensions = {
    Repository = local.browser_worker_soci_repository
  }
}

resource "aws_cloudwatch_metric_alarm" "browser_worker_soci_build_failed" {
  alarm_name          = "matrx-production-browser-worker-soci-index-build-failed"
  alarm_description   = "The browser worker SOCI index build failed or exceeded its 20-minute timeout, so the pushed image has no index and its cold start is a full ~62 s pull. Read /matrx/production/browser-worker-soci-index."
  namespace           = "AWS/CodeBuild"
  metric_name         = "FailedBuilds"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  period              = 1200
  statistic           = "Sum"
  treat_missing_data  = "notBreaching"

  dimensions = {
    ProjectName = aws_codebuild_project.browser_worker_soci.name
  }
}

resource "aws_cloudwatch_metric_alarm" "browser_worker_soci_trigger_undelivered" {
  alarm_name          = "matrx-production-browser-worker-soci-trigger-undelivered"
  alarm_description   = "EventBridge could not start the browser worker SOCI index build after an image push, so no build exists to report a missing index. Cold starts silently fall back to a full ~62 s pull."
  namespace           = "AWS/Events"
  metric_name         = "FailedInvocations"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  period              = 1200
  statistic           = "Sum"
  treat_missing_data  = "notBreaching"

  dimensions = {
    RuleName = aws_cloudwatch_event_rule.browser_worker_soci.name
  }
}

output "browser_worker_soci_index_project" {
  description = "CodeBuild project that builds the browser worker SOCI index. Start it by hand for an image that predates the trigger: aws codebuild start-build --project-name <name> --environment-variables-override name=IMAGE_DIGEST,value=sha256:...,type=PLAINTEXT"
  value       = aws_codebuild_project.browser_worker_soci.name
}
