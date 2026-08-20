variable "aws_account_id" {
  description = "AWS account that hosts Matrx-generated MCP services."
  type        = string
  default     = "872515272894"
}

variable "aws_region" {
  description = "AWS region for generated MCP services."
  type        = string
  default     = "us-east-1"
}

variable "operator_role_name" {
  description = "Existing audited operator role used by coding agents."
  type        = string
  default     = "matrx-production-operator"
}
