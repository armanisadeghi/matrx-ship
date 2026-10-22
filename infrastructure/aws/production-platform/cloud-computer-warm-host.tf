# Cloud Computer shared warm host (FIX-SHARED-WARM, 2026-10-22).
#
# Report: common-docs/projects/cloud-computer/FIX-SHARED-WARM-2026-10-22.md.
#
# A flat-cost speed-up for a sleeping Cloud Computer: N (default 0 = off, $0)
# pre-booted EC2 hosts registered to the production cluster with the Cloud
# Computer image ALREADY PULLED. A person's wake runs their OWN task (own task
# role, own EFS access point, own ENI + security group, exactly as on Fargate)
# on a warm host, skipping Fargate's network-up -> pull-start gap and the image
# pull. Isolation never weakens:
#   * one task per host (the task asks for almost all of the host's memory, and
#     placement asks for distinctInstance), so a person's kernel is never shared
#     with another person — the same VM boundary Fargate gives;
#   * each host is SINGLE-USE: when the person's task ends, the host stops its
#     ECS agent (nothing new can land) and terminates itself, decrementing the
#     group, so nothing one person did as root survives to the next person;
#   * awsvpc tasks are blocked from the instance metadata service
#     (ECS_AWSVPC_BLOCK_IMDS), so a task never sees the host role.
# Refill-on-use: the control plane raises the group's desired count by one when
# it places a task on a warm host; the self-retiring host lowers it by one. So
# desired = machines on warm hosts + the spare count, and the spare count is
# the only flat cost.
#
# Cost knob: `cloud_computer_warm_hosts` (the idle spare count) — 0 means no
# instance exists. The control plane only uses a host when the feature knob
# cloud_computer.lifecycle.warm_host_enabled is on; with no free host it falls
# back to Fargate, so overflow is never refused.

variable "cloud_computer_warm_hosts" {
  description = "Idle pre-booted Cloud Computer hosts kept ready (flat cost each). 0 = off."
  type        = number
  default     = 0
}

variable "cloud_computer_warm_host_type" {
  description = "Instance type of a warm host: 4 vCPU / 16 GiB, the standard machine size."
  type        = string
  default     = "m6a.xlarge"
}

locals {
  cloud_computer_warm_pool = "cloud-computer-warm"
  cloud_computer_warm_asg  = "${local.name_prefix}-cloud-computer-warm"
}

