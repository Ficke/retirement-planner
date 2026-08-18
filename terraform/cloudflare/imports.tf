# Adopt the records that predate this configuration. Remove these blocks once
# the first apply has recorded them in state.

import {
  to = cloudflare_dns_record.apex
  id = "ff442a4703c379164a642897d97eb3b4/05971dff04d7e0c37db88ebcf8c1c44f"
}

import {
  to = cloudflare_dns_record.www
  id = "ff442a4703c379164a642897d97eb3b4/ae8584274beb43874cbb757482df3288"
}

import {
  to = cloudflare_dns_record.acm_validation_apex
  id = "ff442a4703c379164a642897d97eb3b4/971d3b9376955df7e086364b95b39b08"
}

import {
  to = cloudflare_dns_record.acm_validation_www
  id = "ff442a4703c379164a642897d97eb3b4/b5c46d28691bd28a2a9c6f1ad4068c4b"
}
