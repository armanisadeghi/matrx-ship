locals {
  cloudflare_ipv4_cidrs = toset([
    "173.245.48.0/20",
    "103.21.244.0/22",
    "103.22.200.0/22",
    "103.31.4.0/22",
    "141.101.64.0/18",
    "108.162.192.0/18",
    "190.93.240.0/20",
    "188.114.96.0/20",
    "197.234.240.0/22",
    "198.41.128.0/17",
    "162.158.0.0/15",
    "104.16.0.0/13",
    "104.24.0.0/14",
    "172.64.0.0/13",
    "131.0.72.0/22",
  ])
}

# Files and SEO terminate TLS in the shared Caddy container on the legacy EC2
# sandbox host. Port 80 exists only for ACME HTTP-01 through Cloudflare; the
# application ports remain bound to loopback and are never public.
resource "aws_vpc_security_group_ingress_rule" "files_seo_acme_from_cloudflare" {
  for_each = local.cloudflare_ipv4_cidrs

  security_group_id = "sg-05a1b5a6163cd8ee6"
  description       = "Cloudflare to Files SEO ACME HTTP-01"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = each.value
}
