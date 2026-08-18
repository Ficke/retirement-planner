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

The web app is a client-rendered SPA with a thin backend-for-frontend: 14 files
under `app/`, six API routes, and a `'use client'` root page. Server rendering
is not meaningfully used.

Next.js is oversized for that shape and is still the right choice, because
"reliable" means predictable and well-supported rather than minimal. React is
load-bearing for a different reason: 30 components, shadcn/ui, six Radix
primitives, Recharts, TanStack Table, and Zustand are all React-bound. Radix in
particular supplies keyboard navigation, focus management, and ARIA semantics
that younger ecosystems have not matched.

Vite plus a static SPA is the architecturally cleaner fit, and would delete the
Host-header problem, the Worker proxy, and the origin secret for everything but
API calls. The engine and Monte Carlo worker carry no React or Next.js imports,
so they port unchanged, and Vite's Web Worker support is better than Next.js's.
The costs are rehoming the six API routes, losing server rendering, and the
ordinary risk of rewriting working software. Worth revisiting only alongside a
significant UI overhaul.

Compiling the Rust engine to WebAssembly would collapse the two-engine
maintenance burden into one and make the server optional rather than merely
skippable. Threaded WebAssembly requires cross-origin isolation headers, which
break Firebase Auth popup flows, so it would force redirect-based sign-in.

## Open follow-ups

- `min_instances = 0` means most visits pay a full Node and Next.js boot. This
  costs more perceived performance than any framework choice.
- The Worker strips `cf-*`, `x-forwarded-*`, and `host`, but not
  `x-middleware-*`. Origin authentication runs in Next.js middleware, and
  CVE-2025-29927 was a middleware bypass through exactly such a header. Next.js
  15.5.21 is patched, so this is defense in depth against a regression.
- Recharts renders SVG. A simulation view plotting many paths or percentile
  bands can produce thousands of DOM nodes, which is the likeliest cause if any
  chart feels slow while scrubbing or resizing.
- Static assets currently traverse the Worker and count against the 100,000
  request daily cap. Serving them from Cloudflare Pages or R2 would remove the
  busiest request class from that budget.
