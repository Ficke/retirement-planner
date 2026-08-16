# Rust simulation service

The Rust service is the default Monte Carlo engine. It is stateless: requests
are processed in memory and simulation inputs are never persisted. The web app
falls back to its local Web Worker engine when the service is unavailable.

Both engines implement the same financial semantics. The cross-engine contract
suite runs representative scenarios through each and compares their cash flows.

## Endpoints

| Route | Purpose |
|-------|---------|
| `GET /healthz` | Cloud Run and CI liveness probe |
| `GET /health` | Human-readable service status |
| `POST /api/simulate` | One 1–5,000-path simulation with a full result |
| `POST /api/batch` | A validated sensitivity batch |

For `/api/batch`, use `responseMode: "summary"` to return compact success
probabilities. Omitting the field preserves the legacy full response for browser
bundles that were open during deployment.

The Rust service is private in production. Public Next.js routes authenticate
to Cloud Run, validate and clamp inputs, rate-limit by the trusted client
address, and normalize upstream errors.

Requests are rejected before simulation work when they exceed these limits:

| Limit | Value |
|-------|-------|
| Paths per simulation | 5,000 |
| Simulations per batch | 40 |
| Total paths per batch | 40,000 |
| Block size | 1–10 |
| Request body | 256 KB |

## Execution model

Rayon parallelizes independent paths. A production instance receives one HTTP
request at a time and owns eight simulation threads. CPU-bound work runs behind
Tokio `spawn_blocking`.

The main endpoint retains the values needed for percentiles and one
representative cash-flow path. Summary batches invert the loops: each Rayon task
runs one path index across all sensitivity scenarios and retains only local
success counts.

Within each engine, every scenario uses the plan's root seed and path `i` uses:

```text
pathSeed = plan.assumptions.randomSeed + pathIndex
```

Missing seeds from older clients deserialize as `42`. The TypeScript and Rust
engines preserve the same path identity, although their different RNG
implementations do not promise identical return draws across engines.

## Local development

From the repository root:

```bash
cargo run --manifest-path rust-simulation-service/Cargo.toml
```

The service listens on port `8081` by default. Override it with `PORT`. Override
Rayon sizing with `SIMULATION_THREADS`; otherwise local development uses the
process's available parallelism.

Useful checks:

```bash
cargo fmt --manifest-path rust-simulation-service/Cargo.toml --all -- --check
cargo clippy --manifest-path rust-simulation-service/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path rust-simulation-service/Cargo.toml
```

The live cross-engine contract check builds the release binary, starts it on a
dedicated port, and runs:

```bash
RUST_SERVICE_URL=http://127.0.0.1:18081 pnpm -C apps/web test:contract
```

## Historical data

`src/simulation/historical_data.rs` is generated from the canonical TypeScript
dataset. After editing `apps/web/src/data/market-history-annual.ts`, regenerate
it with:

```bash
node scripts/gen-rust-historical-data.mjs
```

CI runs the same script with `--check` and fails if the two copies drift.

## Production configuration

Terraform is authoritative:

- 8 vCPU;
- 4 GiB memory;
- container concurrency 1;
- `SIMULATION_THREADS=8`;
- zero minimum instances unless overridden;
- private invocation through Cloud Run IAM.

Do not apply one-off `gcloud` resource changes; a later Terraform apply would
overwrite them.

## Change safety

- Keep summary and full projection logic on one financial loop.
- Preserve `rootSeed + pathIndex` when changing parallel topology.
- Run TypeScript/Rust contract tests after changing projection, tax,
  withdrawal, RMD, Social Security, seed, or historical-data behavior.
- Do not remove the full `/api/batch` response in the release that introduces
  summary mode.

See `docs/architecture/simulation-architecture.md` for the full design and
validation checklist.
