# Terraform variables for RetirePlan deployment

variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for resources"
  type        = string
  default     = "us-central1"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "production"
}

variable "service_name" {
  description = "Name of the Cloud Run service"
  type        = string
  default     = "retire-plan"
}

variable "cloud_run_image" {
  description = "Docker image for Cloud Run (format: region-docker.pkg.dev/project/repo/image:tag)"
  type        = string
}

variable "artifact_registry_repository_id" {
  description = "Artifact Registry repository ID"
  type        = string
  default     = "retire-plan"
}

# Secrets configuration
variable "secrets" {
  description = "Map of secrets to create in Secret Manager"
  type = map(object({
    description = string
    # Data is NOT stored in Terraform - must be set manually after creation
  }))
  default = {
    DATABASE_URL = {
      description = "Neon PostgreSQL connection string"
    }
    FIREBASE_PRIVATE_KEY = {
      description = "Firebase Admin SDK private key"
    }
    GEMINI_API_KEY = {
      description = "Google Gemini API key for OCR functionality"
    }
    POLYGON_API_KEY = {
      description = "Polygon.io API key for market data"
    }
    LANGFUSE_PUBLIC_KEY = {
      description = "Langfuse public key for observability"
    }
    LANGFUSE_SECRET_KEY = {
      description = "Langfuse secret key for observability"
    }
  }
}

# Public environment variables (non-sensitive)
variable "public_env_vars" {
  description = "Public environment variables for Cloud Run"
  type        = map(string)
  default     = {}
  # Set these in terraform.tfvars:
  # NEXT_PUBLIC_FIREBASE_API_KEY
  # NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
  # NEXT_PUBLIC_FIREBASE_PROJECT_ID
  # FIREBASE_PROJECT_ID
  # FIREBASE_CLIENT_EMAIL
  # LANGFUSE_HOST
  # POLYGON_RATE_LIMIT_PER_MINUTE
}

# Secret environment variables (references to Secret Manager)
variable "secret_env_vars" {
  description = "Environment variables that reference secrets"
  type = map(object({
    secret_name = string
    version     = string
  }))
  default = {
    DATABASE_URL = {
      secret_name = "DATABASE_URL"
      version     = "latest"
    }
    FIREBASE_PRIVATE_KEY = {
      secret_name = "FIREBASE_PRIVATE_KEY"
      version     = "latest"
    }
    GEMINI_API_KEY = {
      secret_name = "GEMINI_API_KEY"
      version     = "latest"
    }
    POLYGON_API_KEY = {
      secret_name = "POLYGON_API_KEY"
      version     = "latest"
    }
    LANGFUSE_PUBLIC_KEY = {
      secret_name = "LANGFUSE_PUBLIC_KEY"
      version     = "latest"
    }
    LANGFUSE_SECRET_KEY = {
      secret_name = "LANGFUSE_SECRET_KEY"
      version     = "latest"
    }
  }
}

# Cloud Run configuration
variable "memory_limit" {
  description = "Memory limit for Cloud Run instance"
  type        = string
  default     = "512Mi"
}

variable "cpu_limit" {
  description = "CPU limit for Cloud Run instance"
  type        = string
  default     = "1"
}

variable "min_instances" {
  description = "Minimum number of Cloud Run instances"
  type        = number
  default     = 0
}

variable "max_instances" {
  description = "Maximum number of Cloud Run instances"
  type        = number
  default     = 10
}

variable "timeout_seconds" {
  description = "Request timeout in seconds"
  type        = number
  default     = 300
}

variable "allow_unauthenticated" {
  description = "Allow unauthenticated access to Cloud Run service"
  type        = bool
  default     = true
}

# Cloud Build configuration
variable "enable_cloud_build_trigger" {
  description = "Enable Cloud Build trigger for GitHub"
  type        = bool
  default     = false
}

variable "github_owner" {
  description = "GitHub repository owner"
  type        = string
  default     = ""
}

variable "github_repo" {
  description = "GitHub repository name"
  type        = string
  default     = ""
}
