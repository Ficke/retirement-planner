# Main Terraform configuration for RetirePlan GCP deployment

terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }

  backend "gcs" {
    bucket = "retire-plan-tfstate-gen-lang-client-0372385774"
    prefix = "terraform/state/prod"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Enable required GCP APIs
resource "google_project_service" "required_apis" {
  for_each = toset([
    "run.googleapis.com",
    "cloudbuild.googleapis.com",
    "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com",
    "iam.googleapis.com",
  ])

  service            = each.value
  disable_on_destroy = false
}

# Artifact Registry for Docker images
module "artifact_registry" {
  source = "./modules/artifact-registry"

  project_id  = var.project_id
  region      = var.region
  repository_id = var.artifact_registry_repository_id
}

# Secret Manager for sensitive configuration
module "secrets" {
  source = "./modules/secrets"

  project_id = var.project_id
  secrets    = var.secrets

  depends_on = [google_project_service.required_apis]
}

# Rust simulation service (internal-only)
module "rust_simulation" {
  source = "./modules/cloud-run"

  project_id       = var.project_id
  region           = var.region
  service_name     = var.rust_service_name
  image            = var.rust_service_image

  # No environment variables needed for Rust service
  env_vars = {}
  secret_env_vars = {}

  # Resource limits optimized for compute-intensive simulations
  memory_limit = var.rust_memory_limit
  cpu_limit    = var.rust_cpu_limit

  # Scaling configuration
  min_instances = var.rust_min_instances
  max_instances = var.rust_max_instances

  # Timeout for long-running simulations
  timeout_seconds = var.rust_timeout_seconds

  # Internal-only access (only callable from other Cloud Run services)
  allow_unauthenticated = true
  ingress_settings = "INGRESS_TRAFFIC_INTERNAL_ONLY"

  # Custom container port for Rust service
  container_port = 8081

  # Liveness hits /healthz (added in main.rs). Startup probe stays TCP because
  # warp binds the listener before route registration completes; HTTP startup
  # would race with binary boot.
  liveness_probe_path = "/healthz"
  startup_probe_path  = null

  depends_on = [
    google_project_service.required_apis
  ]
}

# Cloud Run service for the Next.js application
module "cloud_run" {
  source = "./modules/cloud-run"

  project_id       = var.project_id
  region           = var.region
  service_name     = var.service_name
  image            = var.cloud_run_image

  # Environment variables (include Rust service URL)
  env_vars = merge(
    var.public_env_vars,
    {
      NODE_ENV = var.environment
      RUST_SERVICE_URL = module.rust_simulation.service_url
    }
  )

  # Secret references from Secret Manager
  secret_env_vars = var.secret_env_vars

  # Resource limits
  memory_limit = var.memory_limit
  cpu_limit    = var.cpu_limit

  # Scaling configuration
  min_instances = var.min_instances
  max_instances = var.max_instances

  # Timeout
  timeout_seconds = var.timeout_seconds

  # Allow unauthenticated access (set to false for private apps)
  allow_unauthenticated = var.allow_unauthenticated

  depends_on = [
    google_project_service.required_apis,
    module.secrets,
    module.rust_simulation
  ]
}

# Cloud Build trigger for automated deployments (optional)
resource "google_cloudbuild_trigger" "main_branch" {
  count = var.enable_cloud_build_trigger ? 1 : 0

  name        = "${var.service_name}-main-branch"
  description = "Build and deploy on push to main branch"

  github {
    owner = var.github_owner
    name  = var.github_repo
    push {
      branch = "^main$"
    }
  }

  filename = "cloudbuild.yaml"

  depends_on = [google_project_service.required_apis]
}
