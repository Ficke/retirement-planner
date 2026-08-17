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

variable "enable_staging_domain" {
  description = "Attach the temporary staging custom domain"
  type        = bool
  default     = false
}

variable "enable_apex_domain" {
  description = "Attach the canonical apex custom domain"
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
