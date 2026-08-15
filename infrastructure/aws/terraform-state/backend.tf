terraform {
  backend "s3" {
    bucket       = "matrx-terraform-state-872515272894"
    key          = "aws/terraform-state/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}
