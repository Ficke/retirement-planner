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
}

# Secret environment variables (references to Secret Manager)
#
# Every entry here is fetched by Cloud Run at container start, so it sits on the
# cold-start path. Keep this list to secrets the app actually reads:
# DATABASE_URL (services/server/database.ts) and FIREBASE_PRIVATE_KEY
# (lib/firebase/admin.ts). The OCR-era GEMINI/POLYGON/LANGFUSE_* mounts were
# removed with the feature — nothing in the app reads them.
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

variable "cloud_build_trigger_name" {
  description = "Name of the Cloud Build trigger"
  type        = string
  default     = "deploy-production"
}

variable "cloud_build_service_account" {
  description = "Service account for Cloud Build trigger (e.g. projects/PROJECT_ID/serviceAccounts/PROJECT_NUMBER-compute@developer.gserviceaccount.com)"
  type        = string
  default     = ""
}

# Build-time substitution variables passed as --build-arg to Kaniko.
# These are distinct from public_env_vars (Cloud Run runtime env vars):
# NEXT_PUBLIC_* values must be baked into the client JS bundle during `next build`,
# so they must be present at Docker build time — Cloud Run env vars alone are not enough.
# Keys must start with _ per Cloud Build convention.
variable "build_substitutions" {
  description = "Cloud Build substitution variables passed as Kaniko build args (baked into client bundle)"
  type        = map(string)
  default     = {}
  # Set in terraform.tfvars:
  # build_substitutions = {
  #   _FIREBASE_API_KEY            = "AIza..."
  #   _FIREBASE_AUTH_DOMAIN        = "your-project.firebaseapp.com"
  #   _FIREBASE_PROJECT_ID         = "your-project-id"
  #   _FIREBASE_STORAGE_BUCKET     = "your-project.appspot.com"
  #   _FIREBASE_MESSAGING_SENDER_ID = "123456789"
  #   _FIREBASE_APP_ID             = "1:123456789:web:abc123"
  #   _FIREBASE_MEASUREMENT_ID     = "G-XXXXXXXXXX"
  # }
}

# Rust Simulation Service configuration
variable "rust_service_name" {
  description = "Name of the Rust simulation Cloud Run service"
  type        = string
  default     = "rust-simulation-service"
}

variable "rust_service_image" {
  description = "Docker image for Rust simulation service (format: region-docker.pkg.dev/project/repo/image:tag)"
  type        = string
}

variable "rust_memory_limit" {
  description = "Memory limit for Rust simulation service. Cloud Run requires >=2Gi when cpu_limit is 4."
  type        = string
  default     = "2Gi"
}

variable "rust_cpu_limit" {
  description = "CPU limit for Rust simulation service. 4 vCPU lets Rayon roughly halve sim wall-clock at the same vCPU-second cost."
  type        = string
  default     = "4"
}

variable "rust_min_instances" {
  description = "Minimum number of Rust simulation instances"
  type        = number
  default     = 0
}

variable "rust_max_instances" {
  description = "Maximum number of Rust simulation instances"
  type        = number
  default     = 10
}

variable "rust_timeout_seconds" {
  description = "Request timeout for Rust simulation service in seconds"
  type        = number
  default     = 120
}
