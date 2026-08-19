resource "aws_secretsmanager_secret" "supabase_east_migration" {
  name                    = "/matrx/migration/supabase-east"
  description             = "Temporary operator-only credentials for the Supabase West-to-East rehearsal and cutover. Values are populated outside Terraform."
  recovery_window_in_days = 30

  lifecycle {
    prevent_destroy = true
  }
}
