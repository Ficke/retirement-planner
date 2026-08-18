# adamficke.dev Cloudflare Migration Plan

Status: approved for implementation  
Last updated: 2026-08-17  
Working branch: `codex/set-up-adamfickedev-on-cloudflare`

## Objective

Serve the retirement planner at `https://adamficke.dev` through a small
Cloudflare Worker that securely proxies to the existing Next.js Cloud Run
service. Manage stable Cloudflare infrastructure with Terraform, deploy Worker
code with Wrangler, validate the complete application on the new domain, remove
the unused AWS hosting resources, and enable DNSSEC.

## Coordination model

The root agent is the central integration and deployment owner. It maintains
this plan, assigns bounded work to subagents, reviews all changes, resolves
cross-cutting decisions, runs the final validation, and performs external
mutations in the required order.

Subagents may be assigned independent lanes such as:

- Worker and Next.js origin-security implementation/review
- Cloudflare Terraform, DNS import, and CI implementation/review
- Read-only provider inventory and validation across Cloudflare, GCP, Firebase,
  Squarespace, and AWS

Only one agent owns edits to a given file at a time. Subagents do not perform
production deployment, DNS cutover, DNSSEC activation, or AWS deletion unless
the root agent explicitly delegates that exact action. The root agent reviews
the shared worktree before every external mutation.

## Approved architecture

### Request path

```text
Browser
  -> Cloudflare DNS / TLS / WAF
  -> retire-plan-edge Worker
  -> public Cloud Run URL over HTTPS with origin secret
  -> Next.js
  -> IAM-authenticated Rust Cloud Run service for server simulations
```

### Cloudflare plan and domains

- Use Workers Free: 100,000 Worker requests per day and 10 ms CPU per request.
- Use one Worker, not permanent staging and production Workers.
- Use `staging.adamficke.dev` temporarily for end-to-end validation.
- Make `adamficke.dev` canonical.
- Redirect `www.adamficke.dev` permanently to the apex with one free Single
  Redirect rule.
- Disable public `workers.dev` and Worker preview URLs.

### Origin security and client IP

- Store one high-entropy origin secret as both a Cloudflare Worker secret and a
  Google Secret Manager secret injected into the Next.js service.
- The Worker removes any client-supplied protected forwarding headers, then
  supplies the origin secret, verified client IP, original host, scheme, and a
  request correlation identifier.
- Next.js rejects requests without the correct secret using a timing-safe
  comparison. Only `/healthz` is exempt for Cloud Run probes.
- Cloud Build's candidate smoke test supplies the secret.
- Direct public requests to the `run.app` application URL receive `403`, while
  the URL remains technically available for Cloudflare and Cloud Build.
- Next.js trusts the Worker-provided client IP only after origin authentication;
  it no longer relies on a fixed forwarded-proxy hop count for Worker traffic.
- Next.js verifies against a primary secret and an optional fallback, so the two
  systems can be updated in either order during a rotation.

#### Rotating the origin secret

The Worker and Cloud Run hold the secret in different providers and cannot be
updated at once. With a single accepted value, every ordering leaves a window
where the origin rejects all traffic; no sequencing avoids it.
`ORIGIN_SECRET_PREVIOUS` points at an older version of the same Secret Manager
secret, so rotation creates no second secret.

1. Add Secret Manager version N+1 without printing the value.
2. In `production.tfvars`, point `ORIGIN_SECRET` at N+1 and add
   `ORIGIN_SECRET_PREVIOUS` at N. Apply. The origin now accepts both.
3. Set `_ORIGIN_SECRET_VERSION` to N+1 so the Cloud Build smoke check sends the
   new value.
4. Run `wrangler secret put ORIGIN_SECRET` with the new value. The edge now
   sends it.
5. Remove `ORIGIN_SECRET_PREVIOUS`, apply, and disable version N.

Step 5 is not optional. A rotation prompted by disclosure leaves the exposed
value accepted until it runs.

### Proxy behavior

- Use a Module Worker written in TypeScript and a current `compatibility_date`.
- Stream request and response bodies without buffering.
- Make exactly one origin request and add no application-level retries.
- Do not add a separate Worker timeout; retain the application's existing
  30-second Monte Carlo, 60-second batch, and 300-second Cloud Run limits.
- Handle redirects manually so the origin secret cannot follow a redirect.
- Rewrite safe absolute redirects from the `run.app` origin to the canonical
  public domain. Never follow cross-origin redirects in the Worker.
