data "aws_iam_role" "aidream_github_deploy" {
  name = "matrx-aidream-gha-deploy"
}

data "aws_iam_policy_document" "aidream_github_deploy" {
  statement {
    sid       = "ECRAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "ECRPushPull"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:DescribeImages",
      "ecr:DescribeRepositories",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = [
      data.aws_ecr_repository.aidream.arn,
      data.aws_ecr_repository.browser_worker.arn,
    ]
  }

  statement {
    sid = "SSMDeploy"
    actions = [
      "ssm:GetCommandInvocation",
      "ssm:ListCommandInvocations",
      "ssm:SendCommand",
    ]
    resources = ["*"]
  }

  statement {
    sid = "ECSTaskDefinitions"
    actions = [
      "ecs:DescribeTaskDefinition",
      "ecs:RegisterTaskDefinition",
    ]
    resources = ["*"]
  }

  statement {
    sid = "ECSServiceDeploy"
    actions = [
      "ecs:DescribeServices",
      "ecs:UpdateService",
    ]
    resources = [
      "arn:aws:ecs:${var.aws_region}:${var.aws_account_id}:service/${aws_ecs_cluster.production.name}/aidream",
      "arn:aws:ecs:${var.aws_region}:${var.aws_account_id}:service/${aws_ecs_cluster.production.name}/browser-worker",
      "arn:aws:ecs:${var.aws_region}:${var.aws_account_id}:service/${aws_ecs_cluster.production.name}/workflow-worker",
    ]
  }

  statement {
    sid     = "PassECSTaskRoles"
    actions = ["iam:PassRole"]
    resources = [
      "arn:aws:iam::${var.aws_account_id}:role/matrx/platform/matrx-production-task-execution",
      "arn:aws:iam::${var.aws_account_id}:role/matrx/platform/matrx-production-aidream-task",
      "arn:aws:iam::${var.aws_account_id}:role/matrx/platform/matrx-production-browser-worker-task",
      "arn:aws:iam::${var.aws_account_id}:role/matrx/platform/matrx-production-workflow-worker-task",
    ]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "aidream_github_deploy" {
  name   = "matrx-aidream-gha-deploy-permissions"
  role   = data.aws_iam_role.aidream_github_deploy.id
  policy = data.aws_iam_policy_document.aidream_github_deploy.json
}
