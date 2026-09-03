# Simulation parallelism plan

Status: proposed; Phase 0 decides whether the rest is built
Last updated: 2026-09-02
Companion to `simulation-architecture.md`, which this plan does not change:
one root seed, path `i` is path `i`, both engines share one set of semantics.

## Objective

The local engine runs the headline 5,000-path simulation on a single Worker
while eight others sit idle for most of a refresh. Give the main run the same
partitioned execution the sensitivity sweeps already have, so the machine's
cores decide how many paths are affordable.

## This is not a latency project

Say this plainly, because the first framing implied otherwise. A refresh is
already ~190 ms of wall clock and the main run overlaps the sweeps, so
partitioning it changes perceived latency by very little. What it buys is
headroom: the same wall clock at a larger path count, which firms up the tail
statistics — the 5th-percentile terminal wealth and the nine outcome cohorts
are each estimated from a few hundred paths today.

Phase 0 exists because that benefit may not be real, and settles it before
anything else is built.

## What was measured

Criterion, native release build, 55-year horizon, `benches/projection.rs`.

| | |
|---|---|
| `project_scenario_summary`, one path | 33.6 µs |
| One scenario, 1,000 paths | 33.2 ms |
| Main run in the browser, 5,000 paths | ~190 ms, one Worker |
| Sweeps, ~28 scenarios × 1,000 paths | ~1.2 core-seconds ÷ 8 Workers ≈ 150 ms |

On a 10-core machine a refresh uses **1.39 of the 1.90 core-seconds** available
during its ~190 ms window. The idle capacity inside the burst is 1.35x, not 10x.
The main run holds 0.19 of those core-seconds on one core.

Two results that redirected this plan:

- **Hoisting plan-invariant setup is worth 1.2%**, not the 20–30% predicted.
  `PreparedPlan` took 32.91 ms to 32.53 ms per 1,000 paths.
- **There is no hot spot.** Disabling long-term care saves 3%; disabling Social
  Security costs 7% and parametric returns cost 14%, because a portfolio that
  must fund more does more withdrawal and tax work. The ~580 ns per path-year is
  spread across the financial model.

No inner loop is worth rewriting. Cores are the only remaining lever, which is
what makes partitioning the main run the whole plan rather than one item in it.

## Why the main run was never partitioned

The sweep's shard ABI returns `[{ id, successCount }]`. It reduces inside the
Worker and crosses the boundary as integers, which sum exactly and in any order.

The main run cannot reduce early. Its outputs are order statistics and cohort
means over a global ranking:

| Output | Needs | Size at 5,000 paths |
|---|---|---|
| success, risk of ruin | counters | trivial |
| terminal-wealth percentiles | per-path scalars | 40 KB |
| per-year percentile bands | per-path portfolio values | 2.2 MB |
| nine outcome cohorts | per-path cash flows, 12 f64 per year | 26 MB |
| median cash-flow path | one path's detail | 5 KB |

The cohorts are genuine means over the ~500 paths in each ±5-point band
(`monte_carlo.rs:419`), so the 26 MB is not removable by returning less.

It is removable by **changing the representation**. As an array of structs
marshalled through `serde-wasm-bindgen` it is millions of JavaScript objects. As
packed `Float64Array`s copied out of linear memory it is a memcpy — single-digit
milliseconds against the ~165 ms being saved. That one fact is why this plan is
four ordinary phases instead of a stateful two-phase protocol.

## Phase 0 — does the accuracy exist to buy

The default model is a block bootstrap over **98 annual observations**
(1928–2025, block size 5). More paths reduce Monte Carlo error; they add no
information the historical record does not contain. At 5,000 paths the standard
error on the headline probability is ~0.6 pp, against a displayed whole percent.

Resample the historical table itself and re-run: bootstrap the bootstrap, and
measure how far p5 terminal wealth and the cohort cash flows move.

**Gate.** If the historical-sample uncertainty dominates the Monte Carlo error,
stop here and build none of the rest. Record the numbers either way — this
question will be asked again.

## Phase 1 — columnar interchange

Replace the array-of-structs path summary with structure-of-arrays: one packed
`Float64Array` per field, transferable, no per-path object allocation.

Useful on its own merits and a precondition for every later phase, including
the ones this plan rejects. It is also the only layout Wasm SIMD could use, if
that is ever revisited.

**Gate.** Native ↔ Wasm contract tests pass unchanged; the committed Wasm
artifact rebuilds and its hash is recorded.

## Phase 2 — one Worker pool

Today the main run holds a dedicated Worker and the sweeps hold a pool of up to
eight. They run concurrently, so partitioning the main run without merging the
pools makes the two phases compete for the same cores.

One pool of `hardwareConcurrency - 1`, with both phases queued onto it.

**Gate.** Sweep wall clock does not regress; the pool never exceeds
`hardwareConcurrency - 1` live Workers.

