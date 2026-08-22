# Simulation architecture

## Product contract

The app has two first-class compute modes:

- Cloud mode sends a transient, stripped simulation plan through the Hono
  proxy to the Rust Cloud Run service.
- Local mode calculates the same scenario grids in browser Web Workers without
  sending plan data off-device.

`apps/web/src/services/simulation.ts` defines scenario construction, path
counts, and seeds. Both engines implement the same cash-flow semantics and use
the canonical annual market history in
`apps/web/src/data/market-history-annual.ts`.

## Seed and path identity

Every plan has one root seed, editable in Settings and defaulted to `42` when an
older plan or request omits it. There is no random-per-run mode.

Within either engine, path `i` in every scenario uses:

```text
rootSeed + pathIndex
```

The headline simulation and every sensitivity point therefore use common
random numbers at a given path index. This path identity must not change when
work is split across threads or Workers. TypeScript and Rust use different RNG
implementations, so the identity contract does not require identical draws
between engines; cross-engine tests instead verify the resulting financial
semantics within their numerical tolerances.

## Main simulation

The headline simulation runs 5,000 paths and returns a complete
`SimulationResult`:

- success probability and risk of ruin;
- terminal-wealth percentiles;
- yearly portfolio percentiles;
- one internally coherent representative cash-flow path.

Rust parallelizes paths with Rayon. Local mode keeps the headline simulation on
one Web Worker; sharding percentile and representative-path aggregation remains
deferred.

## Sensitivity sweeps

The Plan page evaluates 17 grid points at 300 paths each:

- Social Security claim age: 62, 64, 66, 68, and 70;
- current spending: 60% through 120% in 10% steps;
- retirement age: the plan age plus or minus four years in two-year steps,
  subject to plan bounds.

Spending sensitivity varies `currentSpending`. The plan's retirement-spending
multiplier is then resolved to a dollar amount at the engine boundary. This
keeps sensitivity behavior aligned with the canonical plan model.

Sensitivity consumers need only success probability. Both projection engines
therefore expose a summary seam that runs the same yearly financial loop with
projection-row recording disabled. Full and summary success must be exactly
equal for the same plan and path seed.

### Cloud kernel

Summary batches use path-major loop inversion:

```text
parallel path index
  for each grid point
    run summary projection(rootSeed + pathIndex)
    increment the worker-local success count
reduce worker-local count vectors
```

This removes the sequential Rayon barrier between grid points. CPU-bound Rayon
work is launched through Tokio `spawn_blocking`, keeping the async runtime
available for HTTP work and health probes.

### Local kernel

Sensitivity work is divided into contiguous, balanced path-index shards across:

```text
min(max(hardwareConcurrency - 1, 1), 8, pathCount)
```

Each Worker receives the scenario plans and its path range, regenerates returns
from the shared root seed, and returns one success count per grid point.
Aborting a stale simulation terminates both the headline Worker and the
sensitivity pool; the next run creates fresh Workers.

## HTTP contracts and rolling deployment

`POST /api/simulate` returns a full `SimulationResult`.

`POST /api/batch` accepts `responseMode`:

- `summary` returns `{ id, successProbability }` per scenario;
- omitted or `full` returns the legacy nested full result for browser bundles
  already open during deployment.

The new web client also accepts the legacy full response after requesting
summary mode. This covers the opposite rolling-deployment order, where a new web
revision reaches an older Rust revision that ignores `responseMode`.

Successful proxy responses stream through Hono without parsing and
reserializing. Validation, rate limiting, and normalized error responses remain
at the public proxy boundary.

The legacy full batch response can be removed only in a later release, after
old browser bundles have aged out.

## Parallelism and infrastructure

Cloud Run is configured for one request per Rust instance, 8 vCPU, and 4 GiB of
memory. `SIMULATION_THREADS` pins the Rayon global pool to the allocated CPU
count instead of relying on host-core discovery.

Each path is isolated: it borrows the plan, owns its account copy and RNG, and
writes no shared state. That makes future path-range distribution possible, but
interactive work should continue to fit within one instance. If latency
regresses, first adjust grids and path counts; do not add scatter-gather to the
interactive request path without evidence that one instance is the constraint.

## Correctness invariants

- A path fails if any modeled year is underfunded, not only when terminal wealth
  is zero.
- Summary projection is the full projection with recording suppressed, never a
  second financial implementation.
- Contributions are derived from residual working cash flow; they are not
  stored plan assumptions.
- `rootSeed + pathIndex` is stable across sequential, threaded, and sharded
  execution.
- Scenario construction remains in `services/simulation.ts`.
- The TypeScript historical table is canonical; regenerate Rust data with
  `node scripts/gen-rust-historical-data.mjs` after edits.
- Generation counters and abort signals prevent stale results from overwriting
  newer plan results.

## Validation

Changes to projection, seed, batching, or parallel execution require:

1. TypeScript unit tests, lint, and type checking.
2. Rust formatting, strict Clippy, release tests, and release build.
3. The live TypeScript/Rust contract suite.
4. Terraform formatting and validation for deployment changes.
5. Browser smoke tests in both Cloud and Local compute modes, including
   rapid-edit cancellation.

Keep `/api/batch` full-response compatibility until a later release has allowed
old browser bundles to age out.