- Return a generic `502` for transport failures and keep origin details in
  structured logs only.

### Caching

- Use the Workers Cache API explicitly for successful immutable `GET`
  responses under `/_next/static/*`; the `run.app` origin is not itself a
  Cloudflare-proxied cache target.
- Preserve Next.js's content-hashed, one-year immutable asset headers.
- Add `Cloudflare-CDN-Cache-Control: no-store` to every other response.
- Never edge-cache HTML, `/api/*`, auth routes, simulations, redirects, or
  error responses.
- Cache hits still consume the Workers Free daily request allowance.

### Abuse protection

- Keep the application's current per-IP request and weighted simulation-path
  limits as the semantic enforcement layer.
- Add the zone's one free WAF Rate Limiting Rule for `/api/simulation/*`, keyed
  by source IP, initially allowing 60 requests per 10 seconds with a 10-second
  block.
- Do not add a Worker Rate Limiting binding, Durable Object, KV counter, Redis,
  or another state service.

Workers Free enforces a hard 100,000 request/day cap and cache hits count
against it. A route has no non-Worker fallback, so exhausting the cap takes the
site down until the UTC day rolls over. Every page subresource counts, which
makes `/_next/static/*` a likelier exhaustion path than the simulation API.
Nothing mitigates this initially; Bot Fight Mode and a zone-wide rate-limit rule
are the levers if it is ever reached.

### Observability

- Capture 100% of automatic Worker invocation logs.
- Trace 10% of requests.
- Emit structured custom logs only for unexpected exceptions, rejected origin
  behavior, and upstream transport failures.
- Never log origin secrets, authorization tokens, cookies, bodies, complete
  headers, raw client IPs, or retirement-plan data.
- Do not add external Logpush, Sentry, or custom analytics initially.

### Firebase and application metadata

- Keep `gen-lang-client-0372385774.firebaseapp.com` as Firebase `authDomain`.
- Add `adamficke.dev` and temporary `staging.adamficke.dev` to Firebase
  Authentication Authorized Domains.
- Verify browser API-key application restrictions allow those origins and keep
  the key restricted to Firebase APIs.
- Set Next.js `metadataBase` and canonical metadata to
  `https://adamficke.dev`.
- Remove the temporary Firebase staging authorization after cutover.

### Infrastructure ownership

Terraform owns:

- Worker container/name
- Worker routes and the proxied placeholder records they attach to
- All user-created DNS records in the `adamficke.dev` zone
- `www` redirect ruleset and its proxied placeholder DNS record
- WAF rate-limit rule
- Always Use HTTPS zone setting
- DNSSEC state
- Future zone-level WAF and cache rules

Wrangler owns:

- Worker TypeScript bundling and generated binding types
- Runtime compatibility configuration
- Worker versions, deployments, and rollbacks
- Worker secret values
- Worker observability and `workers.dev`/preview URL settings

`wrangler.jsonc` must not declare routes or custom domains because Terraform
owns them. Neither tool may manage a resource owned by the other.

### Repository and state layout

```text
apps/edge-proxy/       Worker source, tests, package scripts, wrangler.jsonc
terraform/cloudflare/  Provider, imported DNS, Worker/domain, redirect, WAF,
                       and DNSSEC resources
```

- Reuse GCS bucket `retire-plan-tfstate-gen-lang-client-0372385774`.
- Use a separate backend prefix: `terraform/state/cloudflare-prod`.
- Look up the existing Cloudflare zone rather than making Terraform capable of
  deleting the zone.
- Import all existing user-created records before the cutover plan.

### Delivery

- Pull requests run Worker unit tests, typechecking, linting, generated-type
  checks, and a Wrangler dry-run bundle.
- After initial bootstrap, pushes to `main` automatically deploy Worker code
  only when edge-proxy files or relevant dependency files change.
- Use the official Wrangler GitHub Action pinned to an immutable commit and the
  repository-pinned Wrangler version.
- Use `wrangler deploy --strict` with a least-privilege Cloudflare API token.
- Terraform plans/applies and the initial Worker deployment remain manual.
- Gate post-merge Worker deployment on the repository variable
  `EDGE_DEPLOY_ENABLED=true`; set it only after the initial Worker and secret
  bootstrap succeeds.
- Do not store the origin secret in GitHub; normal Wrangler deployments preserve
  it.

