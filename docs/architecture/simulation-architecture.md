# Monte Carlo parallelization

How the Rust service runs a simulation, why paths parallelize cleanly, and what
it would take to spread them across machines.

## How a request is served

A simulation request carries one plan and an `MCConfig` — `paths`, `seed`,
`useHistoricalBootstrap`, and `blockSize`.

```
POST /api/simulate  { plan, config }
        │
        ▼
run_simulation()                       simulation/monte_carlo.rs
        │
        │  (0..config.paths).into_par_iter()
        │  path N uses seed.wrapping_add(N)
        │
        ├──────────┬──────────┬─────────── … Rayon spreads across cores
        ▼          ▼          ▼
   run_single_path()  →  project_scenario()   simulation/projection.rs
        │          │          │
        └──────────┴──────────┘
        │
        │  each path reduced to a PathSummary
        │  (terminal wealth, portfolio value per year, success)
        ▼
aggregate_results()  →  percentiles, success probability, income sources
        │
        ▼
SimulationResult
```

Paths are summarized as they finish rather than collected whole. A
`PathResult` holds every cash-flow field for every modeled year, and the
aggregation only ever needs terminal wealth, the yearly portfolio value, and
whether the path succeeded — so keeping the rest would multiply peak memory
for nothing.

## Why paths parallelize

Each path is a pure function of `(plan, seed)`:

- `plan` is borrowed immutably. `project_scenario` collapses accounts into
  per-type buckets and mutates only that local copy.
- Each path seeds its own RNG from `seed + path_index`, so no generator is
  shared.
- Nothing is written outside the path, so there are no locks, mutexes, or
  atomics anywhere in the simulation.

Determinism follows from the same property: the same base seed always produces
the same set of paths, and because aggregation only sorts and counts, the order
in which they finish does not affect the result.

## The batch endpoint

`/api/batch` takes several *scenarios* — a distinct plan and config per entry,
which is how the sensitivity curves are computed. It is not a way to split one
simulation's paths across requests.

Batched scenarios run in sequence rather than concurrently. Each one already
saturates the Rayon pool across its own paths, so running them in parallel
would nest Tokio tasks over Rayon threads and oversubscribe the cores.

## Distributing across machines

Nothing in the simulation prevents it. A coordinator could hand each worker a
path range and the base seed, have each return its summaries, and aggregate
centrally — the isolation properties above are exactly what that requires, and
the per-path math would not change.

Whether it is worth doing is a different question. Path execution dominates the
time, so throughput scales with cores almost linearly, and a single machine
serves an interactive request well within the latency a slider drag can
tolerate. Distribution would add a coordinator, partial-failure handling, and
network round-trips to a stage that is not currently the constraint.

Reach for it when one of these becomes true:

- A single simulation needs enough paths that one machine exceeds the
  interactive budget.
- Concurrent load, not single-request latency, is what saturates the service.

Until then the cost is complexity with no user-visible gain.

## Measuring

Numbers here would go stale faster than they could be useful, so this document
does not quote any. The cross-engine contract test
(`apps/web/tests/contracts/engine-parity.test.ts`) asserts a production-shaped
5,000-path request stays within a CI budget, and the service logs each run's
elapsed time at `info`. Measure on the hardware you care about.
