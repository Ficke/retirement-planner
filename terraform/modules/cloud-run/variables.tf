# Variables for Cloud Run module

variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
}

variable "service_name" {
  description = "Name of the Cloud Run service"
  type        = string
}

variable "image" {
  description = "Docker image to deploy"
  type        = string
}

variable "env_vars" {
  description = "Environment variables"
  type        = map(string)
  default     = {}
}

variable "secret_env_vars" {
  description = "Secret environment variables from Secret Manager"
  type = map(object({
    secret_name = string
    version     = string
  }))
  default = {}
}

variable "memory_limit" {
  description = "Memory limit"
  type        = string
  default     = "512Mi"
}

variable "cpu_limit" {
  description = "CPU limit"
  type        = string
  default     = "1"
}

variable "min_instances" {
  description = "Minimum instances"
  type        = number
  default     = 0
}

variable "max_instances" {
  description = "Maximum instances"
  type        = number
  default     = 10
}

variable "timeout_seconds" {
  description = "Request timeout in seconds"
  type        = number
  default     = 300
}

variable "allow_unauthenticated" {
  description = "Allow public access"
  type        = bool
  default     = true
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "production"
}

variable "ingress_settings" {
  description = "Ingress traffic settings (INGRESS_TRAFFIC_ALL or INGRESS_TRAFFIC_INTERNAL_ONLY)"
  type        = string
  default     = "INGRESS_TRAFFIC_ALL"
}

variable "container_port" {
  description = "Container port to expose"
  type        = number
  default     = 3000
}

variable "startup_cpu_boost" {
  description = "Allocate extra CPU during container startup to reduce cold-start latency. Billed only during boot."
  type        = bool
  default     = true
}

variable "container_concurrency" {
  description = "Max concurrent requests per container instance. Set to 1 for CPU-bound workloads that need full parallelism per request."
  type        = number
  default     = 80
}

variable "liveness_probe_path" {
  description = "HTTP path for the liveness probe. Set to null to disable."
  type        = string
  default     = "/healthz"
}

variable "startup_probe_path" {
  description = "HTTP path for the startup probe. Set to null to use a TCP probe on container_port instead."
  type        = string
  default     = "/healthz"
}
