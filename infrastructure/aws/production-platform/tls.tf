resource "aws_acm_certificate" "public_services" {
  domain_name       = "*.app.matrxserver.com"
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}