## Current external state

Verified 2026-08-17 by read-only inventory.

### Cloudflare

- Zone `adamficke.dev` is `ff442a4703c379164a642897d97eb3b4`: active, type
  `full`, Free Website plan, in account `89a75ac95dfa6b01e511aa0f5bb5d9ae`.
- Cloudflare nameservers are authoritative:
  - `addilyn.ns.cloudflare.com`
  - `leonidas.ns.cloudflare.com`
- Original nameservers were Route 53. The registrar is Squarespace Domains II LLC.
- No Worker script, Worker route, or Worker custom domain exists yet, and the
  account has never created a `workers.dev` subdomain.
- Apex resolves through CNAME flattening to the legacy CloudFront distribution;
  `www` is an unproxied CNAME to the same distribution.
- Public DNS shows no MX, TXT, CAA, DS, or DNSKEY records, and no `staging` name.
- DNSSEC is unsigned. Cloudflare will generate DS values; adding the DS record at
  Squarespace is a required external step.
- The Wrangler OAuth token carries `zone (read)`, which excludes DNS records,
  rulesets, zone settings, and DNSSEC.

### AWS, account 036558359194

- CloudFront distribution `E2GRHIFQ0MTZD6` serves four aliases: `adamficke.dev`,
  `www.adamficke.dev`, `adamficke.com`, and `www.adamficke.com`.
- Its origins are the adamficke.com S3 buckets and API Gateway. adamficke.com is
  a live site, and adamficke.dev currently serves that same content.
- ACM certificate `d15bec61-7150-483b-b3da-6c661c66aae9` covers all four
  hostnames, is in use by that distribution, and expires 2027-02-08.
- Route 53 hosted zone `Z00299812665AE6YO4AB6` (`adamficke.dev`) is orphaned;
  Cloudflare is authoritative, so it serves no public traffic.
- Route 53 hosted zone `Z04479101GOFFRE70OK2D` (`adamficke.com`) is live.

### GCP

- Live web Cloud Run service is public at its `run.app` URL.
- Rust Cloud Run service is private and IAM-invoked by the web service.
- Secret Manager holds `DATABASE_URL` and `FIREBASE_PRIVATE_KEY`;
  `ORIGIN_SECRET` does not exist yet.
- The current application and simulation smoke check pass before this work.

## Shared certificate constraint

The ACM certificate above is DNS-validated, and its `adamficke.dev` and
`www.adamficke.dev` validation records live in the Cloudflare zone:

```text
_902cd09029d8ad858297874316f62745.adamficke.dev
_08bd04f558179d7741d9e78655159dc0.www.adamficke.dev
```

ACM re-checks every name on a certificate at managed renewal. Deleting either
record breaks renewal for the whole certificate and takes the live adamficke.com
site down when the current one expires. Terraform imports and retains them.

Retiring them requires first removing the two `.dev` aliases from the CloudFront
distribution and reissuing a `.com`-only certificate. That is optional cleanup
against a live site, not part of this migration.

A CAA record added to this zone must authorize Amazon alongside Cloudflare's
issuers, or it blocks that renewal. The zone has none today.

## Execution phases and gates

### Phase 1: Audit and prerequisites

- [x] Reconfirm clean branch and current `origin/main` ancestry.
- [x] Retrieve current Worker types, Wrangler schema, Cloudflare provider
      schema, and official product limits before implementation.
- [x] Inventory Cloudflare account/zone IDs, Worker resources, and public DNS.
- [ ] Enumerate every zone DNS record and the redirect and rate-limit phase
      entry-point rulesets via API.
- [ ] Inventory GCP service configuration, Secret Manager, IAM, Cloud Build
      service account permissions, and Firebase API-key restrictions.
- [x] Inventory AWS CloudFront, ACM, Route 53, and related resources without
      mutating them.
- [ ] Confirm required credentials are available with least privilege.

Wrangler's OAuth token cannot read DNS records, rulesets, zone settings, or
DNSSEC, and cannot run Terraform. That work needs an API token scoped to this
account and zone with Zone:Read, DNS:Edit, Zone Settings:Edit, Zone WAF:Edit,
Dynamic Redirect:Edit, DNSSEC:Edit, SSL and Certificates:Edit, Workers
Routes:Edit, and account-level Workers Scripts:Edit.

