variable "aws_account_id" {
  description = "AWS account that owns the Matrx production platform."
  type        = string
  default     = "872515272894"
}

variable "aws_region" {
  description = "Single production region for latency-sensitive Matrx services."
  type        = string
  default     = "us-east-1"
}

variable "availability_zones" {
  description = "Two independent availability zones used by the production platform."
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]

  validation {
    condition     = length(var.availability_zones) == 2
    error_message = "The production platform requires exactly two availability zones."
  }
}

variable "vpc_cidr" {
  description = "Non-overlapping CIDR for the Matrx production VPC."
  type        = string
  default     = "10.42.0.0/16"
}

variable "legacy_vpc_id" {
  description = "Existing default VPC containing the EC2 sandbox fleet."
  type        = string
  default     = "vpc-0eaa27b30d9064ff1"
}

variable "static_web_image_tag" {
  description = "Immutable aidream Git SHA shared by the admin dashboard and workflow studio images."
  type        = string
  default     = "33a7786230cda7643d50b8c8632974a22dda8bb7"

  validation {
    condition     = can(regex("^[0-9a-f]{40}$", var.static_web_image_tag))
    error_message = "Static web images must be deployed by a full 40-character Git SHA."
  }
}

variable "aidream_image_tag" {
  description = "Immutable Git SHA for the AI Dream preview image."
  type        = string
  default     = "79176f55f5d3379ac5a3023530298ade8adb9b7c"

  validation {
    condition     = can(regex("^[0-9a-f]{40}$", var.aidream_image_tag))
    error_message = "AI Dream images must be deployed by a full 40-character Git SHA."
  }
}

variable "workflow_worker_image_tag" {
  description = "Immutable Git SHA for the dormant workflow worker task definition."
  type        = string
  default     = "79176f55f5d3379ac5a3023530298ade8adb9b7c"

  validation {
    condition     = can(regex("^[0-9a-f]{40}$", var.workflow_worker_image_tag))
    error_message = "Workflow worker images must be deployed by a full 40-character Git SHA."
  }
}

variable "browser_worker_image_tag" {
  description = "Immutable AI Dream Git SHA for the persistent Cloud Browser worker image."
  type        = string
  default     = "0d0654db0dcaff136d3555289bfd538f07cd4fe5"

  validation {
    condition     = can(regex("^[0-9a-f]{40}$", var.browser_worker_image_tag))
    error_message = "Cloud Browser worker images must be deployed by a full 40-character Git SHA."
  }
}
