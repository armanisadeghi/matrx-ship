# Cloud Browser / Cloud Computer cold start: SOCI lazy loading for the
# matrx-browser-worker and matrx-cloud-computer images.
#
# 2026-10-15 UPDATE: the factory now builds SOCI Index Manifest **v2** (AWS
# allows only v2 for new SOCI users). `soci convert` re-publishes each pushed
# image tag as an OCI image index = [original manifest, SOCI v2 index]; the
# image tag keeps working unchanged, its digest changes, the layers do not. The
# text below describes the original v1 design and the measurements behind it.

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
  description = "Pinned toolchain for the browser-worker SOCI index builder. soci >= 0.15 provides `soci convert`, which produces SOCI Index Manifest v2 (the only form AWS allows for new SOCI users)."
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
  cloud_computer_soci_repository = aws_ecr_repository.cloud_computer.name
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
    sid = "ReadAndWriteOnlyTheIndexedRepositories"
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
    resources = [
      data.aws_ecr_repository.browser_worker.arn,
      aws_ecr_repository.cloud_computer.arn,
    ]
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

    # Overridden per invocation by the EventBridge input transformer (digest,
    # repository and tag of the pushed image). By hand, override all three:
    # IMAGE_DIGEST=sha256:..., REPOSITORY_NAME=<repo>, IMAGE_TAG=<release tag>.
    environment_variable {
      name  = "IMAGE_DIGEST"
      value = "none"
    }

    environment_variable {
      name  = "IMAGE_TAG"
      value = ""
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
        build:
          commands:
            - |
              cat > /tmp/soci-v2.sh <<'EOS'
              set -eux
              # Image pushed (tag $IMAGE_TAG, digest $IMAGE_DIGEST) -> re-publish the SAME tag
              # as an image index carrying a SOCI Index Manifest v2. The index is the same
              # tag, so the next push event (the converted image) must be refused here.
              case "$IMAGE_TAG" in
                ""|latest|buildcache|sha256-*|*.soci) echo "Not an indexable release tag ($IMAGE_TAG); nothing to do."; exit 0 ;;
              esac
              REGISTRY="$${REPOSITORY_URI%%/*}"
              REF_SRC="$REGISTRY/$REPOSITORY_NAME@$IMAGE_DIGEST"
              REF_DST="$REGISTRY/$REPOSITORY_NAME:$IMAGE_TAG"
              MANIFEST=$(aws ecr batch-get-image --repository-name "$REPOSITORY_NAME" --image-ids "imageDigest=$IMAGE_DIGEST" --query 'images[0].imageManifest' --output text)
              if echo "$MANIFEST" | jq -e '.manifests[]? | select(.artifactType=="application/vnd.amazon.soci.index.v2+json")' >/dev/null; then
                echo "$REPOSITORY_NAME:$IMAGE_TAG already carries a SOCI v2 index; nothing to do."
                exit 0
              fi
              /usr/local/bin/containerd > /tmp/containerd.log 2>&1 &
              timeout 90 sh -c 'until /usr/local/bin/ctr version >/dev/null 2>&1; do sleep 1; done'
              PW=$(aws ecr get-login-password --region "$AWS_REGION")
              # Fetch compressed blobs only; unpacking fails inside CodeBuild (whiteouts).
              /usr/local/bin/ctr content fetch --platform linux/amd64 --user "AWS:$PW" "$REF_SRC"
              /usr/local/bin/soci convert --platform linux/amd64 "$REF_SRC" "$REF_DST"
              /usr/local/bin/ctr images push --user "AWS:$PW" "$REF_DST"
              # Presence in ECR is the only proof that counts: read the pushed tag back.
              set +e
              MISSING=1
              aws ecr batch-get-image --repository-name "$REPOSITORY_NAME" --image-ids "imageTag=$IMAGE_TAG" \
                --query 'images[0].imageManifest' --output text \
                | jq -e '.manifests[]? | select(.artifactType=="application/vnd.amazon.soci.index.v2+json")' >/dev/null && MISSING=0
              echo "soci v2 index for $REPOSITORY_NAME:$IMAGE_TAG missing=$MISSING"
              aws cloudwatch put-metric-data --namespace "$METRIC_NAMESPACE" --metric-name SociIndexMissing \
                --dimensions "Repository=$REPOSITORY_NAME" --unit Count --value "$MISSING"
              exit "$MISSING"
              EOS
            - bash /tmp/soci-v2.sh
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
      "repository-name" = [local.browser_worker_soci_repository, local.cloud_computer_soci_repository]
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
      repo   = "$.detail.repository-name"
      tag    = "$.detail.image-tag"
    }

    # jsonencode escapes angle brackets as \u003c/\u003e, so EventBridge sees a
    # literal "<digest>" instead of substituting the ECR image digest.
    input_template = replace(replace(jsonencode({
      environmentVariablesOverride = [
        { name = "IMAGE_DIGEST", value = "<digest>", type = "PLAINTEXT" },
        { name = "REPOSITORY_NAME", value = "<repo>", type = "PLAINTEXT" },
        { name = "IMAGE_TAG", value = "<tag>", type = "PLAINTEXT" },
      ]
    }), "\\u003c", "<"), "\\u003e", ">")
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
  alarm_description   = "An image was pushed to matrx-browser-worker and no SOCI Index Manifest v2 could be read back from ECR for its tag. Cold starts silently fall back to a full ~62 s image pull until this is fixed: start the ${local.browser_worker_soci_project} CodeBuild project with IMAGE_DIGEST set to the image's digest."
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

resource "aws_cloudwatch_metric_alarm" "cloud_computer_soci_index_missing" {
  alarm_name          = "matrx-production-cloud-computer-soci-index-missing"
  alarm_description   = "An image was pushed to matrx-cloud-computer and no SOCI Index Manifest v2 could be read back from ECR for its tag. Cold starts silently fall back to a full image pull until this is fixed: start the ${local.browser_worker_soci_project} CodeBuild project with IMAGE_DIGEST, REPOSITORY_NAME=matrx-cloud-computer and IMAGE_TAG overrides."
  namespace           = local.browser_worker_soci_namespace
  metric_name         = "SociIndexMissing"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  period              = 1200
  statistic           = "Maximum"
  treat_missing_data  = "notBreaching"

  dimensions = {
    Repository = local.cloud_computer_soci_repository
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
