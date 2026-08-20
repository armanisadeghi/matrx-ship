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
