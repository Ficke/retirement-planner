# Variables for Secret Manager module

variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "secrets" {
  description = "Map of secrets to create"
  type = map(object({
    description = string
  }))
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "production"
}
