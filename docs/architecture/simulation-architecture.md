# Simulation architecture

## Product contract

The app has one simulation implementation with two execution adapters:

- Cloud compute sends a transient plan through the Hono proxy to the native
  Rust service. Independent paths run in Rayon.
- Local compute loads the same Rust library as WebAssembly inside dedicated
  browser Workers. A Worker runs Rust sequentially; sensitivity work is split
  across a bounded pool of ordinary Workers.

`apps/web/src/services/simulation.ts` remains the product orchestration layer.
It resolves the stored plan to the engine wire format, constructs the headline
and sensitivity scenarios, and supplies the complete Monte Carlo config. It
does not implement projection or aggregation math.

The portable library is rooted at `rust-simulation-service/src/lib.rs`.
Projection, tax, withdrawal, Social Security, RMD, return generation,
Monte Carlo aggregation, and outcome cohorts live under `src/simulation/` and
are compiled into both the native server and the browser Wasm artifact.

## Layer boundaries

```text
services/simulation.ts
  |-- HTTP JSON --> Hono --> native Rust adapter --> Rayon scheduling --|
  |                                                               shared
  `-- Comlink --> module Worker --> Wasm adapter --> serial scheduling --| core
                                                                         |
                                            projection + aggregation <---'
```

The adapters differ only in scheduling and transport:

- `src/server.rs` owns HTTP limits, cancellation, logging, and blocking-task
  isolation. Those dependencies are excluded from `wasm32` builds.
- `src/wasm.rs` owns Serde/JavaScript conversion, Wasm ABI versioning, and the
  explicit sensitivity-shard boundary.
- `src/simulation/monte_carlo.rs` owns the shared path summary and aggregation
  kernels. Native and Wasm adapters both call those kernels.
- `src/validation.rs` owns engine-safety validation and is called by both
  adapters. Hono still validates and rate-limits public input as a separate
  abuse boundary.

## Determinism

Every plan has one 32-bit root seed. Path `i` in every scenario uses:

```text
u64(rootSeed) + u64(pathIndex)
```

The generator is the named and pinned `ChaCha12Rng`, not `StdRng`, whose
algorithm is allowed to change. Historical indices are sampled as fixed-width
`u32` values before conversion to `usize`, so a 32-bit Wasm target and a 64-bit
native target consume the same random stream.

Rayon collects the indexed path iterator in path order. Terminal-wealth ties
use path index as a secondary key. Floating cash-flow aggregation is performed
in path order rather than as a parallel reduction.

Historical mode is expected to serialize identically across native and Wasm
for a pinned toolchain. Parametric mode uses floating distributions and
transcendental functions, so its cross-target contract is semantic parity with
tight numeric tolerances plus exact structure and discrete outcomes. Contract
tests cover both modes.

## Headline simulation

The headline request runs 5,000 paths and returns a complete
`SimulationResult`: success/risk, terminal-wealth percentiles, yearly portfolio
percentiles, a coherent median-terminal-wealth cash-flow path, and nine outcome
cohorts.

All aggregation occurs in Rust. The Wasm boundary receives one plan/config
object and returns only the aggregated result; path-scale data never crosses
into JavaScript.

The local call is synchronous inside its Worker. An abort terminates that
Worker immediately, which also discards its Wasm instance. The next run creates
a clean Worker and initializes Wasm again. State generation counters remain the
last defense against a stale result committing.

## Sensitivity sweeps

All sensitivity scenarios use 1,000 paths and the same root seed. The exact
number of scenarios depends on lever ranges and includes Social Security,
spending, retirement age, and Roth conversion.

Native summary batches use a path-major Rayon kernel. Browser work is divided
into contiguous ranges across:

```text
min(max(hardwareConcurrency - 1, 1), 8, pathCount)
```

The Wasm shard ABI is explicit:

```text
{ simulations, startPath, endPath } -> [{ id, successCount }]
```

Every simulation carries its complete `MCConfig`, including root seed,
historical-bootstrap choice, and block size. Workers return integer counts;
JavaScript only sums those counts and divides once by the full path count.

## Wasm packaging and loading

`pnpm wasm:build` uses pinned `wasm-pack` with the `web` target and writes the
generated package to `apps/web/src/wasm`. Vite imports the generated ES module
from `mc.worker.ts` and emits the binary as a hashed `/assets/*.wasm` file.
Initialization is lazy, so cloud-only users do not download Wasm.

The generated package is committed so Node-only web and container builds do
not need a Rust toolchain. This opaque artifact is guarded in two ways:

- `scripts/check-wasm-artifact.mjs` hashes the portable Rust sources and locked
  dependencies. Every web build fails if the artifact is stale.
- CI rebuilds the package with the pinned Rust/wasm-pack toolchain and requires
  a clean diff.

The worker checks a dedicated Wasm ABI version before accepting work. The ABI
version is independent of the persisted plan schema version.

The production CSP grants only `'wasm-unsafe-eval'`, not general
`'unsafe-eval'`. The existing immutable asset policy covers the hashed binary,
which must be served as `application/wasm` for streaming compilation.

## HTTP compatibility

The existing native routes and rolling-deployment behavior remain unchanged:

- `POST /api/simulate` returns a full `SimulationResult`.
- `POST /api/batch` accepts `responseMode: "summary"` for compact sensitivity
  responses and preserves the legacy full response when omitted.
- The new web client accepts the legacy nested batch result during rolling
  deployment.

Browser Wasm output is never authoritative for authentication, persistence, or
server-side decisions. The native service and public proxy retain independent
input and resource limits.

## Design review decisions

The pre-implementation red-team review rejected the first draft until these
risks were addressed:

1. `StdRng` and target-width historical sampling were replaced with named
   ChaCha and fixed-width draws.
2. Browser sweep work gained an absolute path-range ABI to prevent duplicated
   paths across Workers.
3. Local calls now receive the same full config as server calls.
4. Engine-safety validation moved out of the HTTP adapter and into shared Rust.
5. Aggregation stayed in one shared kernel; only scheduling is target-specific.
6. The Wasm ABI and generated artifact gained independent version/provenance
   checks.
7. Legacy TypeScript regression coverage is mapped and ported before deleting
   the old implementation.
8. Browser tests exercise the real Wasm response, MIME type, runtime errors,
   and CSP permission; orchestration tests cover cancellation and Worker
   recreation.

Shared-memory Wasm threads were deliberately rejected for the initial design.
They would require cross-origin isolation and could disrupt authentication
popups and third-party resources. Ordinary Workers already provide bounded
sensitivity parallelism and preserve hard cancellation.

## Validation gates

Changes to simulation logic, config, seeds, aggregation, or packaging require:

1. Rust formatting, strict Clippy, release tests, and native release build.
2. A `wasm32-unknown-unknown` release-library check.
3. Generated historical/state-tax checks and Wasm source-provenance check.
4. Native HTTP versus Wasm contract fixtures for historical and parametric
   modes.
5. TypeScript type checking, lint, unit tests, and production Vite/Hono build.
6. Browser local-Wasm tests for MIME/runtime behavior, plus orchestration tests
   for cancellation and Worker recovery.
7. Container smoke tests for immutable Wasm caching and production CSP.

Performance reviews record native and Wasm 5,000-path latency, browser cold and
warm timing, sensitivity duration, binary transfer size, and peak memory where
the host tooling exposes it. Worker count or Wasm threading should change only
in response to those measurements.
