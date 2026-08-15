output "recording_bucket_arn" {
  description = "ARN of the private recording-ingress bucket."
  value       = aws_s3_bucket.recordings.arn
}

output "recording_prefix_arn" {
  description = "Only object prefix to which the Twilio writer may write."
  value       = "${aws_s3_bucket.recordings.arn}/${local.recording_prefix}*"
}

output "external_storage_url" {
  description = "Exact external-storage URL for the later manual Twilio configuration."
  value       = "https://${aws_s3_bucket.recordings.id}.s3.${local.region}.amazonaws.com/${trimsuffix(local.recording_prefix, "/")}"
}

output "twilio_writer_user_arn" {
  description = "Non-secret IAM user identifier. No access key is managed by Terraform."
  value       = aws_iam_user.twilio_writer.arn
}

output "twilio_writer_policy_arn" {
  description = "Direct least-privilege writer policy."
  value       = aws_iam_policy.twilio_writer.arn
}

output "twilio_writer_boundary_arn" {
  description = "Permissions boundary containing the same maximum writer policy."
  value       = aws_iam_policy.twilio_writer_boundary.arn
}

output "cloudtrail_arn" {
  description = "Trail that records S3 object data events for the owner-beta prefix."
  value       = aws_cloudtrail.recording_data_events.arn
}

output "cloudtrail_log_bucket_arn" {
  description = "Private destination for recording data-event audit logs."
  value       = aws_s3_bucket.cloudtrail_logs.arn
}
