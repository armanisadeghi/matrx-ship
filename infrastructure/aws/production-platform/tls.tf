resource "aws_acm_certificate" "public_services" {
  domain_name       = "*.app.matrxserver.com"
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate" "aimatrx_services" {
  domain_name = "stream.aimatrx.com"
  subject_alternative_names = [
    "admin.aimatrx.com",
    "workflows.aimatrx.com",
  ]
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_lb_listener_certificate" "aimatrx_services" {
  listener_arn    = aws_lb_listener.public_https.arn
  certificate_arn = aws_acm_certificate.aimatrx_services.arn
}
