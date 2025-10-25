# Outputs for Artifact Registry module

output "repository_id" {
  description = "ID of the Artifact Registry repository"
  value       = google_artifact_registry_repository.docker.repository_id
}

output "repository_name" {
  description = "Full name of the repository"
  value       = google_artifact_registry_repository.docker.name
}

output "repository_location" {
  description = "Location of the repository"
  value       = google_artifact_registry_repository.docker.location
}

output "repository_url" {
  description = "URL for pushing/pulling images"
  value       = "${google_artifact_registry_repository.docker.location}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.docker.repository_id}"
}
