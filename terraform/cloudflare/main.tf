terraform {
  required_version = ">= 1.8, < 2.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.22.0"
    }
  }

  backend "gcs" {
    bucket = "retire-plan-tfstate-gen-lang-client-0372385774"
    prefix = "terraform/state/cloudflare-prod"
  }
}

provider "cloudflare" {}

data "cloudflare_zone" "site" {
  filter = {
    account = { id = var.cloudflare_account_id }
    name    = var.zone_name
    status  = "active"
  }
}

# Terraform creates the Worker container. Wrangler owns its code, runtime
# configuration, versions, observability, subdomain settings, and secrets.
resource "cloudflare_worker" "edge" {
  account_id = var.cloudflare_account_id
  name       = var.worker_name
}

# A route, not a custom domain: a custom domain creates and owns its own DNS
# record, so binding the apex would mean destroying the legacy record in one
# apply and waiting on certificate issuance in the next. A route attached to a
# proxied placeholder swaps in a single apply under the zone's existing
# universal certificate, and rolls back by reverting one record.
#
# 192.0.2.0 is RFC 5737 documentation space, so a request that reaches the
# placeholder instead of the Worker fails closed rather than hitting a live host.
resource "cloudflare_dns_record" "staging_placeholder" {
  count   = var.enable_staging_worker ? 1 : 0
  zone_id = data.cloudflare_zone.site.id
  name    = "staging.${var.zone_name}"
  type    = "A"
  content = "192.0.2.0"
  ttl     = 1
  proxied = true
  comment = "Originless placeholder for the edge proxy Worker route"
}

resource "cloudflare_workers_route" "staging" {
  count   = var.enable_staging_worker ? 1 : 0
  zone_id = data.cloudflare_zone.site.id
  pattern = "staging.${var.zone_name}/*"
  script  = cloudflare_worker.edge.name

  depends_on = [cloudflare_dns_record.staging_placeholder]
}

# One resource per hostname rather than a legacy record and a placeholder
# gated on opposite counts: Cloudflare rejects a CNAME and an A record on the
# same name, so two resources could collide if Terraform created the
# replacement before destroying the original.
resource "cloudflare_dns_record" "apex" {
  zone_id = data.cloudflare_zone.site.id
  name    = var.zone_name
  type    = var.enable_apex_worker ? "A" : "CNAME"
  content = var.enable_apex_worker ? "192.0.2.0" : var.legacy_origin_hostname
  ttl     = var.enable_apex_worker ? 1 : 300
  proxied = var.enable_apex_worker
  comment = var.enable_apex_worker ? "Originless placeholder for the edge proxy Worker route" : "Migrated from Route 53 CloudFront alias"
}

resource "cloudflare_workers_route" "apex" {
  count   = var.enable_apex_worker ? 1 : 0
  zone_id = data.cloudflare_zone.site.id
  pattern = "${var.zone_name}/*"
  script  = cloudflare_worker.edge.name

  depends_on = [cloudflare_dns_record.apex]
}

resource "cloudflare_dns_record" "www" {
  zone_id = data.cloudflare_zone.site.id
  name    = "www.${var.zone_name}"
  type    = var.enable_www_redirect ? "A" : "CNAME"
  content = var.enable_www_redirect ? "192.0.2.0" : var.legacy_origin_hostname
  ttl     = var.enable_www_redirect ? 1 : 300
  proxied = var.enable_www_redirect
  comment = var.enable_www_redirect ? "Originless placeholder for www-to-apex redirect" : "Migrated from Route 53 CloudFront alias"
}

# ACM revalidates every name on a certificate at managed renewal, and the
# certificate these prove also carries adamficke.com, which is live. Deleting
# either record breaks that renewal and takes adamficke.com down when the
# current certificate expires.
resource "cloudflare_dns_record" "acm_validation_apex" {
  zone_id = data.cloudflare_zone.site.id
  name    = "_902cd09029d8ad858297874316f62745.${var.zone_name}"
  type    = "CNAME"
  content = "_c1fe8451324bcaa3d03bb6095894da8d.jkddzztszm.acm-validations.aws"
  ttl     = 300
  proxied = false
  comment = "AWS ACM certificate validation"
}

resource "cloudflare_dns_record" "acm_validation_www" {
  zone_id = data.cloudflare_zone.site.id
  name    = "_08bd04f558179d7741d9e78655159dc0.www.${var.zone_name}"
  type    = "CNAME"
  content = "_817f77192fb91675427c19130022e780.jkddzztszm.acm-validations.aws"
  ttl     = 300
  proxied = false
  comment = "AWS ACM certificate validation"
}

resource "cloudflare_ruleset" "www_redirect" {
  count       = var.enable_www_redirect ? 1 : 0
  zone_id     = data.cloudflare_zone.site.id
  name        = "Canonical hostname redirects"
  description = "Redirect www to the canonical apex hostname"
  kind        = "zone"
  phase       = "http_request_dynamic_redirect"

  rules = [{
    ref         = "redirect_www_to_apex"
    description = "Redirect www to apex while preserving path and query"
    expression  = "(http.host eq \"www.${var.zone_name}\")"
    action      = "redirect"
    enabled     = true
    action_parameters = {
      from_value = {
        status_code = 301
        target_url = {
          expression = "concat(\"https://${var.zone_name}\", http.request.uri.path)"
        }
        preserve_query_string = true
      }
    }
  }]

  depends_on = [cloudflare_dns_record.www]
}

resource "cloudflare_ruleset" "simulation_rate_limit" {
  count       = var.enable_rate_limit ? 1 : 0
  zone_id     = data.cloudflare_zone.site.id
  name        = "Simulation API rate limiting"
  description = "Coarse edge protection for public simulation endpoints"
  kind        = "zone"
  phase       = "http_ratelimit"

  rules = [{
    ref         = "rate_limit_simulation_api_by_ip"
    description = "Block an IP briefly after 60 simulation requests in 10 seconds"
    expression  = "starts_with(http.request.uri.path, \"/api/simulation/\")"
    action      = "block"
    enabled     = true
    ratelimit = {
      characteristics     = ["cf.colo.id", "ip.src"]
      period              = 10
      requests_per_period = 60
      mitigation_timeout  = 10
    }
  }]
}

resource "cloudflare_zone_setting" "always_use_https" {
  count      = var.enable_always_use_https ? 1 : 0
  zone_id    = data.cloudflare_zone.site.id
  setting_id = "always_use_https"
  value      = "on"
}

resource "cloudflare_zone_setting" "min_tls_version" {
  count      = var.enable_tls_hardening ? 1 : 0
  zone_id    = data.cloudflare_zone.site.id
  setting_id = "min_tls_version"
  value      = "1.2"
}

resource "cloudflare_zone_dnssec" "site" {
  count   = var.enable_dnssec ? 1 : 0
  zone_id = data.cloudflare_zone.site.id
  status  = "active"
}
