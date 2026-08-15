terraform {
  required_version = ">= 1.15.0"

  backend "s3" {
    bucket       = "matrx-terraform-state-872515272894"
    key          = "aws/communications-recording/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"

  default_tags {
    tags = {
      Environment = "production"
      ManagedBy   = "terraform"
      Owner       = "communications-platform"
      System      = "voice-recording"
    }
  }
}
