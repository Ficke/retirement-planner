# RetirePlan

[![Tests](https://github.com/Ficke/retirement-planner/actions/workflows/test.yml/badge.svg)](https://github.com/Ficke/retirement-planner/actions/workflows/test.yml)

[Open RetirePlan](https://adamficke.dev)

RetirePlan is a retirement planning application that combines tax-aware cash-flow
modeling with Monte Carlo simulation. It shows how savings, spending, asset
allocation, retirement timing, and Social Security choices affect a plan's
durability.

## Highlights

- Build and simulate a complete plan without creating an account.
- Keep plan data in the browser or optionally sync it across devices.
- Run the shared Rust engine locally as WebAssembly or through a private native service.
- Compare retirement age, spending, and Social Security scenarios using shared
  financial assumptions.

## Data and compute

Storage and simulation are independent choices:

| Concern | Local | Cloud |
|---|---|---|
| Plan data | Browser storage | PostgreSQL with a browser cache |
| Simulation | Rust WebAssembly in Web Workers | Native Rust on Cloud Run |

Cloud simulation inputs are processed in memory and never persisted. Signed-out
plans always keep their stored data in the browser.

## Quick start

Requires Node.js 22 or newer and pnpm 10. Rust is optional for local development.

```bash
git clone https://github.com/Ficke/retirement-planner.git
cd retirement-planner
pnpm install
pnpm bootstrap
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The bootstrap command writes
`apps/web/.env.local` from available Google Cloud, Firebase, or Terraform
configuration and falls back to guided manual setup when none is available.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm e2e
pnpm build
```

Before the first end-to-end run, install Chromium:

```bash
pnpm -C apps/web exec playwright install chromium
```

## Architecture

The application is a Vite-built React SPA served by Hono. Firebase provides
identity, PostgreSQL stores synchronized plans, and one Rust simulation library
runs through native and browser WebAssembly adapters.

## Documentation

- [Development setup](DEVELOPMENT.md)
- [Simulation architecture](docs/architecture/simulation-architecture.md)
- [Rust simulation service](RUST_SIMULATION_SERVICE.md)
- [Deployment](DEPLOYMENT.md)
- [Terraform](terraform/README.md)
- [Security](SECURITY.md)

## License

MIT
