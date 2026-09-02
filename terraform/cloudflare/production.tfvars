cloudflare_account_id = "89a75ac95dfa6b01e511aa0f5bb5d9ae"
cloudflare_zone_id    = "ff442a4703c379164a642897d97eb3b4"
zone_name             = "adamficke.dev"
worker_name           = "retire-plan-edge"

# Each flag routes live traffic. Turn them on one reviewed apply at a time,
# in the order the migration plan's phases give.
enable_staging_worker   = false
enable_apex_worker      = true
enable_www_redirect     = true
enable_rate_limit       = true
enable_always_use_https = true
enable_tls_hardening    = true
enable_dnssec           = true
