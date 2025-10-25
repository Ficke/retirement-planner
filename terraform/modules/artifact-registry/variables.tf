# Variables for Artifact Registry module

variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
}

variable "repository_id" {
  description = "Repository ID for Artifact Registry"
  type        = string
}