## Phase 3 — partition the main run

Two new versioned Wasm exports:

```text
run_main_shard(plan, config, startPath, endPath) -> packed path summaries
merge_main_shards(concatenated summaries)        -> SimulationResult
```

JavaScript computes shard boundaries, dispatches to the pool, concatenates the
buffers, and calls `merge_main_shards`. **JavaScript performs no aggregation.**
Partitioning is integer arithmetic and transport is transport; percentile
selection and cohort means stay in Rust, where the native adapter runs the same
code.

The sweep bends this rule today — `counts[index] += shard[index]` is a reduce in
JavaScript. It is safe only because integer addition is exact and associative.
Float summation and order statistics are neither.

Cloud Run is unchanged. `run_simulation_cancellable` already partitions with
`into_par_iter()`; this gives the browser a different scheduler over the same
kernel, not a second implementation.

**Gate.** A shard-count invariance test in Rust across N shards, not the 2-way
check at `monte_carlo.rs:585`; contract tests extended to both new exports.

## Phase 4 — spend the headroom

Phase 3 should take the main run from ~190 ms on one core to ~30 ms across the
pool. Phase 0's answer decides what to do with it: raise the main path count, or
keep the paths and take the wall clock.

**Gate.** Total refresh core-seconds stay inside what the median machine can
serve without starving the UI thread.

## Rejected, with reasons

| Option | Why not |
|---|---|
| **Wasm threads (`wasm-bindgen-rayon`)** | Needs nightly Rust and `-Z build-std`; the toolchain is pinned to stable 1.91.0. Also two committed artifacts, a runtime switch, COEP headers, and cross-origin-isolated contexts only — for the same ~30 ms Phase 3 delivers on stable everywhere. |
| **WebGPU compute** | Dispatch and readback overhead exceeds the compute at this size, and GPUs serialize divergent branches. The year loop is tax brackets, withdrawal ordering, and RMD tables — close to worst case. |
| **Stateful two-phase Workers** | Designed to avoid moving 26 MB. Columnar interchange makes that a few milliseconds, so the Worker lifecycle, abort handling, and stranded-state risk buy nothing. |
| **Fewer sweep paths** | Rejected by the product owner, and the cohorts need every path regardless. |
| **Partitioning policy in Rust** | Rayon work-steals with dynamic chunks; Workers need static contiguous ranges decided up front. One policy would make the native side worse. What must be shared is the merge, not the split. |
| **Raising the 8-Worker cap** | `min(max(hardwareConcurrency - 1, 1), 8, paths)` costs one idle core at 10 cores and much more above that — but the `- 1` already reserves for the main thread, so raising it blind oversubscribes. Needs measurement on a many-core machine first. |

## Risks

- **Parity.** Two new exports double the surface the contract tests must cover.
  This is the invariant the codebase is built around; the Phase 3 gate is not
  optional.
- **Memory.** The pool collectively holds the ~30 MB that used to be serialized.
  Transient and split eight ways, but it must be released when a refresh is
  superseded — the generation counters in `usePlan.ts` are where that hooks in.
- **Cancellation stays asymmetric.** Natively it is `CancellationToken` threaded
  through the kernel; in the browser it is `worker.terminate()`, because nothing
  can signal into a running Wasm call without shared memory. Workers are cheap
  to recreate. Do not try to unify these.

## Follow-ups

- **Quasi-Monte Carlo.** Sobol sequences converge at ~1/N against ~1/√N, which
  is more effective paths for the same compute. The advantage is strongest for
  continuous models; the default here is a discrete block bootstrap, so evaluate
  it against `parametric` mode first.
- **Lever extensibility.** Adding a sensitivity lever touches four files and six
  near-identical blocks. `SPECS` in `levers.ts` is already table-driven; the
  scenario builders, result types, and store slots are not. Not a performance
  change, and only worth doing if a fifth lever is coming.
- **The 300 ms debounce** (`SIMULATION_DELAY_MS`) is larger than the compute it
  guards. If perceived latency ever matters, it is the first term, not the last.

## Decision log

- **2026-09-02.** Benchmarked before optimizing. The benchmark contradicted the
  estimate that motivated the work: predicted 20–30%, measured 1.2%. Kept the
  change because it is exact and free, and recorded the number.
- **2026-09-02.** Rejected Wasm threads. The cross-origin isolation blocker in
  `edge-compute-plan.md` turned out to be stale — Google now serves
  `Cross-Origin-Resource-Policy: cross-origin` on the Analytics endpoints, and
  `COOP: same-origin` is already set. Threads were rejected on toolchain and
  artifact cost, not on that blocker.
- **2026-09-02.** Withdrew a stateful two-phase Worker protocol in favour of a
  stateless columnar one, once the 26 MB was recognised as a representation
  problem rather than a volume problem.
