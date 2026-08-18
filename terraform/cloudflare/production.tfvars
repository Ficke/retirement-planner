cloudflare_account_id = "89a75ac95dfa6b01e511aa0f5bb5d9ae"
zone_name             = "adamficke.dev"
worker_name           = "retire-plan-edge"

# Each flag routes live traffic. Turn them on one reviewed apply at a time,
# in the order the migration plan's phases give.
enable_staging_worker   = true
enable_apex_worker      = false
enable_www_redirect     = false
enable_rate_limit       = false
enable_always_use_https = false
enable_tls_hardening    = false
enable_dnssec           = false
