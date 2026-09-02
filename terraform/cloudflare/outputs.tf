output "zone_id" {
  description = "Cloudflare zone ID"
  value       = var.cloudflare_zone_id
}

output "worker_name" {
  description = "Worker container managed by Terraform"
  value       = cloudflare_worker.edge.name
}

output "dnssec_ds" {
  description = "Public DS record to install at Squarespace after enabling DNSSEC"
  value       = try(cloudflare_zone_dnssec.site[0].ds, null)
}

output "hyperdrive_id" {
  description = "Hyperdrive configuration ID for the Worker binding"
  value       = cloudflare_hyperdrive_config.neon.id
}