Gate: complete inventories exist, no unexpected DNS/email records are present,
and no resource proposed for deletion has another consumer.

### Phase 2: Local implementation

- [x] Add `apps/edge-proxy` with pinned Wrangler and generated Worker types.
- [x] Implement streaming proxy, header sanitization, secret forwarding, manual
      redirects, static-only cache policy, structured failures, and correlation.
- [x] Add Worker tests for all methods, bodies, spoofed headers, caching,
      redirect safety, upstream failures, and long-running streamed responses.
- [x] Add Next.js timing-safe origin validation and trusted client-IP handling.
- [x] Exempt only `/healthz` from origin authentication.
- [x] Update Cloud Build smoke check and IAM for secret access.
- [x] Add canonical application metadata.
- [x] Add the gated Cloudflare Terraform root and provider configuration.
- [ ] Add/import all existing DNS and phase ruleset resources after completing
      the live Cloudflare inventory. Cloudflare allows one zone entry-point
      ruleset per phase, so existing rules must be merged rather than added
      alongside.
- [x] Add Worker CI tests and post-merge deployment.

Gate: lint, typecheck, unit tests, application build, Terraform validation, and
Wrangler dry-run all pass locally with no secret values in source, plans, logs,
or Terraform state.

### Phase 3: Bootstrap and deploy

- [ ] Generate the origin secret without printing it.
- [ ] Store it in Google Secret Manager and grant the runtime and Cloud Build
      service accounts access.
- [ ] Deploy the GCP revision with origin enforcement and a secret-aware
      candidate smoke check.
- [ ] Apply Terraform to create the Worker container.
- [ ] Deploy the tested Worker version with Wrangler.
- [ ] Set the Worker secret with `wrangler secret put`, which publishes a new
      version.
- [ ] Add Firebase authorized domains and API-key referrer restrictions.
- [ ] Add the narrow GitHub deployment token/account secrets and enable
      `EDGE_DEPLOY_ENABLED` after the initial deployment succeeds.
- [ ] Route temporary `staging.adamficke.dev` and validate the real edge path.

The Worker secret cannot be set before the Worker exists, and the Worker returns
`500` until the secret is present, so that order is deliberate.

Gate: staging passes the full acceptance suite and direct `run.app` requests
are rejected while Cloud Build health/simulation checks pass.

### Phase 4: Coordinated cutover

- [ ] Take a final Cloudflare and AWS inventory.
- [ ] Apply one reviewed Terraform plan that replaces the imported legacy apex
      record with the proxied placeholder and attaches the apex Worker route.
- [ ] Replace the imported legacy `www` record with the proxied placeholder and
      enable the canonical redirect.
- [ ] Enable the free simulation WAF rate-limit rule.
- [ ] Verify TLS, DNS, canonical redirects, cache behavior, security headers,
      origin blocking, and Worker/Cloud Run correlation on the apex.
- [ ] Run the full application acceptance suite on `adamficke.dev`.

Gate: all acceptance criteria pass on the canonical domain. If they do not,
stop before AWS deletion and repair or roll back the Cloudflare binding/DNS.

### Phase 5: AWS retirement and DNSSEC

adamficke.com is live on the shared CloudFront distribution, certificate, S3
buckets, and API Gateway, so none of them are removable. The only resource this
migration orphans is the Route 53 `adamficke.dev` hosted zone.

- [ ] Confirm the CloudFront distribution no longer receives adamficke.dev
      traffic.
- [ ] Optionally delete Route 53 hosted zone `Z00299812665AE6YO4AB6`, which is
      already non-authoritative. Keep the `adamficke.com` zone.
- [ ] Remove the temporary staging route and Firebase authorization.
- [ ] Enable DNSSEC in Cloudflare/Terraform.
- [ ] Add the generated DS record at Squarespace.
- [ ] Verify signed delegation and successful DNSSEC validation publicly.
- [ ] Re-run the critical production smoke checks.

Gate: DNSSEC validates and the production smoke suite remains green.

## Acceptance criteria

- `https://adamficke.dev` serves the current application with a valid TLS
  certificate.
- `http://adamficke.dev` upgrades to HTTPS.
- `www` redirects permanently to the same apex path and query string.
- Direct unauthenticated access to non-health `run.app` paths returns `403`.
- Cloud Build can deploy, smoke-test, and promote candidate web revisions.
- Signed-out LOCAL mode works without Firebase or database persistence.
- Sign-up, sign-in, sign-out, cloud-sync toggle, profile, and account CRUD work.
- Local Web Worker simulations and server Monte Carlo/batch simulations work.
- Simulation API receives the verified end-user IP and rate limits correctly.
- Only `/_next/static/*` can produce Cloudflare cache hits; HTML/API responses
  remain uncacheable at Cloudflare.
