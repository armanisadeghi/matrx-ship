data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "task_execution" {
  name               = "matrx-production-task-execution"
  path               = "/matrx/platform/"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "task_execution" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "task_execution_secrets" {
  statement {
    actions = [
      "secretsmanager:DescribeSecret",
      "secretsmanager:GetSecretValue",
    ]
    resources = values(aws_secretsmanager_secret.service)[*].arn
  }
}

resource "aws_iam_role_policy" "task_execution_secrets" {
  name   = "read-matrx-production-secrets"
  role   = aws_iam_role.task_execution.id
  policy = data.aws_iam_policy_document.task_execution_secrets.json
}

resource "aws_iam_role" "task" {
  for_each = local.application_services

  name               = "matrx-production-${each.key}-task"
  path               = "/matrx/platform/"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

data "aws_iam_policy_document" "ecs_exec_task" {
  statement {
    actions = [
      "ssmmessages:CreateControlChannel",
      "ssmmessages:CreateDataChannel",
      "ssmmessages:OpenControlChannel",
      "ssmmessages:OpenDataChannel",
    ]
    resources = ["*"]
  }

  statement {
    actions = [
      "logs:CreateLogStream",
      "logs:DescribeLogGroups",
      "logs:DescribeLogStreams",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.ecs_exec.arn}:*"]
  }
}

resource "aws_iam_policy" "ecs_exec_task" {
  name        = "matrx-production-ecs-exec-task"
  path        = "/matrx/platform/"
  description = "Allows audited ECS Exec sessions from Matrx production tasks."
  policy      = data.aws_iam_policy_document.ecs_exec_task.json
}

resource "aws_iam_role_policy_attachment" "ecs_exec_task" {
  for_each = aws_iam_role.task

  role       = each.value.name
  policy_arn = aws_iam_policy.ecs_exec_task.arn
}

data "aws_iam_policy_document" "operator_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type = "AWS"
      identifiers = [
        "arn:aws:iam::${var.aws_account_id}:user/matrx-admin",
        "arn:aws:iam::${var.aws_account_id}:role/aws-reserved/sso.amazonaws.com/us-east-2/AWSReservedSSO_AdministratorAccess_bd1520884fc317a4",
      ]
    }
  }
}

resource "aws_iam_role" "operator" {
  name                 = "matrx-production-operator"
  path                 = "/matrx/platform/"
  max_session_duration = 43200
  assume_role_policy   = data.aws_iam_policy_document.operator_assume.json
}

