# adamficke.dev Cloudflare Migration Plan

Status: approved for implementation  
Last updated: 2026-08-16  
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
- Worker custom-domain binding
- All user-created DNS records in the `adamficke.dev` zone, except the generated
  apex/staging records owned through Worker custom-domain resources
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

- Cloudflare nameservers are authoritative:
  - `addilyn.ns.cloudflare.com`
  - `leonidas.ns.cloudflare.com`
- Apex and `www` still resolve to the legacy AWS CloudFront distribution.
- Public DNS shows no MX, TXT, CAA, DS, or DNSKEY records.
- Existing DNS TTLs are short: apex 60 seconds, `www` 300 seconds.
- Domain registrar is Squarespace Domains II LLC.
- DNSSEC is currently unsigned. Cloudflare will generate DS values; adding the
  DS record at Squarespace is a required external step.
- Live web Cloud Run service is public at its `run.app` URL.
- Rust Cloud Run service is private and IAM-invoked by the web service.
- The current application and simulation smoke check pass before this work.

## Execution phases and gates

### Phase 1: Audit and prerequisites

- [x] Reconfirm clean branch and current `origin/main` ancestry.
- [x] Retrieve current Worker types, Wrangler schema, Cloudflare provider
      schema, and official product limits before implementation.
- [ ] Inventory Cloudflare account/zone IDs and all zone records via API.
- [ ] Inventory GCP service configuration, Secret Manager, IAM, Cloud Build
      service account permissions, and Firebase API-key restrictions.
- [ ] Inventory dedicated AWS CloudFront, ACM, Route 53, S3, logging, and related
      resources without mutating them.
- [ ] Confirm required credentials are available with least privilege.

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
      the live Cloudflare inventory.
- [x] Add Worker CI tests and post-merge deployment.

Gate: lint, typecheck, unit tests, application build, Terraform validation, and
Wrangler dry-run all pass locally with no secret values in source, plans, logs,
or Terraform state.

### Phase 3: Bootstrap and deploy

- [ ] Generate the origin secret without printing it.
- [ ] Store it in Google Secret Manager and Cloudflare Worker secrets.
- [ ] Add Firebase authorized domains and API-key referrer restrictions.
- [ ] Deploy the GCP revision with origin enforcement and a secret-aware
      candidate smoke check.
- [ ] Create the Worker container and deploy the tested Worker version.
- [ ] Add the narrow GitHub deployment token/account secrets and enable
      `EDGE_DEPLOY_ENABLED` after the initial deployment succeeds.
- [ ] Bind temporary `staging.adamficke.dev` and validate the real edge path.

Gate: staging passes the full acceptance suite and direct `run.app` requests
are rejected while Cloud Build health/simulation checks pass.

### Phase 4: Coordinated cutover

- [ ] Take a final Cloudflare and AWS inventory.
- [ ] Apply a reviewed Terraform plan removing the imported legacy apex record;
      then apply a second plan enabling the Worker apex custom domain. The
      custom-domain resource creates its own DNS record and certificate.
- [ ] Replace the imported legacy `www` record with the proxied placeholder and
      enable the canonical redirect.
- [ ] Enable the free simulation WAF rate-limit rule.
- [ ] Verify TLS, DNS, canonical redirects, cache behavior, security headers,
      origin blocking, and Worker/Cloud Run correlation on the apex.
- [ ] Run the full application acceptance suite on `adamficke.dev`.

Gate: all acceptance criteria pass on the canonical domain. If they do not,
stop before AWS deletion and repair or roll back the Cloudflare binding/DNS.

### Phase 5: AWS retirement and DNSSEC

- [ ] Delete only AWS resources proven dedicated to this domain.
- [ ] Confirm no AWS DNS or distribution continues serving the domain.
- [ ] Remove temporary staging binding and Firebase authorization.
- [ ] Enable DNSSEC in Cloudflare/Terraform.
- [ ] Add the generated DS record at Squarespace.
- [ ] Verify signed delegation and successful DNSSEC validation publicly.
- [ ] Re-run the critical production smoke checks.

Gate: AWS inventory contains no obsolete dedicated resources, DNSSEC validates,
and the production smoke suite remains green.

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
- Dedicated legacy AWS resources are removed.

## Rollback and stop conditions

- Before AWS deletion, rollback is a Terraform change restoring the legacy
  CloudFront DNS records or detaching the Worker custom domain.
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
- Cloudflare DNS, custom-domain certificates, redirect, one WAF rate-limit
  rule, Worker secrets, caching, and DNSSEC: $0 incremental at selected usage.
- Workers logs/traces: $0 within 200,000 events/day and three-day retention.
- Google Secret Manager: normally $0 within the account's six active-version
  and 10,000-access monthly allowances; otherwise about $0.06 per additional
  active version plus $0.03 per 10,000 excess accesses.
- GitHub Actions: expected $0 within the repository/account allowance.
- Removing an unused Route 53 hosted zone may save about $0.50/month; dedicated
  S3/log storage may add small further savings.

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
- 2026-08-16: Manage Always Use HTTPS with Terraform.
