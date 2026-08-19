locals {
  name_prefix = "matrx-production"

  public_subnets = {
    a = {
      az   = var.availability_zones[0]
      cidr = "10.42.0.0/20"
    }
    b = {
      az   = var.availability_zones[1]
      cidr = "10.42.16.0/20"
    }
  }

  private_subnets = {
    a = {
      az   = var.availability_zones[0]
      cidr = "10.42.128.0/20"
    }
    b = {
      az   = var.availability_zones[1]
      cidr = "10.42.144.0/20"
    }
  }

  application_services = toset([
    "admin-dashboard",
    "workflow-studio",
    "aidream",
    "workflow-worker",
    "matrx-files",
    "matrx-seo",
  ])

  new_ecr_repositories = toset([
    "matrx/admin-dashboard",
    "matrx/workflow-studio",
    "matrx/matrx-files",
    "matrx/matrx-seo",
  ])

  static_web_services = {
    admin-dashboard = {
      image_repository = "matrx/admin-dashboard"
      host_header      = null
      priority         = null
    }
    workflow-studio = {
      image_repository = "matrx/workflow-studio"
      host_header      = "workflow-studio.preview.platform.matrx.internal"
      priority         = 100
    }
  }

  common_tags = {
    Environment = "production"
    ManagedBy   = "terraform"
    Owner       = "matrx-ship"
    System      = "ai-matrx-platform"
    Region      = "us-east-1"
  }
}

data "aws_caller_identity" "current" {}

data "aws_vpc" "legacy" {
  id = var.legacy_vpc_id
}

check "expected_account" {
  assert {
    condition     = data.aws_caller_identity.current.account_id == var.aws_account_id
    error_message = "Refusing to manage the Matrx production platform outside AWS account ${var.aws_account_id}."
  }
}

check "expected_region" {
  assert {
    condition     = var.aws_region == "us-east-1"
    error_message = "The production platform is intentionally pinned to us-east-1."
  }
}
