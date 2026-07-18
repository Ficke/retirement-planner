# Terraform outputs for RetirePlan deployment

output "cloud_run_url" {
  description = "URL of the deployed Cloud Run service"
  value       = module.cloud_run.service_url
}

output "cloud_run_service_name" {
  description = "Name of the Cloud Run service"
  value       = module.cloud_run.service_name
}

output "artifact_registry_repository" {
  description = "Artifact Registry repository for Docker images"
  value       = module.artifact_registry.repository_url
}

output "artifact_registry_location" {
  description = "Location of Artifact Registry"
  value       = module.artifact_registry.repository_location
}

output "secrets_created" {
  description = "List of secrets created in Secret Manager"
  value       = module.secrets.secret_ids
}

output "deployment_commands" {
  description = "Commands to deploy the application"
  value       = <<-EOT
    # Build and push Docker image
    docker build -t ${module.artifact_registry.repository_url}/${var.service_name}:latest .
    docker push ${module.artifact_registry.repository_url}/${var.service_name}:latest

    # Or use Cloud Build
    gcloud builds submit --tag ${module.artifact_registry.repository_url}/${var.service_name}:latest

    # Update Cloud Run service
    terraform apply -var="cloud_run_image=${module.artifact_registry.repository_url}/${var.service_name}:latest"
  EOT
}

output "set_secrets_commands" {
  description = "Commands to set secret values in Secret Manager"
  value       = <<-EOT
    # Set DATABASE_URL
    echo -n "your-neon-connection-string" | gcloud secrets versions add DATABASE_URL --data-file=-

    # Set FIREBASE_PRIVATE_KEY
    cat firebase-private-key.txt | gcloud secrets versions add FIREBASE_PRIVATE_KEY --data-file=-

    # Set GEMINI_API_KEY (optional)
    echo -n "your-gemini-api-key" | gcloud secrets versions add GEMINI_API_KEY --data-file=-

    # Set POLYGON_API_KEY (optional)
    echo -n "your-polygon-api-key" | gcloud secrets versions add POLYGON_API_KEY --data-file=-

    # Set Langfuse keys (optional)
    echo -n "pk-lf-..." | gcloud secrets versions add LANGFUSE_PUBLIC_KEY --data-file=-
    echo -n "sk-lf-..." | gcloud secrets versions add LANGFUSE_SECRET_KEY --data-file=-
  EOT
}