- Worker responses stream without buffering and long batch calls complete.
- No origin hostname or secret appears in public responses or logs.
- Worker metrics/logs/traces are visible with the approved sampling.
- Firebase accepts only intended origins and the browser key remains API-scoped.
- DNSSEC reports a valid signed delegation.
- adamficke.com still serves correctly over TLS from the shared CloudFront
  distribution, and its certificate's validation records remain resolvable.

## Rollback and stop conditions

- Rollback is a Terraform change restoring the legacy CloudFront DNS records or
  removing the Worker route.
- Worker code can be rolled back to a previous version with Wrangler.
- Cloud Run can restore traffic to the prior revision, but origin-secret and
  smoke-check compatibility must be considered together.
- Do not delete AWS resources if the canonical-domain acceptance gate fails.
- If DNSSEC validation fails, remove the DS record at Squarespace first and
  keep Cloudflare zone signing enabled until the parent DS TTL expires.
- Never delete a Route 53 zone, CloudFront distribution, certificate, bucket,
  or logs until the read-only inventory proves it is dedicated to this domain.

## Cost envelope

- Cloudflare Workers Free: $0/month, with a 100,000-request daily hard limit.
- Cloudflare DNS, the zone's universal certificate, redirect, one WAF rate-limit
  rule, Worker secrets, caching, and DNSSEC: $0 incremental at selected usage.
- Workers logs/traces: $0 within 200,000 events/day and three-day retention.
- Google Secret Manager: normally $0 within the account's six active-version
  and 10,000-access monthly allowances; otherwise about $0.06 per additional
  active version plus $0.03 per 10,000 excess accesses.
- GitHub Actions: expected $0 within the repository/account allowance.
- Removing the orphaned Route 53 hosted zone may save about $0.50/month. No
  other AWS resource is removable.

## Decision log

- 2026-08-16: Use a Cloudflare Worker rather than a GCP external load balancer,
  Cloud Run domain mapping, Firebase Hosting rewrite, or direct DNS mapping.
- 2026-08-16: Use Workers Free rather than Paid.
- 2026-08-16: Require an origin secret from launch.
- 2026-08-16: Use one Worker and a temporary staging hostname.
- 2026-08-16: Split stable infrastructure to Terraform and code delivery to
  Wrangler.
- 2026-08-16: Cache only hashed Next.js static assets.
- 2026-08-16: Automatically deploy Worker code from GitHub Actions after merge.
- 2026-08-16: Make Terraform authoritative for all user-created zone records.
- 2026-08-16: Use full invocation logs and 10% tracing.
- 2026-08-16: Layer one free WAF rate rule over existing application limits.
- 2026-08-16: Use a simple streaming, single-fetch, no-retry proxy.
- 2026-08-16: Keep the existing Firebase auth domain.
- 2026-08-16: Perform cutover, AWS retirement, and DNSSEC activation in one
  coordinated migration, with a validation gate before destructive cleanup.
- 2026-08-16: Use the Workers Cache API for immutable Next.js static GETs
  because `run.app` is not a Cloudflare-proxied cache origin.
- 2026-08-16: Let Worker custom-domain resources own their generated DNS records
  and remove the legacy apex in a separate apply before enabling the apex.
  Superseded 2026-08-17.
- 2026-08-16: Manage Always Use HTTPS with Terraform.
- 2026-08-17: Bind hostnames with Worker routes on proxied placeholder records
  instead of Worker custom domains, so the apex swaps in a single apply under the
  zone's universal certificate and reverts by editing one record.
- 2026-08-17: Keep the shared CloudFront distribution, certificate, S3 buckets,
  and API Gateway, and retain the two ACM validation records indefinitely.
  adamficke.com is live on them.
- 2026-08-17: Verify the origin secret against a primary and an optional
  fallback so a rotation cannot reject every request mid-way.
- 2026-08-17: Drop `nodejs_compat`; the Worker uses only Web APIs.
- 2026-08-17: Enable no additional abuse protection initially, and record the
  free-tier request cap as the availability risk it creates.
