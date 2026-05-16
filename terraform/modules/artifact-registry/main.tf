# Artifact Registry module for RetirePlan

terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

# Artifact Registry repository for Docker images
resource "google_artifact_registry_repository" "docker" {
  repository_id = var.repository_id
  location      = var.region
  description   = "Docker repository for ${var.repository_id}"
  format        = "DOCKER"

  labels = {
    app        = "retire-plan"
    managed-by = "terraform"
  }

  # Cleanup policy to remove old untagged images
  cleanup_policy_dry_run = false
  cleanup_policies {
    id     = "delete-untagged"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "2592000s" # 30 days
    }
  }
}

# Grant Cloud Build service account access to push images
data "google_project" "project" {
  project_id = var.project_id
}

resource "google_artifact_registry_repository_iam_member" "cloud_build_writer" {
  project    = var.project_id
  location   = google_artifact_registry_repository.docker.location
  repository = google_artifact_registry_repository.docker.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${data.google_project.project.number}@cloudbuild.gserviceaccount.com"
}
