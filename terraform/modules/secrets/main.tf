# Secret Manager module for RetirePlan

terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

# Create secrets in Secret Manager
resource "google_secret_manager_secret" "secrets" {
  for_each = var.secrets

  secret_id = each.key

  replication {
    auto {}
  }

  labels = {
    app         = "retire-plan"
    environment = var.environment
    managed-by  = "terraform"
  }
}

# Note: Secret values are NOT stored in Terraform state
# They must be added manually using gcloud CLI or Console
# Example: echo -n "secret-value" | gcloud secrets versions add SECRET_NAME --data-file=-
