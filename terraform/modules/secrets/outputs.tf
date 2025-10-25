# Outputs for Secret Manager module

output "secret_ids" {
  description = "Map of secret IDs"
  value       = { for k, v in google_secret_manager_secret.secrets : k => v.secret_id }
}

output "secret_names" {
  description = "List of secret names"
  value       = [for s in google_secret_manager_secret.secrets : s.name]
}
