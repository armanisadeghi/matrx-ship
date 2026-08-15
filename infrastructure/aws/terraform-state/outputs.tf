output "bucket_arn" {
  description = "ARN of the encrypted, versioned Terraform state bucket."
  value       = aws_s3_bucket.terraform_state.arn
}

output "backend_key" {
  description = "Remote-state key for this bootstrap root after state migration."
  value       = "aws/terraform-state/terraform.tfstate"
}
