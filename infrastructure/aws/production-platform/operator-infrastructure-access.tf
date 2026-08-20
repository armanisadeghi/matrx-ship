data "aws_iam_policy_document" "operator_infrastructure_access" {
  statement {
    sid = "ReadTerraformManagedResourceDetails"
    actions = [
      "acm:DescribeCertificate",
      "acm:ListTagsForCertificate",
      "application-autoscaling:ListTagsForResource",
      "cloudtrail:DescribeTrails",
      "cloudtrail:ListTags",
      "elasticfilesystem:Describe*",
      "iam:GetPolicy",
      "iam:GetPolicyVersion",
      "iam:GetRolePolicy",
      "kms:DescribeKey",
      "kms:GetKeyPolicy",
      "kms:GetKeyRotationStatus",
      "kms:ListAliases",
      "kms:ListResourceTags",
      "logs:ListTagsForResource",
      "route53:Get*",
      "route53:List*",
      "secretsmanager:GetResourcePolicy",
    ]
    resources = ["*"]
  }

  statement {
    sid = "ReadDeclaredPlatformBuckets"
    actions = [
      "s3:Get*",
      "s3:List*",
    ]
    resources = [
      "arn:aws:s3:::matrx-*",
      "arn:aws:s3:::matrx-*/*",
    ]
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
    sid = "ManageBrowserCheckpointBucket"
    actions = [
      "s3:CreateBucket",
      "s3:DeleteBucket",
      "s3:DeleteBucketPolicy",
      "s3:GetBucketPolicy",
      "s3:GetBucketPublicAccessBlock",
      "s3:GetBucketTagging",
      "s3:GetBucketVersioning",
      "s3:GetEncryptionConfiguration",
      "s3:GetLifecycleConfiguration",
      "s3:GetOwnershipControls",
      "s3:PutBucketPolicy",
      "s3:PutBucketPublicAccessBlock",
      "s3:PutBucketTagging",
      "s3:PutBucketVersioning",
      "s3:PutEncryptionConfiguration",
      "s3:PutLifecycleConfiguration",
      "s3:PutOwnershipControls",
    ]
    resources = ["arn:aws:s3:::matrx-browser-checkpoints-${var.aws_account_id}"]
  }

  statement {
    sid = "ManageDeclaredPlatformMonitoring"
    actions = [
      "cloudwatch:DeleteAlarms",
      "cloudwatch:DeleteDashboards",
      "cloudwatch:PutDashboard",
      "cloudwatch:PutMetricAlarm",
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
    sid = "ManageBrowserProfileMountPolicy"
    actions = [
      "iam:DeleteRolePolicy",
      "iam:GetRolePolicy",
      "iam:PutRolePolicy",
    ]
    resources = [aws_iam_role.browser_worker_task.arn]
  }

  statement {
    sid = "ManageDedicatedBrowserWorkerRole"
    actions = [
      "iam:AttachRolePolicy",
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:DetachRolePolicy",
      "iam:GetRole",
      "iam:ListAttachedRolePolicies",
      "iam:ListRolePolicies",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:UpdateAssumeRolePolicy",
    ]
    resources = ["arn:aws:iam::${var.aws_account_id}:role/matrx/platform/matrx-production-browser-worker-task"]
  }

  statement {
    sid = "ManageAidreamGithubDeployPolicy"
    actions = [
      "iam:DeleteRolePolicy",
      "iam:GetRolePolicy",
      "iam:PutRolePolicy",
    ]
    resources = ["arn:aws:iam::${var.aws_account_id}:role/matrx-aidream-gha-deploy"]
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
    sid = "ManageDeclaredInternalAidreamPath"
    actions = [
      "ec2:AuthorizeSecurityGroupEgress",
      "ec2:AuthorizeSecurityGroupIngress",
      "ec2:CreateSecurityGroup",
      "ec2:CreateTags",
      "ec2:DeleteSecurityGroup",
      "ec2:RevokeSecurityGroupEgress",
      "ec2:RevokeSecurityGroupIngress",
      "elasticloadbalancing:AddTags",
      "elasticloadbalancing:CreateListener",
      "elasticloadbalancing:CreateLoadBalancer",
      "elasticloadbalancing:CreateTargetGroup",
      "elasticloadbalancing:DeleteListener",
      "elasticloadbalancing:DeleteLoadBalancer",
      "elasticloadbalancing:DeleteTargetGroup",
      "elasticloadbalancing:ModifyListener",
      "elasticloadbalancing:ModifyLoadBalancerAttributes",
      "elasticloadbalancing:ModifyTargetGroup",
      "elasticloadbalancing:ModifyTargetGroupAttributes",
      "elasticloadbalancing:RemoveTags",
      "elasticloadbalancing:SetSecurityGroups",
      "elasticloadbalancing:SetSubnets",
      "route53:AssociateVPCWithHostedZone",
      "route53:ChangeResourceRecordSets",
      "route53:ChangeTagsForResource",
      "route53:CreateHostedZone",
      "route53:DeleteHostedZone",
      "route53:DisassociateVPCFromHostedZone",
    ]
    resources = ["*"]
  }

  statement {
    sid = "ManageOperatorPolicyVersions"
    actions = [
      "iam:CreatePolicyVersion",
      "iam:DeletePolicyVersion",
      "iam:GetPolicy",
      "iam:GetPolicyVersion",
      "iam:ListPolicyVersions",
      "iam:SetDefaultPolicyVersion",
      "iam:TagPolicy",
      "iam:UntagPolicy",
    ]
    resources = [
      "arn:aws:iam::${var.aws_account_id}:policy/matrx/platform/matrx-production-operator",
      "arn:aws:iam::${var.aws_account_id}:policy/matrx/platform/matrx-production-operator-infrastructure",
    ]
  }

  statement {
    sid       = "RunAuditedCommandsOnMatrxHosts"
    actions   = ["ssm:SendCommand"]
    resources = ["arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:instance/*"]

    condition {
      test     = "StringLike"
      variable = "ssm:resourceTag/Name"
      values   = ["matrx-*"]
    }
  }

  statement {
    sid       = "UseApprovedShellDocument"
    actions   = ["ssm:SendCommand"]
    resources = ["arn:aws:ssm:${var.aws_region}::document/AWS-RunShellScript"]
  }
}

resource "aws_iam_policy" "operator_infrastructure_access" {
  name        = "matrx-production-operator-infrastructure"
  path        = "/matrx/platform/"
  description = "Terraform resource inspection and the declared private AI Dream path."
  policy      = data.aws_iam_policy_document.operator_infrastructure_access.json
}

resource "aws_iam_role_policy_attachment" "operator_infrastructure_access" {
  role       = aws_iam_role.operator.name
  policy_arn = aws_iam_policy.operator_infrastructure_access.arn
}
