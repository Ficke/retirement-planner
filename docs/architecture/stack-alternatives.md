# Stack alternatives

Reference for why the edge and frontend layers are shaped the way they are, and
what the exits look like. Recorded so these questions are answered once rather
than re-derived.

## Why a Worker sits in front of Cloud Run

Cloud Run routes by `Host` header and rejects hostnames it does not recognize.
A Cloudflare-proxied DNS record sends `Host: adamficke.dev`, which Cloud Run
will not serve. Overriding the `Host` header is the normal fix, and it is an
Enterprise-only feature:

| Origin Rules override | Free | Pro | Business | Enterprise |
| --------------------- | ---- | --- | -------- | ---------- |
| Host header           | No   | No  | No       | Yes        |
| SNI                   | No   | No  | No       | Yes        |
| DNS record            | No   | No  | No       | Yes        |
| Destination port      | Yes  | Yes | Yes      | Yes        |

The Worker is the free-plan substitute for that feature. It rewrites `Host`,
attaches the origin secret, and streams the response.

Cloud Run must therefore stay publicly reachable: a Worker is an identity-less
caller on the public internet, so it cannot present the Google-signed OIDC token
that `--no-allow-unauthenticated` requires, and
`ingress=internal-and-cloud-load-balancing` would block it along with everyone
else. The origin secret is the compensating control. The Rust service, whose
caller is another Cloud Run service, uses IAM instead — where IAM is available,
this project uses it.

## Alternatives to the Worker proxy

| Approach                   | Cost          | Why not today                                             |
| -------------------------- | ------------- | --------------------------------------------------------- |
| Google Cloud Load Balancer | ~$18–25/month | Accepts any `Host`, allows LB-only ingress, supports mTLS |
| Cloudflare Tunnel          | Free          | Needs a persistent connection, so `min-instances` ≥ 1     |
| Cloudflare Enterprise      | Enterprise    | Host header override removes the need for a Worker        |
| Cloud Run domain mapping   | Free          | Removes Cloudflare from the request path entirely         |
| Static SPA on Cloudflare   | Free          | Removes the seam for everything except API calls          |

The load balancer is what businesses running this stack normally use. It
dissolves the problem rather than working around it: `Host` stops mattering,
Cloud Run becomes unreachable from the internet, Cloud Armor enforces WAF and
rate limiting ahead of any compute, and mTLS becomes possible so the edge can be
authenticated cryptographically instead of with a shared secret. The only reason
it is not used here is that it costs roughly the entire hosting budget of a
personal project.

Note that allowlisting Cloudflare's IP ranges is not an origin control on its
own. Any Cloudflare customer's traffic arrives from those same addresses, so a
secret or a client certificate is what distinguishes this zone from any other.

## Frontend

The web app is a Vite-built, client-rendered React SPA with a Hono
backend-for-frontend. The previous Next.js runtime supplied no meaningful
server rendering, so the migration removed framework server components while
preserving React, Radix, Recharts, TanStack Table, Zustand, and Web Worker
orchestration. Hono serves the production SPA and owns API routing, origin
authentication, security headers, and the private Rust proxy.

The Worker proxy remains necessary for API calls and for keeping the Cloud Run
origin behind the shared-secret control. It also serves the SPA so browser
history routes and API requests stay on one origin. Hashed Vite assets under
`/assets/` receive immutable edge caching.

The Rust simulation core is compiled to WebAssembly for local execution in
ordinary Workers. Sensitivity paths are sharded across Workers rather than
using shared-memory Wasm threads, so Firebase Auth popups remain compatible and
the app does not require cross-origin isolation.

## Open follow-ups

- `min_instances = 0` means most visits pay a Node/Hono cold start. This
  costs more perceived performance than any framework choice.
- The Worker strips `cf-*`, `x-forwarded-*`, `host`, `x-retire-plan-*`, and
  framework-internal `x-middleware-*` headers before adding its trusted origin
  and client-address headers.
- Recharts renders SVG. A simulation view plotting many paths or percentile
  bands can produce thousands of DOM nodes, which is the likeliest cause if any
  chart feels slow while scrubbing or resizing.
- Static assets currently traverse the Worker and count against the 100,000
  request daily cap. Serving them from Cloudflare Pages or R2 would remove the
  busiest request class from that budget.
