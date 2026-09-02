# Edge compute migration plan

Status: approved; Phases 0-2 complete and deployed, Phase 3 written and
awaiting its two operator steps
Last updated: 2026-09-02
Working branch: `edge-compute`
Review: four-lane red team (Cloudflare platform, security, application port,
migration operations). Findings folded in; see [Review corrections](#review-corrections).

## Resume point

As of 2026-09-02, Phases 0-2 are complete and deployed, and Phase 3's code is
merged but not deployed. Two operator steps stand between here and cutting the
tag, both requiring credentials this repository does not hold:

1. **Install the edge invoker key.** The `edge-invoker` service account and its
   `run.invoker` binding are applied; the key is not created. Run [Key
   bootstrap](#key-bootstrap). Until then `/api/simulation/*` answers 503 at
   the edge, and the client falls back to local Wasm — degraded, not broken.
2. **Create the Firebase smoke account**, give it a row in the application
   `users` table, store `SMOKE_USER_EMAIL` and `SMOKE_USER_PASSWORD` as
   repository secrets, and set the `EDGE_SMOKE_ENABLED` variable to `true`.
   The deploy workflow skips the simulation smoke check until then.

Also unset: `SIGNUP_INVITE_CODES` and `ORIGIN_SECRET` are declared in
`secrets.required` but have never been verified against what the Worker
actually holds. `wrangler secret list` answers that.

## Objective

Move the web tier off Cloud Run and into the Cloudflare Worker. Static assets
and the SPA shell serve from Cloudflare's asset store, the Hono API runs at the
edge, Neon is reached through Hyperdrive, and the Rust simulation service stays
on Cloud Run, invoked with a Google-signed OIDC token the Worker mints itself.

## Non-goals

- Retiring the Rust simulation service. It stays, IAM-authenticated.
- Browser Wasm threading and cross-origin isolation. Newly viable — the app has
  no popups — but a separate project. See [Follow-ups](#follow-ups).
- Migrating Firebase Authentication or Neon.
- Changing simulation semantics, seeds, or the shared Rust core.

## This is not a cost migration

Say this plainly, because the first draft implied otherwise. Web Cloud Run
request-seconds are under $1/month today (`DEPLOYMENT.md`). Artifact Registry,
Cloud Build, Secret Manager, GCS state, and the Rust service all remain. If the
10 ms CPU ceiling forces Workers Paid, the net is **+$5/month**.

The migration buys latency (no cold start on the HTML path), a much larger free
request budget, and the deletion of the origin-secret apparatus. It does not
buy money.

## Target request path

```text
Browser
  -> Cloudflare DNS / TLS / WAF / zone rate limit
  -> retire-plan-edge Worker
       |- SPA shell + assets       served without invoking the Worker
       `- /api/*                   Hono
                                     |- Hyperdrive -> Neon (aws-us-east-1)
                                     |- Firebase JWKS verification (jose)
                                     `- OIDC ID token
                                          -> Rust Cloud Run service (private)
```

The Rust service keeps `allow_unauthenticated = false`, so Google's front end
rejects forged requests before a container starts. That property is the reason
this plan mints a token rather than sharing a secret.

## Repository shape

One Worker, one Vite build, `@cloudflare/vite-plugin`. `apps/edge-proxy` merges
into `apps/web`.

```text
apps/web/
  src/app/             React pages, retained
  src/components/      React UI, retained
  src/worker/          Hono app, moved from src/server
  src/wasm/            generated Wasm package, unchanged
  public/_headers      static-asset response headers
  vite.config.ts       cloudflare() plugin
  wrangler.jsonc
scripts/migrate.ts     schema migrations, run under tsx by CI
```

Deleted: `apps/edge-proxy/`, `apps/web/tsup.config.ts`, the web `Dockerfile`,
`dist-server/`, `src/lib/origin-auth.ts`, `src/lib/rate-limit.ts`, and the web
half of `cloudbuild.yaml`.

## Wrangler configuration

```jsonc
{
  "name": "retire-plan-edge",
  "main": "./src/worker/index.ts",
  "compatibility_date": "2026-08-24",
  "compatibility_flags": [
    "nodejs_compat",
    "enable_request_signal",
    "request_signal_passthrough"
  ],
  "workers_dev": false,
  "preview_urls": false,

  "assets": {
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },

  "placement": { "region": "aws:us-east-1" },

  "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "<id>" }],

  "vars": {
    "ORIGIN_URL": "<web-cloud-run-service-url>",
    "FIREBASE_PROJECT_ID": "<project-id>",
    "RUST_SERVICE_URL": "<private-cloud-run-service-url>"
  },

  "durable_objects": {
    "bindings": [{ "name": "QUOTA", "class_name": "QuotaCounter" }]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["QuotaCounter"] }
  ],

  "secrets": {
    "required": [
      "ORIGIN_SECRET",
      "SIGNUP_INVITE_CODES",
      "GCP_SA_CLIENT_EMAIL",
      "GCP_SA_PRIVATE_KEY",
      "GCP_SA_PRIVATE_KEY_ID"
    ]
  },

  "observability": {
    "enabled": true,
    "logs": { "enabled": true, "head_sampling_rate": 1 },
    "traces": { "enabled": true, "head_sampling_rate": 0.1 }
  }
}
```

Notes on choices that review changed:

- **No `assets.directory`.** The Vite plugin generates it into the build's
  output `wrangler.json` from the client build. Setting it by hand conflicts
  with `build.outDir`.
- **`preview_urls: false`.** The site has effectively no traffic, so direct
  production deployments followed by immediate smoke checks are simpler than
  maintaining a preview path. Preview URLs are also unavailable once this
  Worker exports the `QuotaCounter` Durable Object.
- **`enable_request_signal` and `request_signal_passthrough`** are not defaults.
  Without them `c.req.raw.signal` never fires: `AbortSignal.any()` in
  `simulation-proxy.ts:17` degrades to the timeout alone and the `499` branches
  become dead code, so an abandoned 60-second batch keeps an 8-vCPU container
  busy for the full window.
- **`nodejs_compat` is implied** at compatibility dates from 2026-08-04, but is
  listed explicitly because the code's dependence on it is not obvious.
- **No KV namespace.** Both cache uses moved to the Cache API — see below.
- **A Durable Object** is now required rather than held in reserve, for the
  weighted path quota. See [Rate limiting](#rate-limiting).

`run_worker_first` lists only `/api/*`. Setting it to `true` routes everything
through the Worker, and past the free daily limit those requests return `429`
rather than falling back to asset serving.

Cloudflare documents a caveat where Smart Placement combined with
`run_worker_first` places the whole script as one unit and may not optimize
correctly. Explicit `placement.region` is an extension of the same mechanism, so
treat placement as a measured optimization, not a guarantee. Static assets are
unaffected — they always serve from the location nearest the request.

## Static assets and headers

Vite's client output uploads with the Worker. Asset requests are free,
unlimited, and never invoke the Worker, which removes the busiest request class
from the 100,000/day allowance.

`public/_headers` (authored as a Vite public input, since the plugin owns the
output directory) carries the full header set. It applies **only** to static
assets; Worker responses keep Hono's `secureHeaders()`. Limits are 100 rules and
2,000 characters per line.

```text
/*
  Content-Security-Policy: ...
  Cross-Origin-Opener-Policy: same-origin
  Referrer-Policy: strict-origin-when-cross-origin
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()

/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

`X-Content-Type-Options: nosniff` was missing from the first draft — a straight
regression against today's `secureHeaders()` output and `SECURITY.md:111`.

The default asset header is `public, max-age=0, must-revalidate`, so the
`/assets/*` override is what preserves immutable caching for hashed files.

Two CSP changes fall out of the migration:

- `frame-src https://*.firebaseapp.com` can go. Nothing loads that iframe.
- `same-origin-allow-popups` becomes `same-origin`. The app has no popups.

Keep `connect-src https://*.googleapis.com` as a wildcard rather than narrowing
to two hosts. Narrowing breaks `firebaseinstallations.googleapis.com` the moment
App Check or Analytics is added, for no real gain against a Google-owned domain.

**Keep `secureHeaders()` mounted on `'*'` in Hono.** Coverage is split between
two mechanisms now, so add a test asserting CSP on both an asset response and a
Worker response — `tests/middleware.test.ts` is currently the only test of these
headers and it dies with the Node server.

## Database access

### Hyperdrive, caching disabled

Hyperdrive caches read queries for 60 seconds by default and **does not
invalidate on write**. This app saves a profile and reads it back, and uses a
`revision` column that raises `ProfileRevisionConflictError` on mismatch. A
stale read produces spurious `409`s and apparent lost writes. Create the
configuration with `--caching-disabled`.

**The real free-tier cliff is Hyperdrive, not Workers.** Free plan allows
100,000 database queries per day, where a query is any statement. At several
statements per authenticated request that binds around 20,000–30,000 requests/day
— well below the 100,000 Worker request limit the design otherwise optimizes
against. Disabling caching removes the only mechanism that would keep statements
off that meter. This is acceptable at current traffic and must be watched.

Rejected alternative: `@neondatabase/serverless` over HTTP, which avoids the
Hyperdrive quota entirely and works in local development. It cannot do
interactive transactions, and `saveUserProfile` (`database.ts:320`) and
`createAccount` both need `pg_advisory_xact_lock` inside a transaction. Keeping
`pg` and rewriting the pool is the smaller change.

### Rewriting the data layer

Bigger than "swap Pool for Client." All of this moves together:

- `PostgreSQLConnection` holds a `pg.Pool` (`database.ts:161`) in a module
  singleton (`:499`). Replace with a factory taking a connection string,
  constructed per request from `c.env`. The singleton would otherwise outlive
  isolates and pin one connection string forever.
- `process.env.DATABASE_URL` (`database.ts:225-232`) does not exist.
  `env.HYPERDRIVE.connectionString` is a non-text binding and never appears in
  `process.env`.
- `PostgreSQLTransaction` takes a `PoolClient` (`:143`); `transaction()` uses
  `pool.connect()` (`:190`) and `client.release()` (`:201`). With a bare
  `Client`, rewrite as `BEGIN`/`COMMIT`/`ROLLBACK` on the request client.
- **Close the client.** `ctx.waitUntil(client.end())` in a `finally`. Un-ended
  clients exhaust the ~20 free-plan origin connections.
- **`statement_timeout` silently disappears.** `database.ts:170-171` sets it as
  a startup parameter; Hyperdrive pools in transaction mode and resets the
  connection between transactions, so non-default startup parameters do not
  survive. Issue `SET LOCAL statement_timeout = 15000` as the first statement
  inside `transaction()`. Single queries keep the client-side `query_timeout`
  and Hyperdrive's 60-second ceiling.
- Remove `initialize()` and `close()` from the `UnifiedDatabaseService`
  interface (`:22-23`), the eight `ensureInitialized()` call sites, and the
  eight `await db.initialize()` calls in `app.ts` (`:128,149,182,202,226,251,278,302`).

Local development: Wrangler supports a local connection string for the
Hyperdrive binding. Set
`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` to a non-production
Neon branch connection string; the Worker runs locally and connects directly,
without Hyperdrive pooling or caching. Use `wrangler dev --remote` only for an
explicit integration check because it uses the deployed Hyperdrive
configuration and therefore the configured remote database.

### Migrations move out of the request path

`initialize()` runs `SELECT 1`, takes an advisory lock, and executes the
migration transaction on first use. On Cloud Run that is once per container; in
a Worker, isolates are created and destroyed constantly, so this would run DDL
from user traffic.

`scripts/migrate.ts`, run under `tsx` in CI before deploy. It must stay
TypeScript: migration 14 interpolates `PLAN_SCHEMA_VERSION` from
`@/domain/constants` (`database.ts:121-123`), which is also read at runtime by
`saveUserProfile` (`:458,467`). Duplicating that constant into a `.mjs` lets the
column default drift from the code silently.

Two rules make the split safe, because migrations are forward-only — there are
no `down` scripts:

1. **Expand/contract only.** Every migration must be compatible with the
   previously deployed Worker, so that a rollback against a migrated schema
   works. A bare `ADD CONSTRAINT ... CHECK` violates this.
2. **Fail closed on a schema floor.** The Worker reads `MAX(version) FROM
   schema_migrations` once per isolate and refuses to serve below its expected
   minimum. This catches a deploy that skipped CI.

`pg_advisory_xact_lock` (`:268`) still serializes concurrent CI runs correctly
and survives a cancelled job.

**CI gains a database credential it does not have today.** Use a dedicated
migration role with DDL rights, and give the Worker's Hyperdrive role no DDL at
all. That is a genuine security improvement over the current single role, and it
should be claimed as one.

## Authenticating to the Rust service

The Worker mints a Google-signed OIDC ID token with a service-account key and
the JWT-bearer grant. Cloud Run validates it exactly as it validates today's
metadata-server token, so nothing changes on the GCP side.

### Key bootstrap

A dedicated `edge-invoker@<project>` service account holding `roles/run.invoker`
on the Rust service and nothing else.

**Do not create the key with `google_service_account_key`** — Terraform would
write the private key into the GCS state bucket in plaintext. Terraform owns the
service account and the IAM binding only, with a comment recording that the key
is deliberately outside its control.

The first draft's `tee >(…)` pipeline was wrong: process substitution does not
propagate exit codes, so a failed `wrangler secret put` reports success, and
three concurrent `secret put` calls each create a Worker version and race. Use
one atomic bulk call:

```sh
set -euo pipefail
KEY=$(gcloud iam service-accounts keys create /dev/stdout \
  --iam-account="edge-invoker@${PROJECT}.iam.gserviceaccount.com")
jq '{GCP_SA_PRIVATE_KEY: .private_key,
     GCP_SA_CLIENT_EMAIL: .client_email,
     GCP_SA_PRIVATE_KEY_ID: .private_key_id}' <<<"$KEY" \
  | wrangler secret bulk
unset KEY
```

One API call, one version, a real exit code, nothing on disk or in argv.

**Rotation runbook** — this replaces the origin-secret runbook the migration
deletes, and is not optional:

1. Create the new key and apply it with `secret bulk` (above).
2. Verify a simulation succeeds through the edge.
3. Delete the old key in GCP.
4. Confirm `wrangler secret list` shows the expected names.

### Token minting

```text
JWT header   { alg: "RS256", typ: "JWT", kid: <private_key_id> }
JWT claims   { iss: <client_email>, sub: <client_email>,
               aud: "https://oauth2.googleapis.com/token",
               target_audience: <rust service URL>,
               iat, exp: iat + 3600 }
sign         crypto.subtle.importKey("pkcs8", der,
               { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"])
exchange     POST https://oauth2.googleapis.com/token
             grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer
             assertion=<jwt>
result       { id_token }   valid one hour
```

`target_audience` must equal the Cloud Run service URL with no trailing slash —
the same value `getIdTokenClient(serviceUrl)` uses today.

### Token caching: Cache API, not KV

The first draft put the token in KV. **KV values are readable in plaintext from
the dashboard and by any API token with KV read** — a strictly weaker store than
a Worker secret, holding a live `run.invoker` bearer token. Worse, deleting the
service-account key stops minting but does not invalidate an already-minted
token, so a revoked key keeps working for up to the cache lifetime.

Use a module-global memo plus the Cache API, which is per-colo and not readable
through any account API. Cost is one token exchange per colo per hour, which at
this traffic is negligible. Key the cache entry on the private key id and a hash
of the target audience so rotation self-invalidates, cache for 55 minutes
against a 60-minute lifetime with jitter, and validate `aud` and `exp` on the
cached token before use.

The same reasoning applies to the Firebase JWKS: cache it in the Cache API, never
KV. A KV-cached JWKS that anyone with an account API token can overwrite is
universal ID-token forgery.

### Two fixes in the existing client

- `requiresIdToken()` (`rust-service-client.ts:23`) skips authentication for any
  non-`https` URL. At the edge that heuristic has no local-dev justification, and
  a misconfigured `RUST_SERVICE_URL` would send plan data unauthenticated.
  Require https unconditionally in the Worker.
- `simulationProxyError` (`simulation-proxy.ts:58`) tests
  `message.includes('timeout')` before the `RustServiceUnavailableError` branch
  (`:64`). A token-mint failure whose message contains "timeout" answers 504
  instead of 503, misleading the smoke check. Reorder.

## Rate limiting

`lib/rate-limit.ts` cannot run at all: it constructs a singleton at import
(`:124`) whose constructor calls `setInterval` (`:31`), and workerd rejects I/O
in global scope. The file is deleted, not ported. Every `rateLimit()` call in
`app.ts` (`:311,340,354,387,405,433`) changes.

| Today | Replacement | Guarantee |
|---|---|---|
| 300 req/min per IP | `QuotaCounter`, keyed on Firebase `uid`, 300/60s | Global, exact |
| 2,000,000 paths/min per IP | `QuotaCounter`, keyed on Firebase `uid`, weighted | Global, exact |
| 10 signups/hour per IP | `QuotaCounter`, keyed on Firebase `uid` | Global, exact |
| Zone WAF rule on `/api/simulation/*` | **Must be enabled** | Per-colo |

The rate-limit binding was the original choice for the request count and is not
configured: it accepts periods of 10 or 60 seconds only, is enforced per
Cloudflare location, has no weighted cost, and Cloudflare describes it as
"permissive, eventually consistent, and intentionally designed to not be used as
an accurate accounting system." The Durable Object already had to exist for the
path budget, and counting requests in it costs nothing extra.

**The weighted path quota cannot be dropped.** The first draft proposed dropping
it on the theory that per-request clamps plus the zone WAF rule were sufficient.
Review found the zone rule is `enable_rate_limit = false` in
`terraform/cloudflare/production.tfvars:10` — it has never been applied. With the
quota gone and no WAF rule, one IP can drive 300 requests/60s/colo ×
`MAX_BATCH_TOTAL_PATHS` = roughly 12M paths/minute per colo, six times today's
budget and unbounded across colos. The Rust service is `container_concurrency = 1`
with `max_instances = 10` at 8 vCPU / 4 GiB, so saturation is immediate:
legitimate users get 429s and 504s while the meter runs at roughly $7/hour.
Separately, 300 req/min is 432,000 Worker requests/day against a 100,000/day
free ceiling — one attacker takes the site down for free.

So: a SQLite-backed Durable Object counter, free on the Workers Free plan,
keyed on verified Firebase `uid` with `paths` as the cost. Roughly forty lines.
Plus three configuration checks that are cheap and independently worthwhile:

- Apply `enable_rate_limit = true` before any simulation route moves.
- Validate the request bounds against the largest batch the current UI can
  generate; do not reduce them below a legitimate request merely to tighten a
  nominal ceiling.
- Choose a deliberate Cloud Run `max_instances` cap after measuring the Rust
  service, so worst-case spend is bounded without guessing at a value here.

Require a verified Firebase token and a matching row in the application
`users` table before either simulation handler or limiter runs. A Firebase
identity alone is insufficient: Firebase's public signup API can create an
identity without passing this app's invite check. A short-lived Cache API entry
may avoid repeating the membership query, but it must be keyed by verified
`uid` and have a bounded revocation delay. Signed-out or unregistered sessions
use local Wasm and never call the Rust service. `cloudComputeEnabled` must
include authenticated application-account readiness, not only the stored
engine preference. The zone WAF remains an IP-based coarse shield before
authentication; application quotas use only the verified `uid`.

Invite codes are operator-typed strings (`invite-code.ts:11`) with no entropy
floor, so "code entropy is the real defense" is an assumption, not a control.
No invite codes have been distributed, so do not preserve the current value.
Generate a fresh code of at least 128 bits when the Worker secret is installed;
existing accounts do not use it.

## What gets deleted, and when

The origin-security layer exists because a Worker had to prove itself to a
public Cloud Run service. With no web origin it all goes — **but the order
matters, and the first draft got it wrong.**

`/api/internal/simulation-probe` (`app.ts:431`) has no authentication of its
own. Per `SECURITY.md:65-73` it is protected by exactly two things: the proxy's
404 (`edge-proxy/src/index.ts:193`) and `ORIGIN_SECRET` (`app.ts:107-112`). The
first draft deleted origin auth in one phase and the Cloud Run service in a
later one, leaving a window where a public, unauthenticated, effectively
unrate-limited pipe to the 8-vCPU service is reachable at a `run.app` hostname
that is committed in this repository.

Correct order, all inside Phase 4:

1. Delete the probe route from `app.ts`, deploy Cloud Run, and verify
   `curl https://<run-url>/api/internal/simulation-probe` returns 404.
2. Set `allow_unauthenticated = false` on the web service and apply.
3. Only then remove `origin-auth.ts` and the middleware.
4. Delete the service.

Safe to delete once that order holds: `ORIGIN_SECRET` and its rotation runbook,
`lib/origin-auth.ts`, request header stripping, response header scrubbing,
origin redirect rewriting, the `/api/internal/` block, and `/healthz` — the last
only after Cloud Run stops probing it.

`cf-connecting-ip` is safe to read directly; Cloudflare overwrites it. Keep an
explicit rule that only `cf-connecting-ip` is ever read: `x-forwarded-for` is
appended to, not overwritten.

## Infrastructure and delivery

Terraform owns stable infrastructure; Wrangler owns code and secrets.

Terraform gains `cloudflare_hyperdrive_config` and the `edge-invoker` service
account with its `run.invoker` binding. It loses `module.cloud_run`, the web
service account, the `web_invokes_rust` binding, `ORIGIN_SECRET`, and the now
dead `var.cloud_run_image` and `var.secret_env_vars`.

**Those removals must land in one commit and one apply**, together with the
`cloudbuild.yaml` web-step deletion, because they are mutually entangled:

- `cloud_build_origin_secret_accessor` (`terraform/main.tf:160`) indexes
  `module.secrets.secret_ids["ORIGIN_SECRET"]`. Removing the secret from
  `var.secrets` without removing this resource is a plan-time error, which fails
  `verify-terraform-applied` (`cloudbuild.yaml:54-79`) on *every* subsequent
  build.
- Applying the `module.cloud_run` destroy while `deploy-web-candidate` still
  runs means the next tag's `gcloud run deploy` recreates the service outside
  Terraform, resurrecting an unauthenticated public origin.
- `cloud_build_tfstate_reader` (`:171`) must survive; it is what lets the gate
  read state.

The gate only covers the GCP root. Nothing checks `terraform/cloudflare` drift,
which becomes the load-bearing root after this migration — add an equivalent
check.

### Keep a production smoke check

`cloudbuild.yaml:201-217` runs a real end-to-end simulation against a
`--no-traffic` candidate, and `promote-web` (`:218-229`) only runs on success.
Deleting it leaves nothing proving the Worker → Rust → wire-contract path.

Replacement: `scripts/smoke-check-edge.sh` calls the authenticated public
simulation route against `https://adamficke.dev` after the Wrangler deploy, and
the workflow rolls the Worker back when it or the asset verification fails.
`scripts/smoke-check.sh` stays as it is, covering the origin until Phase 4
deletes it.

It signs in a dedicated Firebase smoke user that has a row in the application
`users` table, through Firebase's password sign-in REST endpoint, and prints
neither the credentials nor the token. Store the email and password only as
repository secrets. The smoke user needs no plan data because simulation inputs
are transient. The site has effectively no traffic, so a separate preview or
gradual-deployment path is unnecessary.

### The deploy pipeline is active

`.github/workflows/deploy-edge.yml:19` gates on
`vars.EDGE_DEPLOY_ENABLED == 'true'`, which is enabled. Live inventory on
2026-09-01 found four successful deployments from 2026-08-23 through
2026-08-25. Update `workingDirectory` (`:43`) when `apps/edge-proxy` merges into
`apps/web`.

The edge build also needs `VITE_FIREBASE_*`, which today exist only as Terraform
`build_substitutions` fed to Kaniko (`cloudbuild.yaml:106-112`). GitHub Actions
has no copy.

### Rollback

`wrangler rollback` reverts secrets and the asset manifest along with code.
Rolling back past the version that introduced `GCP_SA_PRIVATE_KEY` yields a
version without it, and `secrets.required` is a deploy-time check that will not
catch it. Reverting the asset manifest also means clients holding a newer
`index.html` request assets that no longer exist — and
`not_found_handling: single-page-application` answers those with the HTML shell
at status 200, producing a module MIME failure and a blank page with no error
signal.

Document a rollback floor version. Prefer rolling forward.

## Phases

### Phase 0 — prepare the safeguards — complete

No user-visible change. Gate met on 2026-09-01.

- `enable_rate_limit = true` applied. The rule blocks an IP after 60 requests
  to `/api/simulation/*` in 10 seconds, keyed on `cf.colo.id` and `ip.src`.
- Request bounds validated against a real service-generated batch: the widest
  sweep is 31 scenarios at 1,000 paths, inside the 40-simulation and
  40,000-path ceilings, which therefore stay as they are.
- Rust `max_instances` set to 2 from measured demand.
- `VITE_FIREBASE_*` added to the edge deploy workflow and to repository
  variables.
- `terraform/cloudflare` drift check added to Cloud Build.

### Phase 1 — SPA and assets from the edge — complete

`apps/edge-proxy` merged into `apps/web` behind `@cloudflare/vite-plugin`. The
asset store serves the shell and hashed assets; `run_worker_first` lists only
`/api/*`, which still proxies to Cloud Run with the origin secret intact.

The four application pages were already URL-addressable and were retained:
`/plan`, `/accounts`, `/profile`, and `/settings`, with `/` redirecting to
`/plan`, plus `/auth/signin` and `/auth/signup`.

Decisions taken during implementation:

- The Cloudflare plugin is gated behind `EDGE_BUILD`. It owns the Vite output
  layout, and the plain `dist/` the Cloud Run container serves must keep
  working as the rollback target until Phase 4.
- `scripts/verify-edge-assets.sh` replaces the planned smoke-check rewrite for
  this phase. It needs no credentials and fetches every file in the build
  against the deployed URL, so an asset the store does not have fails on its
  content type rather than passing as a 200. The end-to-end simulation path
  stays covered by `scripts/smoke-check.sh` against the Cloud Run origin, which
  Phase 1 does not disturb. The Firebase smoke user is a Phase 3 dependency.
- The compatibility date is held at the newest the vitest-pool-workers runtime
  supports, so the Worker under test runs the same semantics it ships with.

### Phase 2 — data layer at the edge — complete

Hyperdrive with caching disabled, `scripts/migrate.ts` in CI, the `database.ts`
rewrite, the `QuotaCounter` Durable Object, and `/api/profile`,
`/api/accounts`, `/api/auth/sync-user` served at the edge. Unported paths still
proxy to Cloud Run.

Gate results:

- Ported routes match Cloud Run behavior by construction: both mount the same
  `src/api/data-routes.ts`.
- No `initialize()` on any request path.
- Schema floor checked once per isolate; the deployed schema is version 14.
- **Measured CPU per route.** `PUT /api/profile` in production: 3, 5, 6, 7 ms
  warm, and 20 ms on the first request into a cold isolate. Against the Workers
  Free ceiling of 10 ms per request, the cold path failed the gate.

The cold cost was entry-module evaluation, not request work. `wrangler check
startup` attributed it: the whole data subsystem ~15 ms, of which building the
domain schemas is ~8 ms and the schema library itself ~0. Each subsystem now
loads on first use, taking the entry to ~0 ms and a cold read to ~7.6 ms.
`scripts/check-edge-startup.mjs` keeps it that way.

Still true after the change: a cold *write* pays schema construction on top and
sits near the ceiling. Cloudflare tolerates infrequent overage and terminates
consistent overage, so this needs watching.

Both levers the plan originally named for that remaining cost were measured and
rejected:

- **`zod/mini` is not cheaper to construct.** On a schema of comparable shape it
  measured 3.1 ms against zod's 3.1 ms, inside the noise. It is a bundle-size
  optimization, not a startup one.
- **Splitting the schemas buys nothing.** Importing any single profile schema
  costs ~7 ms, essentially the whole module, because they share
  `profileBaseShape`. Tree-shaking already works; the shared base is the cost.

Neither `@/data/tax-brackets-2025` nor `@/domain/age` contributes measurably, so
the cost is the profile schema itself. Reducing it further means changing the
schema or the validation approach, not repackaging either. Do not spend time on
`zod/mini` for this.

Also unchanged and still the real ceiling: Hyperdrive's 100,000 queries/day on
the free plan, which binds well before the Worker request limit.

### Phase 3 — simulation at the edge — written, not deployed

Token minting with Cache API caching, the request-signal compatibility flags,
`/api/simulation/*` served at the edge behind a verified Firebase identity that
also has a row in the application `users` table, `cloudComputeEnabled` gated on
the same, and both client fixes.

Decisions taken during implementation:

- **The simulation routes are not shared with Cloud Run**, unlike the data
  routes. Phase 2 shared its routes because both mounts answer the same clients
  at the same time; here only one does. The origin's copy stays unauthenticated
  because it is the rollback target for browser bundles that predate this
  change, which send no token.
- **The Durable Object counts requests as well as paths**, so the planned
  `SIMULATION_LIMIT` rate-limit binding is not configured. The binding is
  per-colo, eventually consistent, and unweighted; using it for the request
  count and the Durable Object for paths would have meant two mechanisms and
  the weaker guarantee on one of them, for no saving.
- **The membership answer is cached per colo for 60 seconds**, keyed on the
  verified `uid`, and only when it is affirmative. The simulation path opens no
  database connection otherwise, and a plan refresh sends two requests; caching
  a miss would lock a new account out for the window after it signs up.
- **The token cache key carries the private key id and the audience**, so
  rotation invalidates without a purge. The audience is url-encoded into the
  key rather than hashed: it is not a secret, and encoding cannot collide.
- **`vitest.worker.config.ts` moved to the default TypeScript project.** It
  pulls in Vitest's optional jsdom types, whose `/// <reference lib="dom" />`
  was replacing workerd's globals in the one program that exists to model
  workerd — which is why `caches.default` did not typecheck.

Gate, and where each stands:

| | |
|---|---|
| the Rust service still refuses unauthenticated callers | unchanged; `allow_unauthenticated = false` |
| an aborted request cancels the upstream call | covered by test, needs the deployed flags to confirm |
| signed-out and unregistered requests never reach server simulation | covered by test |
| no key or token appears in logs or traces | by construction: the exchange reports status only |
| simulations succeed through the edge | **blocked on the key install** |
| the dedicated smoke account verifies the production path | **blocked on the smoke account** |

### Phase 4 — retire the origin

The deletion order above, then one Terraform commit and apply removing
`module.cloud_run`, the IAM member, `ORIGIN_SECRET`, and the dead variables,
landed with the `cloudbuild.yaml` web-step deletion.

Deleting the Cloud Run service removes the DNS rollback target. Run the full
acceptance suite immediately after Phase 3 and retain the last web container
image until a later cleanup so the service can be reconstructed if needed.

Gate: the full acceptance suite passes on `adamficke.dev`, then the web Cloud
Run service is removed. The acceptance suite includes the Free-tier exhaustion
behaviors below.

## Test plan

- `tests/middleware.test.ts` dies with the Node server. Replace with assertions
  against both an asset response and a Worker response.
- `tests/origin-auth.test.ts` and `tests/rate-limit.test.ts` delete with their
  modules.
- `tests/rust-service-client.test.ts:8` mocks `google-auth-library`; rewrite
  against the minter. Add coverage for token caching and rotation, which nothing
  tests today.
- `tests/api/*.test.ts` use `app.request()` under jsdom; once handlers read
  `c.env` they need `app.request(req, env)` or `@cloudflare/vitest-pool-workers`.
- `tests/integration/database.test.ts:23` survives only if the service keeps a
  connection-string entry point — another reason for the factory shape.
- `tests/contracts/wasm-native-parity.test.ts` is **unaffected**: it fetches
  `RUST_SERVICE_URL` directly and loads the Wasm from disk. Do not port it.
- `tests/e2e/smoke.spec.ts` asserts the Wasm MIME type against the Vite dev
  server, so it cannot guard `_headers`. Add a second Playwright project with a
  deployed baseURL.
- `smoke.spec.ts:57` relies on `/api/*` failing at the proxy so the client falls
  back to local Wasm. Under the plugin the Worker answers `/api/*` with 5xx —
  confirm the client falls back on 5xx, not only on network error.
- The `docker compose` end-to-end job (`test.yml:415`) dies with the web
  `Dockerfile`. Replace it with a `vite dev` job against a Neon branch *before*
  deleting it.

## Risks

**The 10 ms CPU ceiling on Workers Free.** Every API request now runs JSON
parsing, Zod validation, and RS256 verification inside that budget; the combined
sensitivity batch carrying many full plans is the worst case. Measured in Phase
2. Workers Paid raises it to 30 seconds by default and costs $5/month, but is
not an approved automatic fallback. Ported routes remain able to proxy to the
web Cloud Run service during migration; a route that cannot meet the Free limit
does not move until the owner explicitly chooses a different design or plan.

**Hyperdrive's 100,000 queries/day free cap** binds before the Worker request
limit does, and caching-disabled means every statement counts.

**The service-account key** is a long-lived credential replacing a keyless
metadata identity, scoped to one service, with a rotation runbook above.

**Cloudflare account compromise now yields everything** — database, GCP key,
invite codes, and arbitrary JavaScript served to every user. Previously it
yielded proxy control. Require hardware 2FA and a deploy token scoped to Workers
Scripts:Edit.

**Log redaction.** `observability.logs.head_sampling_rate: 1` over handlers that
`console.error(error)` on `pg` failures means statement text — balances, birth
dates, emails — can reach Workers Logs. Log `error.message`, never the error
object, and never a query.

**Neon exposure.** Hyperdrive connects from Cloudflare's published IP ranges, so
a database firewall allowlist is still possible — but those ranges are shared by
every Cloudflare customer, so the allowlist is only a secondary control. The
password remains the real control. Note also that any Worker in the account
bound to that Hyperdrive id reaches the database with no credential of its own.

**Observability loss.** Cloud Run request logs, latency and error metrics, and
the `gcloud run services logs read` runbook all go away. Workers Logs on the free
plan has short retention, no Logpush, and no alerting.

### Free-tier exhaustion behavior

Workers Free allows 100,000 Worker requests per day and Hyperdrive allows
100,000 database statements per day; both reset at 00:00 UTC. These are hard
limits, not triggers for a billing change.

- Static assets bypass the Worker and remain available if the Worker request
  allowance is exhausted.
- Cloudflare returns error 1027 before Worker code runs when the Worker request
  allowance is exhausted, so the application must treat an unstructured edge
  failure as temporary API unavailability and transition to LOCAL mode.
- LOCAL fallback is fully functional: the cached plan remains editable in
  localStorage and simulations use the local Wasm engine.
- Hyperdrive limit errors are normalized to a retryable `503` that triggers the
  same LOCAL fallback; they must not be reported as authentication or revision
  conflicts.
- The fallback is sticky. Recovery never reloads a cloud copy over local edits
  automatically. Returning to CLOUD mode requires an explicit reconciliation
  action. The local plan is pushed to cloud unless the cloud revision changed;
  a revision change stops reconciliation and surfaces a conflict instead of
  overwriting either copy.
- Log `cloud_fallback_activated` once per transition, plus
  `cloud_reconnect_succeeded` or `cloud_reconnect_conflict` after an explicit
  recovery attempt through the existing Google Analytics event wrapper. Include
  only a coarse reason category; never add plan fields, account data, Firebase
  IDs, email addresses, or request contents as event parameters. The existing
  Analytics setup associates signed-in events with its configured user ID; this
  decision does not change that behavior. Do not build a deferred telemetry
  queue: if Analytics is blocked or the browser is offline, losing a diagnostic
  event is acceptable. Local storage holds only the sticky fallback state
  needed for application behavior.
- Worker request, error, CPU, and Hyperdrive query counts are available through
  Cloudflare analytics and the GraphQL API. Review their daily totals before
  retiring Cloud Run and document the query in the operations runbook.
- If legitimate demand approaches a daily limit, stop and explicitly choose
  between Workers Paid and a revised architecture. No workflow changes the
  account plan or billing automatically.

## Follow-ups

**Cross-origin isolation and Wasm threads.** `simulation-architecture.md`
rejected shared-memory threads because isolation would break authentication
popups. Authentication currently uses email and password, but
`public/analytics-bootstrap.js` injects Google Analytics from
`googletagmanager.com`, so the earlier claim that the app has no cross-origin
subresources is false. Treat Analytics compatibility as an unresolved blocker
before adding `COEP: require-corp`; do not fold isolation into this migration.
If revisited, ship headers report-only first and separately account for future
popup-based OAuth.

**Compute default.** `useServerSideCalculations` defaults to `true`. Once native
and Wasm 5,000-path latency are measured side by side, revisit.

**Batch payload shape.** Sending one full plan per sensitivity point is the
largest CPU input the Worker will see. One plan plus lever deltas would cut it
substantially and directly relieve the 10 ms risk.

**Two Durable Object round trips per simulation.** The request budget and the
path budget are separate `consume` calls, and the second cannot be made until
the body has been validated for its path count. Both are wall time, not CPU, so
neither counts against the free plan's ceiling; at this traffic the exactness is
worth more than the hop. Combining them would mean a batched `consume` on the
shared limiter interface, which the signup path does not need.

**The Firebase JWKS is cached only in jose's per-isolate memory.** No KV, which
is the property that mattered — a JWKS anyone with an account API token could
overwrite is universal ID-token forgery. But a cold isolate refetches it, so
every cold authenticated request pays one extra subrequest. A Cache API entry
would make that per-colo instead of per-isolate.

**SPA fallback changes 404 semantics.** It enables direct loads of application
page routes, but unknown non-API paths also return the shell at 200 before React
renders its Not Found view. `/api/*` keeps real JSON 404 responses.

## Review corrections

Changes the red team forced, recorded so the reasoning is not re-litigated:

- Phase ordering reworked. Probe route and `allow_unauthenticated` now precede
  origin-auth deletion; the Cloud Build web steps die in the same change.
- Phase 1 now serves HTML **and** assets from the edge together, eliminating the
  two-pipeline bundle-skew window.
- Preview URLs were originally enabled for pre-traffic smoke testing. The
  2026-09-01 simplification removes them because the site has effectively no
  traffic and Durable Object Workers do not receive preview URLs.
- The weighted path quota is reinstated as a Durable Object. The zone WAF rule
  it was to be traded against has never been enabled.
- Token and JWKS caching moved from KV to the Cache API. KV is readable through
  the dashboard and account API.
- The key bootstrap command was rewritten; the original silently swallowed
  failures and raced three Worker versions.
- `enable_request_signal` and `request_signal_passthrough` added; without them
  cancellation is silently dead.
- `lib/rate-limit.ts` identified as unable to start at all under workerd.
- `assets.directory` removed from input config; `_headers` authored in `public/`.
- `X-Content-Type-Options: nosniff` restored; `connect-src` kept as a wildcard.
- `statement_timeout`, client lifetime, and the transaction rewrite added to the
  data-layer work.
- `scripts/migrate.mjs` became `scripts/migrate.ts`; expand/contract and schema
  floor rules added.
- Cost framing corrected: this is not a cost migration.

One review finding was **rejected**: that Hyperdrive forecloses Neon IP
allowlisting. Cloudflare documents that Hyperdrive connects from its published
IP ranges specifically so database firewalls can restrict to them. The
allowlist is weak for the reason given under Risks, but it is available.

## Decision log

- 2026-08-24: Keep the Rust simulation service on Cloud Run. Cloudflare
  Containers are Workers Paid only.
- 2026-08-24: Authenticate with a Worker-minted OIDC token from a
  service-account key, not a shared origin secret. IAM keeps Google's front end
  rejecting forged requests before an 8-vCPU container starts.
- 2026-09-01: Reconfirm the narrowly scoped service-account key after reviewing
  Google's current external Cloud Run authentication guidance. Cloudflare
  Workers provide no ambient identity that Google can federate directly, and a
  Cloudflare Access token broker would replace one long-lived credential with
  another while adding an extra authentication system.
- 2026-08-24: Create the service-account key outside Terraform.
- 2026-08-24: Cache the token and the JWKS in the Cache API, never KV.
- 2026-08-24: One Worker with static assets and the Vite plugin.
- 2026-08-24: Hyperdrive with query caching disabled, accepting the
  100,000 queries/day free cap as the binding constraint.
- 2026-08-24: Keep `pg` over Hyperdrive rather than the Neon HTTP driver;
  interactive transactions with advisory locks are required.
- 2026-08-24: Move schema migrations into the deploy pipeline, expand/contract
  only, with a runtime schema floor.
- 2026-08-24: Keep a weighted path quota, implemented as a Durable Object.
- 2026-08-24: Target `placement.region` at Neon (`aws:us-east-1`), not Cloud Run.
- 2026-09-01: Deploy directly and smoke-test `adamficke.dev`; do not maintain a
  preview or gradual-deployment path for a site with effectively no traffic.
- 2026-09-01: Retire the web Cloud Run service after the production acceptance
  suite passes, while retaining its last container image for reconstruction.
- 2026-09-01: Workers Free is the approved operating tier. If a route cannot fit
  its CPU allowance or legitimate demand approaches a daily limit, keep or move
  the route outside Workers and stop for an explicit architecture and billing
  decision. No automated upgrade is permitted.
- 2026-09-01: A Free-tier or cloud API outage transitions the application to a
  fully editable LOCAL mode with local Wasm simulation. The fallback is sticky;
  cloud recovery cannot silently overwrite changes made locally.
- 2026-09-01: Explicit cloud reconnection uses the local plan as the proposed
  source, but stops on a changed cloud revision. Log each fallback transition
  and reconciliation outcome once through the existing Google Analytics event
  wrapper, without a retry queue or sensitive event parameters; existing
  Analytics user association is unchanged.
- 2026-09-01: Require a registered application account, not only a valid
  Firebase identity, for server simulations. Signed-out or unregistered users
  always use local Wasm, application quotas key on a verified application
  user's `uid`, and the zone WAF remains the coarse IP-based pre-authentication
  shield.
- 2026-09-01: No signup invite codes have been distributed. Generate a fresh
  high-entropy code when installing the Worker secret rather than migrating the
  current value.
- 2026-09-01: Give the four primary application pages stable paths under a
  nested layout. Accept the static SPA fallback's HTTP 200 for unknown page
  paths; API routes retain proper 404 responses.
- 2026-09-01: Cap the Rust service at two instances. Measured worst-envelope
  warm headline compute is 240-306 ms and a 31,000-path summary batch 1.23-1.29 s,
  against 30-day demand of 479 requests, a 124/day maximum, and p95 latency of
  1.05 s. Two concurrent CPU-bound requests exceed observed load while bounding
  worst-case 8-vCPU fleet spend.
- 2026-09-01: Reach the Cloudflare zone by ID rather than a `cloudflare_zone`
  data source, so the drift gate can plan from stored state without giving
  Cloud Build Cloudflare credentials.
- 2026-09-01: Gate the Cloudflare Vite plugin behind `EDGE_BUILD` rather than
  letting it own every build. The Cloud Run container serves the flat `dist/`
  and is the DNS rollback target until Phase 4, so it must keep serving a
  working SPA.
- 2026-09-01: Verify deployed assets with a credential-free check over the
  build's own file list instead of rewriting the smoke check in Phase 1. The
  Firebase smoke user the rewrite needs is a Phase 3 dependency, and the
  end-to-end simulation path is still covered against the Cloud Run origin.
- 2026-09-01: Create least-privilege database roles with SQL, not Neon's
  Console, CLI, or API. Every role those interfaces create is granted
  `neon_superuser`, which carries CREATEDB, CREATEROLE, BYPASSRLS, and
  `pg_write_all_data` — an API-created Worker role has full DDL and the split
  buys nothing. The migration role is the exception and is created through the
  API precisely because it needs those rights.
- 2026-09-01: Let Wrangler own the Hyperdrive configuration rather than
  Terraform, reversing the earlier plan. The configuration embeds the database
  password, and Terraform state lives in a GCS bucket Cloud Build can read, so
  Terraform ownership would widen the credential's blast radius to buy drift
  detection on one resource. Recreation is a single documented command in
  `wrangler.jsonc`.
- 2026-09-02: Do not share the simulation routes between the Worker and Cloud
  Run. Only one of them answers a given deployment, and the origin's copy must
  stay unauthenticated to remain a rollback target for browser bundles that
  send no token.
- 2026-09-02: Count simulation requests in the Durable Object too, and do not
  configure the `SIMULATION_LIMIT` rate-limit binding. Two mechanisms, one of
  them per-colo and eventually consistent, buys nothing over the one that is
  already exact and global.
- 2026-09-02: Cache the membership answer per colo for 60 seconds, affirmative
  answers only. The simulation path opens no database connection otherwise, and
  caching a miss would lock a new account out for the window after signup.
- 2026-09-02: Hold the production simulation smoke check behind
  `EDGE_SMOKE_ENABLED` until the Firebase smoke account exists, rather than
  shipping a deploy step that fails on a secret nobody has set.
- 2026-09-01: Load each Worker subsystem on first use rather than at startup.
  A Worker charges global-scope evaluation to whichever request warms the
  isolate, and on the free plan that request has 10 ms of CPU. Measurement, not
  intuition, chose the target: schema construction costs ~8 ms while RS256
  token verification costs 0.033 ms, so the planned verified-token cache was
  discarded and the module graph was split instead.