data "aws_ssm_parameter" "ecs_al2023_ami" {
  name = "/aws/service/ecs/optimized-ami/amazon-linux-2023/recommended/image_id"
}

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "cloud_computer_warm_host" {
  name               = "matrx-production-cloud-computer-warm-host"
  path               = "/matrx/platform/"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

resource "aws_iam_role_policy_attachment" "cloud_computer_warm_host_ecs" {
  role       = aws_iam_role.cloud_computer_warm_host.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role"
}

data "aws_iam_policy_document" "cloud_computer_warm_host_retire" {
  statement {
    sid       = "RetireSelfAfterOneMachine"
    actions   = ["autoscaling:TerminateInstanceInAutoScalingGroup"]
    resources = ["arn:aws:autoscaling:${var.aws_region}:${var.aws_account_id}:autoScalingGroup:*:autoScalingGroupName/${local.cloud_computer_warm_asg}"]
  }
}

resource "aws_iam_role_policy" "cloud_computer_warm_host_retire" {
  name   = "retire-self"
  role   = aws_iam_role.cloud_computer_warm_host.id
  policy = data.aws_iam_policy_document.cloud_computer_warm_host_retire.json
}

resource "aws_iam_instance_profile" "cloud_computer_warm_host" {
  name = "matrx-production-cloud-computer-warm-host"
  path = "/matrx/platform/"
  role = aws_iam_role.cloud_computer_warm_host.name
}

# The host itself takes no inbound traffic; each person's task has its own ENI
# with the cloud_computer security group.
resource "aws_security_group" "cloud_computer_warm_host" {
  name        = "${local.name_prefix}-cloud-computer-warm-host"
  description = "Cloud Computer warm hosts: no inbound; ECS, ECR and the image pull outbound."
  vpc_id      = aws_vpc.production.id

  egress {
    description = "ECS agent, ECR pull, AWS APIs"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-cloud-computer-warm-host" }
}

locals {
  cloud_computer_warm_user_data = <<-EOT
    #!/bin/bash
    set -uo pipefail
    cat >> /etc/ecs/ecs.config <<'CFG'
    ECS_CLUSTER=${aws_ecs_cluster.production.name}
    ECS_AWSVPC_BLOCK_IMDS=true
    ECS_ENABLE_TASK_IAM_ROLE=true
    ECS_IMAGE_PULL_BEHAVIOR=prefer-cached
    ECS_DISABLE_IMAGE_CLEANUP=true
    ECS_INSTANCE_ATTRIBUTES={"matrx.pool":"${local.cloud_computer_warm_pool}"}
    CFG
    # Pull the image BEFORE the ECS agent registers (ecs.service runs after
    # cloud-final), so a registered host is always a warm one.
    systemctl start docker
    REG=${var.aws_account_id}.dkr.ecr.${var.aws_region}.amazonaws.com
    aws ecr get-login-password --region ${var.aws_region} | docker login --username AWS --password-stdin "$REG"
    docker pull "${aws_ecr_repository.cloud_computer.repository_url}:${var.cloud_computer_image_tag}" || true
    # Single use: once a person's machine has run here and ended, stop the agent
    # (nothing new lands) and terminate this host, lowering the group by one.
    cat > /usr/local/bin/cloud-computer-retire <<'SH'
    #!/bin/bash
    seen=0
    while sleep 5; do
      n=$(docker ps -q --filter label=com.amazonaws.ecs.container-name=cloud-computer | wc -l)
      if [ "$n" -gt 0 ]; then seen=1; elif [ "$seen" = 1 ]; then
        systemctl stop ecs
        TOKEN=$(curl -s -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')
        ID=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)
        aws autoscaling terminate-instance-in-auto-scaling-group --region ${var.aws_region} \
          --instance-id "$ID" --should-decrement-desired-capacity && exit 0
      fi
    done
    SH
    chmod +x /usr/local/bin/cloud-computer-retire
    cat > /etc/systemd/system/cloud-computer-retire.service <<'UNIT'
    [Unit]
    Description=Retire this single-use Cloud Computer host after its machine ends
    After=docker.service
    [Service]
    ExecStart=/usr/local/bin/cloud-computer-retire
    Restart=always
    [Install]
    WantedBy=multi-user.target
    UNIT
    systemctl daemon-reload
    systemctl enable --now cloud-computer-retire.service
  EOT
}

resource "aws_launch_template" "cloud_computer_warm_host" {
  name          = "${local.name_prefix}-cloud-computer-warm-host"
  image_id      = data.aws_ssm_parameter.ecs_al2023_ami.value
  instance_type = var.cloud_computer_warm_host_type
  user_data     = base64encode(local.cloud_computer_warm_user_data)

  iam_instance_profile { arn = aws_iam_instance_profile.cloud_computer_warm_host.arn }

  vpc_security_group_ids = [aws_security_group.cloud_computer_warm_host.id]

  # The person's writable root + scratch (Fargate gives 100 GiB) + the image.
  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      volume_size           = 130
      volume_type           = "gp3"
      encrypted             = true
      delete_on_termination = true
    }
  }

  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  tag_specifications {
    resource_type = "instance"
    tags          = { Name = local.cloud_computer_warm_asg, "matrx.pool" = local.cloud_computer_warm_pool }
  }
}

resource "aws_autoscaling_group" "cloud_computer_warm" {
  name                = local.cloud_computer_warm_asg
  min_size            = 0
  max_size            = 20
  desired_capacity    = var.cloud_computer_warm_hosts
  vpc_zone_identifier = values(aws_subnet.private)[*].id

  launch_template {
    id      = aws_launch_template.cloud_computer_warm_host.id
    version = aws_launch_template.cloud_computer_warm_host.latest_version
  }

  tag {
    key                 = "managed-by"
    value               = "matrx-cloud-computer"
    propagate_at_launch = true
  }
}

# Control plane: refill on use (raise desired by one per claimed host).
data "aws_iam_policy_document" "cloud_computer_warm_refill" {
  statement {
    sid       = "ReadWarmGroup"
    actions   = ["autoscaling:DescribeAutoScalingGroups"]
    resources = ["*"]
  }
  statement {
    sid       = "RefillWarmGroup"
    actions   = ["autoscaling:SetDesiredCapacity"]
    resources = [aws_autoscaling_group.cloud_computer_warm.arn]
  }
}

resource "aws_iam_role_policy" "cloud_computer_warm_refill" {
  for_each = toset(["aidream", "workflow-worker"])
  name     = "cloud-computer-warm-refill"
  role     = aws_iam_role.task[each.key].id
  policy   = data.aws_iam_policy_document.cloud_computer_warm_refill.json
}
