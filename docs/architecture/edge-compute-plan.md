# Edge compute migration plan

Status: proposed, not approved
Last updated: 2026-08-24
Working branch: `edge-compute`

## Objective

Move the web tier off Cloud Run and into the Cloudflare Worker. Static assets
serve from Cloudflare's asset store, the Hono API runs at the edge, Neon is
reached through Hyperdrive, and the Rust simulation service stays on Cloud Run,
invoked with a Google-signed OIDC token that the Worker mints itself.

The result retires the web Cloud Run service, its container image, its half of
the Cloud Build pipeline, and the entire origin-secret apparatus.

## Non-goals

- Retiring the Rust simulation service. It stays, IAM-authenticated.
- Browser Wasm threading and cross-origin isolation. Newly viable — the app has
  no popups — but a separate project. See [Follow-ups](#follow-ups).
- Migrating Firebase Authentication or Neon.
- Changing simulation semantics, seeds, or the shared Rust core.

## Target request path

```text
Browser
  -> Cloudflare DNS / TLS / WAF / zone rate limit
  -> retire-plan-edge Worker
       |- static assets            served without invoking the Worker
       `- /api/*                   Hono
                                     |- Hyperdrive -> Neon Postgres
                                     |- Firebase JWKS verification (jose)
                                     `- OIDC ID token
                                          -> Rust Cloud Run service (private)
```

Nothing in this path is publicly reachable except the Worker. The Rust service
keeps `allow_unauthenticated = false`, so Google's front end rejects forged
requests before a container starts.

## Repository shape

One Worker, one Vite build, using `@cloudflare/vite-plugin`. `apps/edge-proxy`
merges into `apps/web`.

The proxy Worker exists only to reach Cloud Run. Once Hono runs at the edge,
two Workers would mean a service-binding hop and two deployment paths for one
application. The Vite plugin also runs the Worker in `workerd` during `vite
dev`, which is closer to production than today's `concurrently` split between a
Vite client and a `tsx` Node server.

```text
apps/web/
  src/client/          React SPA, unchanged
  src/worker/          Hono app, moved from src/server
  src/wasm/            generated Wasm package, unchanged
  vite.config.ts       cloudflare() plugin
  wrangler.jsonc
scripts/migrate.mjs    schema migrations, run by CI before deploy
```

Deleted: `apps/edge-proxy/`, `apps/web/tsup.config.ts`, the web `Dockerfile`,
`dist-server/`, and the web half of `cloudbuild.yaml`.

Rejected: keeping `apps/edge-proxy` as a separate Worker with a service binding
to an API Worker. It buys no isolation at this size and costs an extra
invocation and an extra deploy.

## Wrangler configuration

```jsonc
{
  "name": "retire-plan-edge",
  "main": "./src/worker/index.ts",
  "compatibility_date": "2026-08-24",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": false,
  "preview_urls": false,

  "assets": {
    "directory": "./dist/client",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },

  "placement": { "region": "<neon region, e.g. aws:us-east-2>" },

  "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "<id>" }],
  "kv_namespaces": [{ "binding": "TOKEN_CACHE", "id": "<id>" }],

  "ratelimits": [
    { "name": "SIMULATION_LIMIT", "namespace_id": "1001",
      "simple": { "limit": 300, "period": 60 } },
    { "name": "INVITE_LIMIT", "namespace_id": "1002",
      "simple": { "limit": 10, "period": 60 } }
  ],

  "secrets": {
    "required": [
      "GCP_SA_CLIENT_EMAIL",
      "GCP_SA_PRIVATE_KEY",
      "GCP_SA_PRIVATE_KEY_ID",
      "SIGNUP_INVITE_CODES"
    ]
  },

  "observability": {
    "enabled": true,
    "logs": { "enabled": true, "head_sampling_rate": 1 },
    "traces": { "enabled": true, "head_sampling_rate": 0.1 }
  }
}
```

`run_worker_first` lists only `/api/*`. Setting it to `true` would route every
request through the Worker, putting HTML and assets back on the metered path —
and past the free daily limit those requests return `429` instead of falling
back to the asset store.

`placement.region` targets Neon, not Cloud Run. The profile and account
handlers issue several sequential queries per request, where placement turns
20–30 ms round trips into 1–3 ms. The simulation handlers issue one subrequest,
where placement changes nothing.

## Static assets

Vite's `dist/client` uploads with the Worker. Asset requests are free,
unlimited, and never invoke the Worker, which removes the busiest request class
from the 100,000/day free allowance — the availability risk recorded in
`cloudflare-migration-plan.md`.

The default asset header is `Cache-Control: public, max-age=0,
must-revalidate`, so a `_headers` file in the assets directory restores what
Hono sets today:

```text
/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

Content types come from file extensions at upload, so `.wasm` is served as
`application/wasm` and stays eligible for streaming compilation. The existing
browser test that asserts the Wasm MIME type is the guard; point it at the
deployed URL.

The Worker's hand-written Cache API path for `/assets/*` is deleted. The asset
store handles caching, including tiered cache.

## Security headers

`secureHeaders()` currently runs as Hono middleware, which only covers
Worker-served responses. HTML now comes from the asset store, so document-level
headers move to `_headers`:

```text
/*
  Content-Security-Policy: ...
  Cross-Origin-Opener-Policy: same-origin
  Referrer-Policy: strict-origin-when-cross-origin
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
```

Two CSP changes fall out of the migration:

- `connect-src` no longer needs the Cloud Run origin, but does need
  `https://identitytoolkit.googleapis.com` and `https://securetoken.googleapis.com`
  explicitly rather than the current `https://*.googleapis.com` wildcard.
- `frame-src https://*.firebaseapp.com` can go. Nothing loads that iframe; the
  app uses email/password authentication only.

`same-origin-allow-popups` becomes plain `same-origin` for the same reason.
Keep the API's own headers in Hono so JSON responses are covered too.

## Database access

### Hyperdrive with query caching disabled

This is the trap in this migration. Hyperdrive caches read queries by default
for 60 seconds and **does not invalidate on write**. This application saves a
profile and immediately reads it back, and it uses an optimistic-concurrency
`revision` column that raises `ProfileRevisionConflictError` on mismatch. A
stale cached read produces spurious `409`s and apparent lost writes.

Create the configuration with `--caching-disabled`. Connection pooling and fast
connection setup — the actual reasons to use Hyperdrive here — still apply.

### Per-request client, no pooling in the Worker

`PostgreSQLConnection` holds a `pg.Pool` in a module-global singleton. That
model does not survive in an isolate. Replace it with a `pg.Client` constructed
per request against `env.HYPERDRIVE.connectionString`; Hyperdrive owns the pool.

Free-plan Hyperdrive allows roughly 20 origin connections and a 60-second
maximum statement duration, both comfortably above this workload.

### Migrations move out of the request path

`getUnifiedDatabaseService().initialize()` runs `SELECT 1`, takes an advisory
lock, and executes the migration transaction on first use. On Cloud Run that is
once per container. In a Worker, module-global state lives and dies with the
isolate, so this would run DDL from the request path on many requests — extra
round trips, lock contention, and schema changes driven by user traffic.

Extract `DATABASE_MIGRATIONS` into `scripts/migrate.mjs`, run it in CI against
`DATABASE_URL` before `wrangler deploy`, and delete `initialize()`,
`ensureInitialized()`, and `migrate()` from the request path. The advisory lock
stays — it now serializes concurrent deploys instead of concurrent cold starts.

This is a prerequisite, not a nice-to-have: without it the first request after
every idle period pays a migration round trip.

## Authenticating to the Rust service

The Worker mints a Google-signed OIDC ID token with a service-account key and
the JWT-bearer grant. Cloud Run validates it exactly as it validates today's
metadata-server token, so nothing changes on the GCP side.

### GCP setup

A dedicated service account, `edge-invoker@<project>`, holding `roles/run.invoker`
on the Rust service and nothing else. It replaces the
`google_cloud_run_v2_service_iam_member.web_invokes_rust` binding, which goes
away with the web Cloud Run service.

**Do not create the key with `google_service_account_key`.** Terraform would
write the private key into the GCS state bucket in plaintext. Create it
out-of-band and pipe it straight into Wrangler so it never touches disk:

```sh
gcloud iam service-accounts keys create /dev/stdout \
  --iam-account="edge-invoker@${PROJECT}.iam.gserviceaccount.com" \
  | tee >(jq -r .private_key   | wrangler secret put GCP_SA_PRIVATE_KEY) \
        >(jq -r .client_email  | wrangler secret put GCP_SA_CLIENT_EMAIL) \
        >(jq -r .private_key_id| wrangler secret put GCP_SA_PRIVATE_KEY_ID) \
  > /dev/null
```

Terraform manages the service account and the IAM binding, and records in a
comment that the key is deliberately outside its control.

### Token minting

```text
JWT header   { alg: "RS256", typ: "JWT", kid: <private_key_id> }
JWT claims   { iss: <client_email>,
               sub: <client_email>,
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

The PEM is stripped of its armor and base64-decoded to DER in the Worker. No
dependency is required.

`target_audience` must equal the Cloud Run service URL with no trailing slash —
the same value `getIdTokenClient(serviceUrl)` uses today.

### Token caching

Two tiers. A module-global memo serves the hot isolate. KV serves cold isolates,
which at this traffic level are the common case, and turns a per-cold-start
token exchange into a KV read.

- Cache for 55 minutes against a 60-minute lifetime.
- Add jitter to the refresh threshold so isolates do not all re-mint together.
- One write per hour is 24/day against a 1,000/day free write budget.
- KV's ~60 second eventual consistency is immaterial at this TTL.
- Never log the token, the assertion, or the key.

The Cache API is a viable alternative with no write quota at all, at the cost
of one exchange per colo per hour. KV is chosen for simplicity.

### Blast radius

The key can do exactly one thing: invoke one Cloud Run service. It is still a
long-lived credential and is the weakest point in this design. Rotate it on a
schedule. If an org policy later forbids service-account keys, Workload
Identity Federation drops in behind the same `getAuthorizationHeader()` seam at
the cost of two round trips on a cache miss.

All of this stays inside `lib/rust-service-client.ts`. Its existing shape —
`requiresIdToken()`, a cached client keyed by service URL, and
`RustServiceUnavailableError` — already models this exactly.

## Rate limiting

| Today | Replacement | Guarantee |
|---|---|---|
| 300 req/min per IP (`SIMULATION_RATE_LIMIT`) | `SIMULATION_LIMIT` binding, 300 / 60s | Per-colo, eventually consistent |
| 10 per hour per IP (`INVITE_RATE_LIMIT`) | `INVITE_LIMIT` binding, 10 / 60s | Window shortened — see below |
| 2,000,000 paths/min per IP (`SIMULATION_PATH_RATE_LIMIT`) | Dropped | Per-request clamps remain |
| Zone WAF rule on `/api/simulation/*` | Unchanged | Global, exact |

The binding accepts periods of 10 or 60 seconds only, is enforced per Cloudflare
location, and has no notion of weighted cost. Three consequences:

**The hour-long invite window cannot be expressed.** A 10-per-60s limit is
stricter against bursts and much weaker against slow sustained guessing
(600/hour versus 10). The real defense is invite-code entropy plus the fixed
code list; the limiter is a speed bump. If sustained guessing ever appears, a
SQLite-backed Durable Object gives an exact hour window and is free on the
Workers Free plan — roughly forty lines, one namespace.

**The weighted path quota disappears.** Nothing in the binding expresses "2
million paths per minute." Per-request clamps in `lib/simulation-request.ts`
(`MAX_BATCH_SIMULATIONS`, `MAX_BATCH_TOTAL_PATHS`, per-config path caps) still
bound the cost of any single request, and the request-rate limit bounds
frequency, so total cost stays bounded — just less precisely. Record this as a
deliberate reduction rather than an oversight.

**Per-colo means the effective global limit is higher** than the configured
number. Acceptable for a backstop layered under the zone WAF rule.

Cloudflare's own guidance warns against keying on IP addresses. Keep IP keys for
the anonymous simulation endpoints, which have no better identifier, and key the
authenticated endpoints on the Firebase `uid` instead.

## What gets deleted

The origin-security layer exists solely because a Worker had to prove itself to
a public Cloud Run service. With no web origin, all of it goes:

- `ORIGIN_SECRET`, `ORIGIN_SECRET_PREVIOUS`, and the rotation runbook
- `lib/origin-auth.ts` and its Hono middleware
- Request header stripping and the `x-retire-plan-*` forwarding headers
- Response header scrubbing and origin redirect rewriting
- The `/api/internal/` block and the `/api/internal/simulation-probe` route
- The `/healthz` origin-auth exemption and the route itself
- `google-auth-library`, `@hono/node-server`, and `tsup`

`cf-connecting-ip` is read directly. There is no hop to distrust.

## Infrastructure ownership

The existing split holds: Terraform owns stable infrastructure, Wrangler owns
code and secrets.

Terraform gains `cloudflare_hyperdrive_config` and
`cloudflare_workers_kv_namespace`, plus the `edge-invoker` service account and
its `run.invoker` binding on the GCP side. The Hyperdrive password is a
write-only field; confirm the provider version handles it without persisting the
value in state before applying.

Terraform loses `module.cloud_run`, the web service account, the
`web_invokes_rust` binding, and the `ORIGIN_SECRET` secrets.

Wrangler keeps the Worker code, bindings, assets, secrets, versions, and
observability. The `secrets.required` block makes a missing secret a deploy
failure rather than a runtime `500`.

## Delivery

- Rust service: Cloud Build → Artifact Registry → Cloud Run, unchanged, minus
  the web build and deploy steps.
- Web: GitHub Actions runs `scripts/migrate.mjs`, then `wrangler deploy`.
  Migrations must succeed before the Worker that depends on them goes live.
- Gradual deployment: use `wrangler versions upload` plus `versions deploy` for
  the cutover phases so a bad version rolls back without a rebuild.

## Phases

Each phase ships independently and reverts on its own.

### Phase A — assets at the edge

Add `assets` to the existing Worker, serving `apps/web/dist`. Keep proxying
`/api/*` and HTML to Cloud Run unchanged. Add `_headers`.

Highest value for the effort: cold starts leave the HTML and asset path, and the
free-tier request cliff disappears. Reverts by deleting the `assets` block.

Gate: assets serve from the edge with correct types and immutable caching; the
Wasm MIME test passes against the deployed URL; the app is unchanged otherwise.

### Phase B — API at the edge

Move `src/server` to `src/worker`, adopt `@cloudflare/vite-plugin`, and port
route groups one at a time. Unported paths keep proxying to Cloud Run, so the
cutover is incremental rather than a single switch.

Order: `/api/profile` and `/api/accounts` first, since they exercise Hyperdrive
and Firebase verification together; `/api/auth/sync-user` next; the simulation
routes last, because they depend on Phase C.

Prerequisites: `scripts/migrate.mjs` extracted and running in CI; Hyperdrive
created with caching disabled; the `pg.Pool` singleton replaced.

Gate: every ported route matches Cloud Run behavior including error codes;
`initialize()` no longer appears in any request path; measured CPU time per
request is recorded (see [Risks](#risks)).

### Phase C — Rust service authentication

Implement token minting and caching behind `getAuthorizationHeader()`. Move the
simulation routes. Delete the origin-secret apparatus.

Gate: simulations succeed through the edge; the Rust service still refuses
unauthenticated callers; no key or token appears in logs or traces.

### Phase D — retire the web origin

Delete the web Cloud Run service, its Artifact Registry image, the web
`Dockerfile`, `tsup`, and the web half of `cloudbuild.yaml`. Remove the
`ORIGIN_SECRET` secrets from Secret Manager after confirming nothing reads them.

Gate: the full acceptance suite passes on `adamficke.dev`; no Cloud Run web
revision receives traffic for a full observation window before deletion.

## Risks

**The 10 ms CPU ceiling on Workers Free is the real constraint.** Every API
request now runs JSON parsing, Zod validation, and RS256 JWT verification inside
that budget. A batch simulation carrying 25 full plans is the worst case. Measure
CPU time per route during Phase B before committing to the free plan. Workers
Paid is $5/month and raises the ceiling to 30 seconds by default; that is the
escape hatch, and it is cheaper than the Cloud Run service it replaces.

**Hyperdrive query caching defaults to on.** Shipping without
`--caching-disabled` produces stale reads and spurious revision conflicts.
Verify the configuration before the first write path goes live.

**The service-account key is a long-lived credential** in a Worker secret,
replacing a keyless metadata identity. Scoped to one service, but it needs a
rotation schedule.

**KV write budget.** 1,000/day free. The design writes once per hour. Any future
per-request KV write breaks this.

**Free-plan Worker size is 3 MB compressed.** Hono, `pg`, `jose`, and Zod fit
comfortably; the Wasm binary is a static asset and does not count. Re-check if
dependencies grow.

## Follow-ups

**Cross-origin isolation and Wasm threads.** `simulation-architecture.md`
rejected shared-memory threads because isolation would break authentication
popups. The app has no popups — `lib/firebase/auth.ts` uses email and password
only — and no cross-origin subresources: fonts and the Firebase SDK are bundled,
`index.html` loads no external script, and `getAnalytics()` is never called. So
`COOP: same-origin` with `COEP: require-corp` appears satisfiable today, which
would give `crossOriginIsolated` and unlock `wasm-bindgen-rayon` for the
headline 5,000-path run. Ship the headers report-only first. Note that this
forecloses popup-based OAuth: `COOP: restrict-properties`, which would have
allowed both, was put on hold by Chrome in April 2025 and ships nowhere. The
exit is redirect-based sign-in with `/__/auth/*` proxied through the Worker to
`<project>.firebaseapp.com`, which is Google's own recommendation for browsers
that partition storage and is trivial in a Worker.

**Compute default.** `useServerSideCalculations` defaults to `true`, so most
headline runs still cross the network. Once native and Wasm 5,000-path latency
are measured side by side, revisit whether local should be the default with
cloud as an opt-in.

**Batch payload shape.** Sending 25 full plans per sweep is the largest CPU
input the Worker will see. Sending one plan plus lever deltas would cut it
substantially and directly relieves the 10 ms risk above.

## Decision log

- 2026-08-24: Keep the Rust simulation service on Cloud Run rather than
  retiring it or moving it to Cloudflare Containers, which are Workers Paid only.
- 2026-08-24: Authenticate to it with a Worker-minted OIDC token from a
  service-account key, not a shared origin secret. IAM keeps Google's front end
  rejecting forged requests before an 8-vCPU container starts.
- 2026-08-24: Create the service-account key outside Terraform so the private
  key never enters remote state.
- 2026-08-24: One Worker with static assets and the Vite plugin, rather than a
  separate proxy Worker and API Worker joined by a service binding.
- 2026-08-24: Hyperdrive with query caching disabled. Read-after-write
  correctness outweighs cached-read latency for this workload.
- 2026-08-24: Move schema migrations into the deploy pipeline. Isolate lifetime
  makes first-use migration unsafe at the edge.
- 2026-08-24: Replace the weighted path quota with per-request clamps plus a
  request-rate limit, accepting a less precise bound.
- 2026-08-24: Target `placement.region` at Neon rather than Cloud Run. Sequential
  queries dominate; the simulation subrequest is single.
