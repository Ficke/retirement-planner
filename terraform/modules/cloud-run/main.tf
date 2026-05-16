# Cloud Run module for RetirePlan

terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

# Service account for Cloud Run
resource "google_service_account" "cloud_run" {
  account_id   = "${var.service_name}-sa"
  display_name = "Service Account for ${var.service_name}"
  description  = "Service account used by Cloud Run service ${var.service_name}"
}

# Grant Secret Manager access to Cloud Run service account
resource "google_project_iam_member" "cloud_run_secret_accessor" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.cloud_run.email}"
}

# Cloud Run service
resource "google_cloud_run_v2_service" "main" {
  name     = var.service_name
  location = var.region
  ingress  = var.ingress_settings

  template {
    service_account = google_service_account.cloud_run.email

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    timeout = "${var.timeout_seconds}s"

    containers {
      image = var.image

      resources {
        limits = {
          cpu    = var.cpu_limit
          memory = var.memory_limit
        }
        cpu_idle = true
        startup_cpu_boost = false
      }

      # Regular environment variables
      dynamic "env" {
        for_each = var.env_vars
        content {
          name  = env.key
          value = env.value
        }
      }

      # Secret environment variables from Secret Manager
      dynamic "env" {
        for_each = var.secret_env_vars
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value.secret_name
              version = env.value.version
            }
          }
        }
      }

      ports {
        container_port = var.container_port
      }

      # Liveness probe — omitted if liveness_probe_path is null
      dynamic "liveness_probe" {
        for_each = var.liveness_probe_path == null ? [] : [1]
        content {
          http_get {
            path = var.liveness_probe_path
          }
          initial_delay_seconds = 10
          timeout_seconds       = 3
          period_seconds        = 10
          failure_threshold     = 3
        }
      }

      # Startup probe — HTTP if startup_probe_path is set, else TCP on container_port
      startup_probe {
        dynamic "http_get" {
          for_each = var.startup_probe_path == null ? [] : [1]
          content {
            path = var.startup_probe_path
          }
        }
        dynamic "tcp_socket" {
          for_each = var.startup_probe_path == null ? [1] : []
          content {
            port = var.container_port
          }
        }
        initial_delay_seconds = 0
        timeout_seconds       = 3
        period_seconds        = 5
        failure_threshold     = 10
      }
    }
  }

  labels = {
    app         = "retire-plan"
    environment = var.environment
    managed-by  = "terraform"
  }

  depends_on = [
    google_project_iam_member.cloud_run_secret_accessor
  ]
}

# IAM policy for public access (if enabled)
resource "google_cloud_run_v2_service_iam_member" "public_access" {
  count = var.allow_unauthenticated ? 1 : 0

  name     = google_cloud_run_v2_service.main.name
  location = google_cloud_run_v2_service.main.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
