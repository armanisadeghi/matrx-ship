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
  default     = "6f0a8071843d3c2ab33aafa7a8339ec46aadba55"

  validation {
    condition     = can(regex("^[0-9a-f]{40}$", var.browser_worker_image_tag))
    error_message = "Cloud Browser worker images must be deployed by a full 40-character Git SHA."
  }
}

variable "livekit_worker_image_tag" {
  description = "Immutable AI Dream Git SHA for the canonical LiveKit room worker. The worker is the same image as the API; the aidream release script advances the live revision."
  type        = string
  default     = "1c620f79a63087f974cee040f53a3ed47e6562ef"

  validation {
    condition     = can(regex("^[0-9a-f]{40}$", var.livekit_worker_image_tag))
    error_message = "LiveKit worker images must be deployed by a full 40-character Git SHA."
  }
}

variable "livekit_worker_scaling" {
  description = "Operator-adjustable LiveKit capacity policy. Initial values follow the 2026-09-12 four-room measurement; review against real demand by 2026-10-12. Enable scale-in only after the fresh-image handoff canary passes."
  type = object({
    min_tasks          = number
    max_tasks          = number
    cpu_target         = number
    memory_target      = number
    scale_in_cooldown  = number
    scale_out_cooldown = number
    scale_in_enabled   = bool
  })
  default = {
    min_tasks          = 2
    max_tasks          = 4
    cpu_target         = 55
    memory_target      = 70
    scale_in_cooldown  = 600
    scale_out_cooldown = 60
    scale_in_enabled   = false
  }
  validation {
    condition = (
      var.livekit_worker_scaling.min_tasks >= 2 &&
      floor(var.livekit_worker_scaling.min_tasks) == var.livekit_worker_scaling.min_tasks &&
      var.livekit_worker_scaling.max_tasks >= var.livekit_worker_scaling.min_tasks &&
      floor(var.livekit_worker_scaling.max_tasks) == var.livekit_worker_scaling.max_tasks &&
      var.livekit_worker_scaling.cpu_target > 0 && var.livekit_worker_scaling.cpu_target < 100 &&
      var.livekit_worker_scaling.memory_target > 0 && var.livekit_worker_scaling.memory_target < 100 &&
      var.livekit_worker_scaling.scale_in_cooldown >= 60 &&
      var.livekit_worker_scaling.scale_out_cooldown >= 0
    )
    error_message = "Keep at least two workers, integral ordered capacity bounds, utilization targets between 0 and 100, and nonnegative cooldowns (scale-in at least 60 seconds)."
  }
}
