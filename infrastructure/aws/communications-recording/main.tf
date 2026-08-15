locals {
  account_id            = "872515272894"
  region                = "us-east-1"
  recording_bucket_name = "matrx-voice-recordings-prod-${local.account_id}"
  recording_prefix      = "twilio/us1/owner-beta/"
  writer_user_name      = "twilio-voice-recording-writer-prod"
  writer_policy_name    = "twilio-voice-recording-write-owner-beta"
  boundary_policy_name  = "twilio-voice-recording-write-owner-beta-boundary"
  cloudtrail_name       = "matrx-voice-recordings-prod"
  cloudtrail_bucket     = "matrx-cloudtrail-voice-recordings-prod-${local.account_id}"
}

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "recordings" {
  bucket = local.recording_bucket_name

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "recordings" {
  bucket = aws_s3_bucket.recordings.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "recordings" {
  bucket = aws_s3_bucket.recordings.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "recordings" {
  bucket = aws_s3_bucket.recordings.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "recordings" {
  bucket = aws_s3_bucket.recordings.id

  rule {
    id     = "expire-owner-beta-recordings"
    status = "Enabled"

    filter {
      prefix = local.recording_prefix
    }

    expiration {
      days = 30
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

resource "aws_iam_user" "twilio_writer" {
  name                 = local.writer_user_name
  path                 = "/service-integrations/twilio/"
  permissions_boundary = aws_iam_policy.twilio_writer_boundary.arn
  force_destroy        = false

  tags = {
    Access = "write-only-owner-beta-prefix"
    Vendor = "Twilio"
  }
}

data "aws_iam_policy_document" "twilio_writer" {
  statement {
    sid       = "ListInProgressRecordingMultipartUploads"
    effect    = "Allow"
    actions   = ["s3:ListBucketMultipartUploads"]
    resources = [aws_s3_bucket.recordings.arn]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["true"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:ResourceAccount"
      values   = [local.account_id]
    }
  }

  statement {
    sid    = "WriteRecordingObjects"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:AbortMultipartUpload",
      "s3:ListMultipartUploadParts",
    ]
    resources = ["${aws_s3_bucket.recordings.arn}/${local.recording_prefix}*"]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["true"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:ResourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_iam_policy" "twilio_writer" {
  name        = local.writer_policy_name
  description = "Allows Twilio Voice to write owner-beta recordings and recover multipart uploads; no read, list, or delete."
  policy      = data.aws_iam_policy_document.twilio_writer.json
}

resource "aws_iam_policy" "twilio_writer_boundary" {
  name        = local.boundary_policy_name
  description = "Maximum permissions for the Twilio Voice recording writer."
  policy      = data.aws_iam_policy_document.twilio_writer.json
}

resource "aws_iam_user_policy_attachment" "twilio_writer" {
  user       = aws_iam_user.twilio_writer.name
  policy_arn = aws_iam_policy.twilio_writer.arn
}

data "aws_iam_policy_document" "recordings_bucket" {
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.recordings.arn,
      "${aws_s3_bucket.recordings.arn}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  statement {
    sid    = "DenyTwilioWriterReadsAndDeletes"
    effect = "Deny"

    principals {
      type        = "AWS"
      identifiers = [aws_iam_user.twilio_writer.arn]
    }

    actions = [
      "s3:DeleteObject",
      "s3:DeleteObjectTagging",
      "s3:DeleteObjectVersion",
      "s3:DeleteObjectVersionTagging",
      "s3:GetObject",
      "s3:GetObjectAcl",
      "s3:GetObjectAttributes",
      "s3:GetObjectTagging",
      "s3:GetObjectVersion",
      "s3:GetObjectVersionAcl",
      "s3:GetObjectVersionTagging",
      "s3:PutObjectAcl",
      "s3:PutObjectTagging",
      "s3:RestoreObject",
    ]
    resources = ["${aws_s3_bucket.recordings.arn}/*"]
  }

  statement {
    sid    = "DenyTwilioWriterBucketBrowseAndAdministration"
    effect = "Deny"

    principals {
      type        = "AWS"
      identifiers = [aws_iam_user.twilio_writer.arn]
    }

    actions = [
      "s3:DeleteBucket",
      "s3:DeleteBucketPolicy",
      "s3:GetBucketAcl",
      "s3:GetBucketLocation",
      "s3:GetBucketPolicy",
      "s3:GetBucketTagging",
      "s3:GetBucketVersioning",
      "s3:ListBucket",
      "s3:ListBucketVersions",
      "s3:PutBucketAcl",
      "s3:PutBucketPolicy",
      "s3:PutBucketTagging",
      "s3:PutBucketVersioning",
    ]
    resources = [aws_s3_bucket.recordings.arn]
  }

  statement {
    sid    = "DenyTwilioWriterOutsideOwnerBetaPrefix"
    effect = "Deny"

    principals {
      type        = "AWS"
      identifiers = [aws_iam_user.twilio_writer.arn]
    }

    actions = [
      "s3:AbortMultipartUpload",
      "s3:ListMultipartUploadParts",
      "s3:PutObject",
    ]
    not_resources = ["${aws_s3_bucket.recordings.arn}/${local.recording_prefix}*"]
  }
}

resource "aws_s3_bucket_policy" "recordings" {
  bucket = aws_s3_bucket.recordings.id
  policy = data.aws_iam_policy_document.recordings_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.recordings]
}

resource "aws_s3_bucket" "cloudtrail_logs" {
  bucket = local.cloudtrail_bucket

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "cloudtrail_logs" {
  bucket = aws_s3_bucket.cloudtrail_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "cloudtrail_logs" {
  bucket = aws_s3_bucket.cloudtrail_logs.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "cloudtrail_logs" {
  bucket = aws_s3_bucket.cloudtrail_logs.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "cloudtrail_logs" {
  bucket = aws_s3_bucket.cloudtrail_logs.id

  rule {
    id     = "expire-recording-audit-logs"
    status = "Enabled"

    filter {}

    expiration {
      days = 365
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

data "aws_iam_policy_document" "cloudtrail_logs" {
  statement {
    sid       = "AWSCloudTrailAclCheck"
    effect    = "Allow"
    actions   = ["s3:GetBucketAcl"]
    resources = [aws_s3_bucket.cloudtrail_logs.arn]

    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = ["arn:aws:cloudtrail:${local.region}:${local.account_id}:trail/${local.cloudtrail_name}"]
    }
  }

  statement {
    sid     = "AWSCloudTrailWrite"
    effect  = "Allow"
    actions = ["s3:PutObject"]
    resources = [
      "${aws_s3_bucket.cloudtrail_logs.arn}/AWSLogs/${local.account_id}/*",
    ]

    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = ["arn:aws:cloudtrail:${local.region}:${local.account_id}:trail/${local.cloudtrail_name}"]
    }
  }

  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.cloudtrail_logs.arn,
      "${aws_s3_bucket.cloudtrail_logs.arn}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "cloudtrail_logs" {
  bucket = aws_s3_bucket.cloudtrail_logs.id
  policy = data.aws_iam_policy_document.cloudtrail_logs.json

  depends_on = [aws_s3_bucket_public_access_block.cloudtrail_logs]
}

resource "aws_cloudtrail" "recording_data_events" {
  name                          = local.cloudtrail_name
  s3_bucket_name                = aws_s3_bucket.cloudtrail_logs.id
  include_global_service_events = false
  is_multi_region_trail         = false
  enable_log_file_validation    = true
  enable_logging                = true

  event_selector {
    include_management_events = false
    read_write_type           = "All"

    data_resource {
      type   = "AWS::S3::Object"
      values = ["${aws_s3_bucket.recordings.arn}/${local.recording_prefix}"]
    }
  }

  depends_on = [aws_s3_bucket_policy.cloudtrail_logs]
}

check "expected_account" {
  assert {
    condition     = data.aws_caller_identity.current.account_id == local.account_id
    error_message = "Refusing to manage recording infrastructure outside AWS account 872515272894."
  }
}

check "dedicated_owner_beta_prefix" {
  assert {
    condition     = local.recording_prefix == "twilio/us1/owner-beta/"
    error_message = "The owner beta writer must remain restricted to twilio/us1/owner-beta/."
  }
}
