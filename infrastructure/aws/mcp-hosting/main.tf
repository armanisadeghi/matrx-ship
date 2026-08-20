locals {
  common_tags = {
    Environment = "production"
    ManagedBy   = "terraform"
    Owner       = "matrx-ship"
    System      = "ai-matrx-mcp-hosting"
    Region      = var.aws_region
  }
}

data "aws_caller_identity" "current" {}

check "expected_account" {
  assert {
    condition     = data.aws_caller_identity.current.account_id == var.aws_account_id
    error_message = "Refusing to manage MCP hosting outside AWS account ${var.aws_account_id}."
  }
}

check "expected_region" {
  assert {
    condition     = var.aws_region == "us-east-1"
    error_message = "Matrx MCP hosting is intentionally pinned to us-east-1."
  }
}

data "aws_iam_role" "operator" {
  name = var.operator_role_name
}

data "aws_iam_policy_document" "apprunner_ecr_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["build.apprunner.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "apprunner_ecr_access" {
  name               = "matrx-mcp-apprunner-ecr-access"
  path               = "/matrx/mcp-hosting/"
  description        = "Allows App Runner to pull immutable Matrx MCP images from ECR."
  assume_role_policy = data.aws_iam_policy_document.apprunner_ecr_assume.json
}

resource "aws_iam_role_policy_attachment" "apprunner_ecr_access" {
  role       = aws_iam_role.apprunner_ecr_access.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess"
}

data "aws_iam_policy_document" "apprunner_runtime_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["tasks.apprunner.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "runtime" {
  name               = "matrx-mcp-runtime"
  path               = "/matrx/mcp-hosting/"
  description        = "Default no-permission workload identity for generated MCP services."
  assume_role_policy = data.aws_iam_policy_document.apprunner_runtime_assume.json
}

data "aws_iam_policy_document" "deployer" {
  statement {
    sid       = "AuthenticateToEcr"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "ManageMcpImageRepositories"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:CreateRepository",
      "ecr:DescribeImages",
      "ecr:DescribeRepositories",
      "ecr:GetDownloadUrlForLayer",
      "ecr:GetLifecyclePolicy",
      "ecr:InitiateLayerUpload",
      "ecr:ListImages",
      "ecr:ListTagsForResource",
      "ecr:PutImage",
      "ecr:PutImageScanningConfiguration",
      "ecr:PutImageTagMutability",
      "ecr:PutLifecyclePolicy",
      "ecr:TagResource",
      "ecr:UploadLayerPart",
    ]
    resources = ["arn:aws:ecr:${var.aws_region}:${var.aws_account_id}:repository/matrx-mcp/*"]
  }

  statement {
    sid = "CreateTaggedMcpServices"
    actions = [
      "apprunner:CreateService",
      "apprunner:TagResource",
    ]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "aws:RequestTag/System"
      values   = ["ai-matrx-mcp-hosting"]
    }
  }

  statement {
    sid = "OperateMcpServices"
    actions = [
      "apprunner:DescribeOperation",
      "apprunner:DescribeService",
      "apprunner:ListOperations",
      "apprunner:ListTagsForResource",
      "apprunner:PauseService",
      "apprunner:ResumeService",
      "apprunner:StartDeployment",
      "apprunner:UpdateService",
    ]
    resources = ["arn:aws:apprunner:${var.aws_region}:${var.aws_account_id}:service/matrx-mcp-*/*"]
  }

  statement {
    sid       = "ListMcpServices"
    actions   = ["apprunner:ListServices"]
    resources = ["*"]
  }

  statement {
    sid       = "PassOnlyMcpHostingRoles"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.apprunner_ecr_access.arn, aws_iam_role.runtime.arn]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["apprunner.amazonaws.com", "build.apprunner.amazonaws.com", "tasks.apprunner.amazonaws.com"]
    }
  }

  statement {
    sid = "ReadMcpApplicationLogs"
    actions = [
      "logs:DescribeLogGroups",
      "logs:DescribeLogStreams",
      "logs:FilterLogEvents",
      "logs:GetLogEvents",
      "logs:StartQuery",
      "logs:GetQueryResults",
      "logs:StopQuery",
    ]
    resources = [
      "arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/aws/apprunner/matrx-mcp-*:*",
    ]
  }
}

resource "aws_iam_policy" "deployer" {
  name        = "matrx-mcp-hosting-deployer"
  path        = "/matrx/mcp-hosting/"
  description = "Scoped agent deployment of generated Matrx MCP services to App Runner."
  policy      = data.aws_iam_policy_document.deployer.json
}

resource "aws_iam_role_policy_attachment" "operator_deployer" {
  role       = data.aws_iam_role.operator.name
  policy_arn = aws_iam_policy.deployer.arn
}
