resource "aws_secretsmanager_secret" "supabase_east_migration" {
  name                    = "/matrx/migration/supabase-east"
  description             = "Temporary operator-only credentials for the Supabase West-to-East rehearsal and cutover. Values are populated outside Terraform."
  recovery_window_in_days = 30

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_kms_key" "supabase_migration_artifacts" {
  description             = "Encrypt protected Supabase region-migration artifacts."
  enable_key_rotation     = true
  deletion_window_in_days = 30

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_kms_alias" "supabase_migration_artifacts" {
  name          = "alias/matrx-supabase-migration-artifacts"
  target_key_id = aws_kms_key.supabase_migration_artifacts.key_id
}

resource "aws_s3_bucket" "supabase_migration_artifacts" {
  bucket = "matrx-supabase-migration-artifacts-${var.aws_account_id}"

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "supabase_migration_artifacts" {
  bucket                  = aws_s3_bucket.supabase_migration_artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "supabase_migration_artifacts" {
  bucket = aws_s3_bucket.supabase_migration_artifacts.id

  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_versioning" "supabase_migration_artifacts" {
  bucket = aws_s3_bucket.supabase_migration_artifacts.id

  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "supabase_migration_artifacts" {
  bucket = aws_s3_bucket.supabase_migration_artifacts.id

  rule {
    bucket_key_enabled = true

    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.supabase_migration_artifacts.arn
      sse_algorithm     = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "supabase_migration_artifacts" {
  bucket = aws_s3_bucket.supabase_migration_artifacts.id

  rule {
    id     = "expire-rehearsal-artifacts"
    status = "Enabled"

    filter {}

    expiration { days = 90 }

    noncurrent_version_expiration { noncurrent_days = 30 }
  }

  depends_on = [aws_s3_bucket_versioning.supabase_migration_artifacts]
}

data "aws_iam_policy_document" "supabase_migration_artifacts" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.supabase_migration_artifacts.arn, "${aws_s3_bucket.supabase_migration_artifacts.arn}/*"]

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

resource "aws_s3_bucket_policy" "supabase_migration_artifacts" {
  bucket = aws_s3_bucket.supabase_migration_artifacts.id
  policy = data.aws_iam_policy_document.supabase_migration_artifacts.json

  depends_on = [aws_s3_bucket_public_access_block.supabase_migration_artifacts]
}
