variable "cloudflare_account_id" {
  description = "Cloudflare account containing the adamficke.dev zone"
  type        = string
}

variable "zone_name" {
  description = "Authoritative Cloudflare zone"
  type        = string
  default     = "adamficke.dev"
}

variable "worker_name" {
  description = "Cloudflare Worker service name"
  type        = string
  default     = "retire-plan-edge"
}

variable "enable_staging_worker" {
  description = "Route the temporary staging hostname to the edge proxy Worker"
  type        = bool
  default     = false
}

variable "enable_apex_worker" {
  description = "Route the canonical apex to the edge proxy Worker"
  type        = bool
  default     = false
}

variable "enable_www_redirect" {
  description = "Create the proxied www placeholder and canonical redirect"
  type        = bool
  default     = false
}

variable "enable_rate_limit" {
  description = "Enable the coarse simulation API WAF rate limit"
  type        = bool
  default     = false
}

variable "enable_always_use_https" {
  description = "Enable Cloudflare's HTTP-to-HTTPS redirect"
  type        = bool
  default     = false
}

variable "enable_dnssec" {
  description = "Enable zone signing after traffic cutover"
  type        = bool
  default     = false
}

variable "legacy_origin_hostname" {
  description = "CloudFront distribution the apex and www records point at before cutover"
  type        = string
  default     = "d1isufjlbv5d7m.cloudfront.net"
}

variable "enable_tls_hardening" {
  description = "Raise the zone's minimum TLS version to 1.2"
  type        = bool
  default     = false
}
