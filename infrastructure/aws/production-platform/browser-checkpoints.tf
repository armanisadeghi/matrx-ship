resource "aws_kms_key" "browser_profiles" {
  description             = "Wrap persistent browser profile checkpoint keys."
  enable_key_rotation     = true
  deletion_window_in_days = 30

  lifecycle { prevent_destroy = true }

  tags = { Name = "${local.name_prefix}-browser-profiles" }
}

resource "aws_kms_alias" "browser_profiles" {
  name          = "alias/matrx-browser-profiles"
  target_key_id = aws_kms_key.browser_profiles.key_id
}

resource "aws_s3_bucket" "browser_checkpoints" {
  bucket = "matrx-browser-checkpoints-${var.aws_account_id}"

  lifecycle { prevent_destroy = true }
}

resource "aws_s3_bucket_public_access_block" "browser_checkpoints" {
  bucket                  = aws_s3_bucket.browser_checkpoints.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "browser_checkpoints" {
  bucket = aws_s3_bucket.browser_checkpoints.id

  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_versioning" "browser_checkpoints" {
  bucket = aws_s3_bucket.browser_checkpoints.id

  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "browser_checkpoints" {
  bucket = aws_s3_bucket.browser_checkpoints.id

  rule {
    bucket_key_enabled = true

    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.browser_profiles.arn
      sse_algorithm     = "aws:kms"
    }
  }
}

data "aws_iam_policy_document" "browser_checkpoints" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.browser_checkpoints.arn,
      "${aws_s3_bucket.browser_checkpoints.arn}/*",
    ]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "browser_checkpoints" {
  bucket = aws_s3_bucket.browser_checkpoints.id
  policy = data.aws_iam_policy_document.browser_checkpoints.json

  depends_on = [aws_s3_bucket_public_access_block.browser_checkpoints]
}

# Lifecycle (2026-09-20). What a bucket rule CAN decide safely, and only that:
#   - an upload that never finished (a worker died mid-PUT) is garbage after 2 days;
#   - a non-current version exists only because something overwrote or deleted
#     the key — the retention sweep deletes every version explicitly, so what is
#     left non-current after 7 days is a leftover, not a checkpoint;
#   - a delete marker with no versions behind it is noise.
# What it deliberately does NOT do: expire current objects by age. D-20 keeps a
# rarely-used browser's newest verified checkpoint FOREVER, and only the
# database knows which object that is. Age-based current-object expiry lives in
# the "Prune old browser checkpoints" system task (DB-driven, cryptographic
# erasure, plus an orphan pass for objects no row names), never here.
resource "aws_s3_bucket_lifecycle_configuration" "browser_checkpoints" {
  bucket = aws_s3_bucket.browser_checkpoints.id

  depends_on = [aws_s3_bucket_versioning.browser_checkpoints]

  rule {
    id     = "abort-abandoned-multipart-uploads"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 2
    }
  }

  rule {
    id     = "expire-noncurrent-versions-and-empty-delete-markers"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 7
    }

    expiration {
      expired_object_delete_marker = true
    }
  }
}
