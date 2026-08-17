output "zone_id" {
  description = "Cloudflare zone ID"
  value       = data.cloudflare_zone.site.id
}

output "worker_name" {
  description = "Worker container managed by Terraform"
  value       = cloudflare_worker.edge.name
}

output "dnssec_ds" {
  description = "Public DS record to install at Squarespace after enabling DNSSEC"
  value       = try(cloudflare_zone_dnssec.site[0].ds, null)
}
