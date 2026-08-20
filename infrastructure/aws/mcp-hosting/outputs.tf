output "apprunner_ecr_access_role_arn" {
  value = aws_iam_role.apprunner_ecr_access.arn
}

output "runtime_role_arn" {
  value = aws_iam_role.runtime.arn
}

output "deployer_policy_arn" {
  value = aws_iam_policy.deployer.arn
}
