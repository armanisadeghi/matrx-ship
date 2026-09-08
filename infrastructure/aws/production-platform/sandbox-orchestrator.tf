# Sandbox containers stay on the existing host. This record gives ECS a
# stable private tool-transport endpoint across the already-peered VPCs.
data "aws_instance" "sandbox_orchestrator" {
  instance_id = "i-084f757c1e47d4efb"
}

resource "aws_route53_record" "sandbox_orchestrator_internal" {
  zone_id = aws_route53_zone.internal_services.zone_id
  name    = "sandbox-orchestrator.${aws_route53_zone.internal_services.name}"
  type    = "A"
  ttl     = 60
  records = [data.aws_instance.sandbox_orchestrator.private_ip]
}

# Keep this private permission when the historical world-open port 8000 rule
# is removed after Manager, Vercel and outside-AWS clients adopt HTTPS.
resource "aws_vpc_security_group_ingress_rule" "sandbox_orchestrator_from_ecs" {
  security_group_id = "sg-05a1b5a6163cd8ee6"
  description       = "Private sandbox tool transport from ECS production VPC"
  ip_protocol       = "tcp"
  from_port         = 8000
  to_port           = 8000
  cidr_ipv4         = aws_vpc.production.cidr_block
}
