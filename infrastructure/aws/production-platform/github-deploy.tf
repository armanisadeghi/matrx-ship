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
      aws_ecs_service.aidream.id,
      aws_ecs_service.browser_worker.id,
      aws_ecs_service.workflow_worker.id,
    ]
  }

  statement {
    sid     = "PassECSTaskRoles"
    actions = ["iam:PassRole"]
    resources = [
      aws_iam_role.task_execution.arn,
      aws_iam_role.task["aidream"].arn,
      aws_iam_role.task["workflow-worker"].arn,
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