data "aws_iam_policy_document" "operator" {
  statement {
    sid = "ReadPlatformState"
    actions = [
      "application-autoscaling:Describe*",
      "autoscaling:Describe*",
      "cloudtrail:Get*",
      "cloudtrail:LookupEvents",
      "cloudwatch:Describe*",
      "cloudwatch:Get*",
      "cloudwatch:List*",
      "ec2:Describe*",
      "ecr:Describe*",
      "ecr:Get*",
      "ecr:List*",
      "ecs:Describe*",
      "ecs:List*",
      "elasticfilesystem:Describe*",
      "elasticloadbalancing:Describe*",
      "iam:Get*",
      "iam:List*",
      "logs:Describe*",
      "logs:FilterLogEvents",
      "logs:GetLogEvents",
      "logs:StartQuery",
      "logs:StopQuery",
      "logs:GetQueryResults",
      "servicediscovery:Get*",
      "servicediscovery:List*",
      "secretsmanager:DescribeSecret",
      "secretsmanager:ListSecrets",
      "ssm:Describe*",
      "ssm:GetCommandInvocation",
      "ssm:ListCommandInvocations",
      "ssm:ListCommands",
      "sts:GetCallerIdentity",
    ]
    resources = ["*"]
  }

  statement {
    sid = "ManageDeclaredBrowserWorkerInfrastructure"
    actions = [
      "ec2:AuthorizeSecurityGroupEgress",
      "ec2:AuthorizeSecurityGroupIngress",
      "ec2:CreateSecurityGroup",
      "ec2:CreateTags",
      "ec2:DeleteSecurityGroup",
      "ec2:RevokeSecurityGroupEgress",
      "ec2:RevokeSecurityGroupIngress",
      "ecs:CreateService",
      "ecs:DeleteService",
      "ecs:TagResource",
      "ecs:UntagResource",
      "elasticfilesystem:CreateAccessPoint",
      "elasticfilesystem:CreateFileSystem",
      "elasticfilesystem:CreateMountTarget",
      "elasticfilesystem:DeleteAccessPoint",
      "elasticfilesystem:DeleteFileSystem",
      "elasticfilesystem:DeleteMountTarget",
      "elasticfilesystem:TagResource",
      "elasticfilesystem:UntagResource",
      "servicediscovery:CreateService",
      "servicediscovery:DeleteService",
      "servicediscovery:TagResource",
      "servicediscovery:UntagResource",
      "servicediscovery:UpdateService",
    ]
    resources = ["*"]
  }

  statement {
    sid       = "CreateTaggedBrowserProfileKey"
    actions   = ["kms:CreateKey"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "aws:RequestTag/System"
      values   = [local.common_tags.System]
    }
  }

  statement {
    sid = "ManageBrowserProfileKey"
    actions = [
      "kms:CreateAlias",
      "kms:DeleteAlias",
      "kms:DescribeKey",
      "kms:EnableKeyRotation",
      "kms:GetKeyPolicy",
      "kms:ListAliases",
      "kms:ListResourceTags",
      "kms:PutKeyPolicy",
      "kms:ScheduleKeyDeletion",
      "kms:TagResource",
      "kms:UntagResource",
    ]
    resources = [
      aws_kms_key.browser_profiles.arn,
      "arn:aws:kms:${var.aws_region}:${var.aws_account_id}:alias/matrx-browser-profiles",
    ]
  }

  statement {
    sid = "ManageBrowserCheckpointBucket"
    actions = [
      "s3:CreateBucket",
      "s3:DeleteBucket",
      "s3:DeleteBucketPolicy",
      "s3:GetBucketPolicy",
      "s3:GetBucketPublicAccessBlock",
      "s3:GetBucketVersioning",
      "s3:GetEncryptionConfiguration",
      "s3:GetLifecycleConfiguration",
      "s3:GetOwnershipControls",
      "s3:PutBucketPolicy",
      "s3:PutBucketPublicAccessBlock",
      "s3:PutBucketVersioning",
      "s3:PutEncryptionConfiguration",
      "s3:PutLifecycleConfiguration",
      "s3:PutOwnershipControls",
    ]
    resources = [aws_s3_bucket.browser_checkpoints.arn]
  }

  statement {
    sid = "ManageBrowserProfileMountPolicy"
    actions = [
      "iam:DeleteRolePolicy",
      "iam:GetRolePolicy",
      "iam:PutRolePolicy",
    ]
    resources = [aws_iam_role.task["aidream"].arn]
  }

  statement {
    sid = "OperateProductionEcs"
    actions = [
      "application-autoscaling:DeleteScalingPolicy",
      "application-autoscaling:DeregisterScalableTarget",
      "application-autoscaling:PutScalingPolicy",
      "application-autoscaling:RegisterScalableTarget",
      "ecs:ExecuteCommand",
      "ecs:RunTask",
      "ecs:StartTask",
      "ecs:StopTask",
      "ecs:UpdateService",
    ]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/System"
      values   = [local.common_tags.System]
    }
  }

  statement {
    sid = "ReadProductionTerraformStateBucket"
    actions = [
      "s3:GetBucketLocation",
      "s3:ListBucket",
    ]
    resources = ["arn:aws:s3:::matrx-terraform-state-${var.aws_account_id}"]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["aws/production-platform/*"]
    }
  }

  statement {
    sid = "ManageProductionTerraformStateObjects"
    actions = [
      "s3:DeleteObject",
      "s3:GetObject",
      "s3:PutObject",
    ]
    resources = [
      "arn:aws:s3:::matrx-terraform-state-${var.aws_account_id}/aws/production-platform/terraform.tfstate",
      "arn:aws:s3:::matrx-terraform-state-${var.aws_account_id}/aws/production-platform/terraform.tfstate.tflock",
    ]
  }

  statement {
    sid = "RegisterTaskDefinitions"
    actions = [
      "ecs:DeregisterTaskDefinition",
      "ecs:RegisterTaskDefinition",
    ]
    resources = ["*"]
  }

  statement {
    sid = "PushServiceImages"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = concat(
      values(aws_ecr_repository.service)[*].arn,
      [
        "arn:aws:ecr:${var.aws_region}:${var.aws_account_id}:repository/matrx/aidream-server",
        "arn:aws:ecr:${var.aws_region}:${var.aws_account_id}:repository/matrx-browser-worker",
      ],
    )
  }

  statement {
    sid       = "AuthenticateToEcr"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "ReadAndUpdateRuntimeSecrets"
    actions = [
      "secretsmanager:DescribeSecret",
      "secretsmanager:GetSecretValue",
      "secretsmanager:PutSecretValue",
      "secretsmanager:UpdateSecret",
    ]
    resources = concat(
      values(aws_secretsmanager_secret.service)[*].arn,
      [aws_secretsmanager_secret.supabase_east_migration.arn],
    )
  }

  statement {
    sid = "ManageSupabaseMigrationArtifacts"
    actions = [
      "s3:AbortMultipartUpload",
      "s3:GetBucketLocation",
      "s3:GetObject",
      "s3:ListBucket",
      "s3:ListBucketMultipartUploads",
      "s3:ListMultipartUploadParts",
      "s3:PutObject",
    ]
    resources = [
      aws_s3_bucket.supabase_migration_artifacts.arn,
      "${aws_s3_bucket.supabase_migration_artifacts.arn}/*",
    ]
  }

  statement {
    sid = "UseSupabaseMigrationArtifactKey"
    actions = [
      "kms:Decrypt",
      "kms:DescribeKey",
      "kms:Encrypt",
      "kms:GenerateDataKey",
    ]
    resources = [aws_kms_key.supabase_migration_artifacts.arn]
  }

  statement {
    sid     = "PassPlatformTaskRoles"
    actions = ["iam:PassRole"]
    resources = concat(
      [aws_iam_role.task_execution.arn],
      values(aws_iam_role.task)[*].arn,
    )

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }

  statement {
    sid = "EcsExecSessionTransport"
    actions = [
      "ssm:StartSession",
      "ssm:TerminateSession",
      "ssm:ResumeSession",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "operator" {
  name        = "matrx-production-operator"
  path        = "/matrx/platform/"
  description = "Day-to-day ECS deployment, logs, diagnostics, images, and runtime-secret access for the Matrx production platform."
  policy      = data.aws_iam_policy_document.operator.json
}

resource "aws_iam_role_policy_attachment" "operator" {
  role       = aws_iam_role.operator.name
  policy_arn = aws_iam_policy.operator.arn
}
