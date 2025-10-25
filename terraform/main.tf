# Main Terraform configuration for RetirePlan GCP deployment

terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }

  # Backend configuration for state management
  # Uncomment and configure after creating GCS bucket
  # backend "gcs" {
  #   bucket = "retire-plan-terraform-state"
  #   prefix = "terraform/state"
  # }
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

# Cloud Run service for the application
module "cloud_run" {
  source = "./modules/cloud-run"

  project_id       = var.project_id
  region           = var.region
  service_name     = var.service_name
  image            = var.cloud_run_image

  # Environment variables
  env_vars = merge(
    var.public_env_vars,
    {
      NODE_ENV = var.environment
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
    module.secrets
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
