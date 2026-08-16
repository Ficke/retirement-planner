# Rust simulation service

The Monte Carlo engine. The web app calls it for every simulation and falls
back to the client-side Web Worker when it is unreachable, so the service is a
performance dependency, not a correctness one — the app stays fully usable
without it.

Both engines implement the same semantics. `apps/web/tests/contracts/engine-parity.test.ts`
runs a scenario through each and asserts the cash flows match.

## Running it

```bash
cd rust-simulation-service && cargo run
```

Listens on `:8081` by default; set `PORT` to change it. `RUST_LOG` controls log
level, and each completed run logs its path count and elapsed time at `info`.

The web app reaches it at `RUST_SERVICE_URL`, defaulting to
`http://localhost:8081`. When the service does not answer, simulations run in
the browser instead.

## Endpoints

| Route | Purpose |
|-------|---------|
| `POST /api/simulate` | One plan, one config, one `SimulationResult` |
| `POST /api/batch` | Several independent scenarios in one request |
| `GET /healthz` | Liveness. Probed by Cloud Run against the container and by CI on localhost; not reachable through the public `*.run.app` URL, where GFE intercepts the path |

`/api/batch` carries a distinct plan and config per entry — it is how the Plan
page computes its sensitivity curves in a single round trip. It does not split
one simulation's paths across entries.

Scenarios in a batch run sequentially. Each already parallelizes across its own
paths with Rayon, so running them concurrently would nest Tokio over Rayon and
oversubscribe the cores.

## Limits

Rejected with `400` before any work is scheduled:

| Limit | Value |
|-------|-------|
| Paths per simulation | 5,000 |
| Simulations per batch | 40 |
| Total paths per batch | 40,000 |
| Block size | 1–10 |
| Request body | 256 KB |

The plan is validated too: retirement age 45–100, age at the as-of date 18–100,
life expectancy above retirement age, and a `schemaVersion` no newer than the
service supports. A plan from an older schema is accepted and simulated under
the semantics that version shipped with.

These bounds are the service's own backstop. The public Next.js routes in front
of it apply their own clamps and per-IP rate limits — see
`apps/web/src/lib/simulation-request.ts`.

## Historical data

`src/simulation/historical_data.rs` is generated from the canonical TypeScript
dataset. After editing `apps/web/src/data/market-history-annual.ts`, regenerate
it:

```bash
node scripts/gen-rust-historical-data.mjs
```

CI runs the same script with `--check` and fails when the two drift apart.

## Deployment

Built and deployed as a Cloud Run service; see [DEPLOYMENT.md](DEPLOYMENT.md).
For how paths parallelize and what distributing them would involve, see
[docs/architecture/simulation-architecture.md](docs/architecture/simulation-architecture.md).
