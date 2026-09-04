# Asset routing and stale-chunk plan

Status: proposed
Last updated: 2026-09-03
Prompted by: the failed deploy of tag `deploy-2026-09-04.1` (PR #71), which
rolled itself back on a false positive and left #71 unshipped.

## Where this starts

`assets.not_found_handling` is `single-page-application`, so **any** path that
does not match an uploaded file returns `200` with `index.html`. That is right
for `/accounts`, which is a client route, and wrong for
`/assets/accounts-1BJuagHO.js`, which is a file that either exists or does not.
One rule is being applied to two different kinds of URL, and every consequence
below follows from that.

Three things it currently causes, in increasing severity.

**The deploy gate cannot tell a broken deploy from a slow one.** A shell
response is simultaneously "this colo has not picked up the new version yet"
and "the manifest is broken." `scripts/verify-edge-assets.sh` retries only
non-2xx, so the window added in `442a9f9` never engages for the one failure
mode it was written for. On 2026-09-04 that produced a false positive, and the
`failure()` rollback step reverted a healthy deploy.

**Every open tab breaks on every deploy.** The asset manifest is scoped to the
Worker version. Measured against production on 2026-09-03: of the 19 chunks
uploaded by the preceding build, 18 no longer resolve — only the CSS survived,
because its hash did not change. Every route in `app-router.tsx` is `lazy()`, so
a tab open across a deploy dies the moment the user navigates: the browser
requests a chunk that is gone, receives `200 text/html`, refuses to execute HTML
as a module, and the dynamic import rejects. There is no `vite:preloadError`
handler, so `AppErrorBoundary` renders "Something went wrong" over a perfectly
healthy deployment. Its "Try again" button re-renders the same dead import and
fails again; only "Reload" recovers. `prefetchSimulationEngine()` and the
Wasm/worker load sit on the same cliff at startup.

**A dead chunk is cached as immutable for a year.** The `/assets/*` rule in
`public/_headers` is applied to the fallback response too:

```
GET /assets/accounts-1BJuagHO.js
  content-type:  text/html
  cache-control: public, max-age=31536000, immutable
  cf-cache-status: HIT
```

Both the edge and the browser now hold an HTML document under a `.js` URL.

The existing follow-up in `edge-compute-plan.md`, "SPA fallback changes 404
semantics", identified the cause but scoped it to cosmetics — an unknown path
rendering the shell instead of React's Not Found view. The consequence is
larger than that entry assumed, and this plan supersedes it.

## Objective

An asset path that does not match an uploaded file returns a real `404`, and a
client that requests a chunk which no longer exists recovers onto the current
version without the user seeing an error.

## Non-goals

- Retiring the Cloud Run origin. That is Phase 4 of `edge-compute-plan.md` and
  is unaffected; the Worker's origin-proxy branch keeps its current behavior.
- Changing hashing, chunking, or the `manualChunks` split.
- Keeping old chunks reachable across deploys. Workers Assets scopes the
  manifest to the Worker version; there is no supported way to serve a previous
  version's files, and content-addressed dedup at the store level does not make
  an unlisted path routable.

## This is not a CI fix

The failed deploy is the cheapest of the three symptoms and the only one with
an operator watching. The user-facing break has been shipping silently since
Phase 1 of the edge migration, produces a `200` in the logs, and has no
telemetry attached to it. Fixing only the gate would make the pipeline green
while leaving that in place — and a green pipeline would remove the one signal
that currently points at any of it.

## Target routing

`not_found_handling` becomes `none`, which routes every **miss** — and only a
miss — to the Worker. Asset hits continue to serve from the store without
invoking the Worker, which is the property `edge-compute-plan.md` banked on when
it moved the busiest request class off the 100,000/day allowance.

The Worker then decides explicitly:

| Path | Handling |
| --- | --- |
| `/api/profile`, `/api/accounts`, `/api/auth/sync-user` | `edgeApp` (unchanged) |
| `/api/simulation` | `simulationApp` (unchanged) |
| `/assets/*` | `404`, never the shell |
| `/api/*` otherwise | origin proxy (unchanged) |
| everything else | SPA shell via `env.ASSETS.fetch()` |

This requires adding `"binding": "ASSETS"` to the `assets` block so the Worker
can serve the shell, and reworking the catch-all in `worker/index.ts`, which
currently sends everything unmatched to `proxyToOrigin` — under
`not_found_handling: "none"` that would send page navigations to Cloud Run
instead of serving the shell.

## Phases

### Phase 0 — verify the routing assumptions

Three things this plan depends on are not settled by the documentation and must
be confirmed on a throwaway Worker before production changes:

1. Under `not_found_handling: "none"`, an asset **hit** still bypasses the
   Worker. The whole cost argument rests on this.
2. `public/_headers` still applies to a response served through
   `env.ASSETS.fetch()`. If it does not, the shell loses its CSP and the
   security headers regress — a straight repeat of the `nosniff` regression
   caught in the edge plan's review.
3. What `assets_navigation_prefers_asset_serving` does when there is no
   fallback page to prefer. The flag is on by default at this compatibility
   date; its interaction with `"none"` is undocumented.

Gate: all three answered, in writing, in the decision log below.

### Phase 1 — asset misses return 404

Config and Worker routing per the table above. Ship behind the existing deploy
pipeline.

Gate: `/assets/<real-hash>.js` serves with its own content type and does not
invoke the Worker; `/assets/deadbeef.js` returns `404`; `/accounts` serves the
shell with the full `_headers` set; `/api/*` behavior is unchanged.

This phase does **not** fix the user-facing break. It converts a confusing MIME
error into an honest 404 and stops the cache poisoning, but a tab whose chunk is
gone still cannot load that route. Phase 2 is what fixes users.

### Phase 2 — recover from a chunk that no longer exists

The chunk is genuinely gone after a deploy no matter how the server answers, so
this is required independently of Phase 1.

- Listen for `vite:preloadError` and reload once, guarded by a `sessionStorage`
  key so a genuinely broken build cannot induce a reload loop. Clear the key on
  a successful load.
- Give the lazy routes a boundary that offers a reload rather than the generic
  error card.
- Fix `AppErrorBoundary`'s "Try again" for this class: re-rendering a failed
  dynamic import cannot succeed, so for a chunk-load error the action must be a
  reload.

Gate: with a tab open, deploy a new version, navigate to an unvisited route,
and land on the working page without seeing an error card.

### Phase 3 — simplify the deploy gate

With Phase 1 in place a missing asset is a `404`, so `settled_status` in
`scripts/verify-edge-assets.sh` does exactly what `442a9f9` intended: a
propagating asset is retried, a genuinely absent one fails once the window
closes. Keep the content-type assertion as a defensive check rather than the
primary signal.

Also revisit the rollback step. It reverted a healthy deploy on a false
positive, which is a worse outcome than failing loudly and leaving the new
version live. Decide deliberately whether verification failure should roll back
or alert.

Gate: a deliberately corrupted build fails the gate; a healthy deploy passes on
the first attempt.

## Rejected options

**`run_worker_first: ["/assets/*"]`.** Routes asset *hits* through the Worker,
not just misses. `edge-compute-plan.md` moved assets off the Worker precisely to
keep the busiest request class off the free-plan allowance; this would put it
back, at roughly ten Worker invocations per page load.

**Retry the shell response in the verifier.** Treats the symptom. It makes the
gate more patient without making it more correct — it still cannot distinguish
rollout lag from a broken manifest, and it leaves users and the cache untouched.
Drafted and discarded on 2026-09-03.

**Fingerprint the deployed version by comparing `index.html` asset references.**
A genuinely better gate: it fails fast on a real mismatch and cannot false-
positive on rollout lag. Still rejected as the primary fix, because it only
improves CI and leaves both user-facing symptoms in place. Worth reconsidering
if Phase 1 turns out to be blocked.

**`not_found_handling: "404-page"`.** Would break direct loads of client routes,
which is the reason the SPA setting was chosen.

## Risks

**Navigations begin invoking the Worker.** Under `"none"` a page navigation is a
miss, so it costs one Worker invocation where it previously cost zero. This is a
SPA, so navigations are roughly one per session rather than per route change,
and asset requests — the class that actually threatened the allowance — stay
free. Quantify against current traffic in Phase 0 rather than assuming.

**The shell could lose its headers.** Covered by Phase 0 item 2; if
`env.ASSETS.fetch()` does not carry `_headers`, the Worker must set them, and
the split-coverage test the edge plan asked for becomes mandatory rather than
advisable.

**A reload loop.** Phase 2's recovery reloads the page. If a deploy is genuinely
broken, an unguarded listener would reload forever. The `sessionStorage` guard
is load-bearing, not defensive.

**Crawler traffic on unknown paths** now reaches the Worker. Low volume, but it
is a new path to the free-plan ceiling.

## Test plan

- Unit: Worker routing table, one case per row, including `/assets/` miss → 404.
- Unit: the chunk-load recovery guard reloads once and not twice.
- Integration: `_headers` asserted on both an asset response and a
  Worker-served shell, closing the gap `edge-compute-plan.md` flagged.
- Live: `scripts/verify-edge-assets.sh` against the deployed Worker, plus a
  manual open-tab-across-deploy check for the Phase 2 gate.

## Decision log

| Date | Decision |
| --- | --- |
| 2026-09-03 | Root cause identified as one `not_found_handling` rule applied to both routes and asset paths. |
| 2026-09-03 | Verified empirically: 18 of 19 chunks from the preceding build are unreachable in production; dead chunks return `text/html` under `immutable` caching. |
| 2026-09-03 | Retry-on-shell workaround drafted, then rejected in favor of the root fix. |
| 2026-09-03 | `not_found_handling: "none"` chosen over `run_worker_first` on assets, on free-plan request cost. |
| | Phase 0 item 1 — asset hits bypass the Worker under `"none"`: _pending_ |
| | Phase 0 item 2 — `_headers` applies through `env.ASSETS.fetch()`: _pending_ |
| | Phase 0 item 3 — `assets_navigation_prefers_asset_serving` under `"none"`: _pending_ |
