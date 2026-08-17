# RetirePlan

[![Tests](https://github.com/Ficke/retirement-planner/actions/workflows/test.yml/badge.svg)](https://github.com/Ficke/retirement-planner/actions/workflows/test.yml)

RetirePlan is a retirement planning application that combines tax-aware
cash-flow modeling with Monte Carlo simulation. It helps people explore how
savings, spending, asset allocation, retirement timing, and Social Security
choices affect the durability of a plan.

The application supports signed-out planning in the browser, optional cloud
synchronization, and two simulation engines with shared financial semantics.

## How it works

A plan combines profile assumptions with financial accounts. Each account
records its type, current balance, and stock/bond allocation. The profile stores
canonical inputs such as birth date and retirement-spending multiplier; the
application derives age, benefit cohorts, and the retirement spending target
from those inputs.

RetirePlan separates data storage from simulation compute:

| Concern | Local mode | Cloud mode |
|---|---|---|
| Plan data | Browser storage | PostgreSQL through authenticated API routes, with a browser cache |
| Simulation | Web Workers | Rust service on Cloud Run |

Data mode follows authentication and the cloud-sync preference. Compute mode
follows the server-calculation preference. A signed-out user can build and
simulate a complete plan, and every user can choose between on-device and cloud
computation.

Every plan has a root seed, which defaults to `42`. The headline simulation and
sensitivity scenarios reuse path identities so comparisons isolate the effect
of each changed plan input.

## Simulation model

- The headline result runs 5,000 Monte Carlo paths.
- Sensitivity analysis evaluates Social Security age, current spending, and
  retirement age with common random numbers.
- Annual returns draw from the canonical 1928–2024 market history built from
  Damodaran equity and Treasury data with BLS inflation data.
- Working cash flow allocates residual savings across HSA, 401(k), Roth IRA,
  and taxable accounts according to statutory limits.
- Retirement withdrawals coordinate taxable, traditional, Roth, and HSA
  balances with progressive income and capital-gains taxes.
- Social Security uses birth-year rules, claiming-age adjustments, and modeled
  benefit taxation.
- A path succeeds when every modeled year can fund its required cash flow.

The TypeScript and Rust engines share scenario definitions, seeds, request
contracts, and historical inputs. Contract tests verify their financial
behavior across the live service boundary.

## Architecture

```text
apps/web/
  src/state/usePlan.ts                 Plan state and simulation orchestration
  src/engine/projection.ts             TypeScript single-path projection
  src/workers/mc.worker.ts             Browser Monte Carlo engine
  src/services/simulation.ts           Scenario construction and engine routing

rust-simulation-service/
  src/simulation/projection.rs         Rust single-path projection
  src/simulation/monte_carlo.rs        Parallel Monte Carlo execution

terraform/                              Google Cloud infrastructure
```

`usePlan.ts` is the application state boundary. Plan actions persist changes,
invalidate prior results, and schedule replacement simulations after a short
debounce. Generation counters and abort signals keep superseded results from
updating the interface.

The production web service proxies simulation requests to the private Rust
service. Rust uses Rayon across eight vCPUs for server execution; local
sensitivities use a bounded Web Worker pool. Both paths expose the same summary
and full-result contracts.

## Technology

| Layer | Technology |
|---|---|
| Web | Next.js 15, React 19, TypeScript, Tailwind CSS, Zustand, Recharts |
| Simulation | Rust, Warp, Rayon, Web Workers, Comlink |
| Data and identity | PostgreSQL on Neon, Firebase Authentication |
| Infrastructure | Google Cloud Run, Cloud Build, Terraform |
| Verification | Vitest, Testing Library, Playwright, Rust test and Clippy |

## Local development

Requirements:

- Node.js 22 or newer
- pnpm 10
- A current Rust toolchain for the server engine

Install and configure the project:

```bash
git clone https://github.com/Ficke/retirement-planner.git
cd retirement-planner
pnpm install
pnpm bootstrap
```

`pnpm bootstrap` writes `apps/web/.env.local` using available Google Cloud and
Firebase CLI credentials, then prompts for any remaining values. Values already
exported in the shell take precedence over `.env.local`.

Start the web application at [http://localhost:3000](http://localhost:3000):

```bash
pnpm dev
```

Start the Rust engine at `http://localhost:8081`:

```bash
cd rust-simulation-service
cargo run
```

Set `RUST_SERVICE_URL=http://localhost:8081` in `apps/web/.env.local` to route
local web requests through Rust.

## Verification

Run web checks from the repository root:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm e2e
pnpm build
```

Run Rust checks from `rust-simulation-service/`:

```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --release
```

Changes to the canonical market dataset require regenerating the Rust table:

```bash
node scripts/gen-rust-historical-data.mjs
```

## Project guides

- [Development setup](DEVELOPMENT.md)
- [Simulation architecture](docs/architecture/simulation-architecture.md)
- [Rust simulation service](RUST_SIMULATION_SERVICE.md)
- [Deployment](DEPLOYMENT.md)
- [Terraform](terraform/README.md)
- [Security](SECURITY.md)

## License

MIT
