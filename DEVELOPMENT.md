# Development Setup

## Quick Start

```bash
git clone https://github.com/Ficke/retirement-planner.git
cd retirement-planner
pnpm install
pnpm bootstrap        # writes apps/web/.env.local
pnpm dev              # http://localhost:3000
```

`pnpm bootstrap` reads available values from the `gcloud` and `firebase` CLIs
and `terraform/production.tfvars`, then prompts for anything missing.
`./scripts/pull-secrets.sh` provides the non-interactive workflow for the
production project.

> **Note:** Don't export `DATABASE_URL` in your shell. It overrides `.env.local`.

## Running the simulation engine

The Rust service is optional. Without it the app falls back to the client-side
Web Worker automatically:

```bash
pnpm dev:rust                              # :8081, optimized build
```

Set `RUST_SERVICE_URL=http://localhost:8081` in `.env.local` to use it.

Note that the two engines share scenario definitions and the historical dataset
(`services/simulation.ts`, `data/market-history-annual.ts`) — after editing the
dataset, regenerate the Rust table:

```bash
node scripts/gen-rust-historical-data.mjs
```

## Commands

```bash
pnpm dev              # dev server
pnpm build            # production build
pnpm test             # unit tests (vitest)
pnpm e2e              # end-to-end tests (playwright, chromium)
pnpm typecheck        # tsc --noEmit
pnpm lint             # eslint
```

```bash
# from the repository root
pnpm dev:rust          # start the optimized engine

# from rust-simulation-service/
cargo run             # debugging build; do not use for performance comparisons
cargo test            # unit tests
cargo clippy          # lints
```

First e2e run needs a browser: `pnpm -C apps/web exec playwright install chromium`.
The e2e suite runs signed out (LOCAL data mode) and needs no database.

## CI

Every PR to `main` runs, in three parallel jobs:

- **TypeScript** — typecheck, unit tests, production build, lint
- **E2E** — Playwright smoke tests against the 5-page IA
- **Rust** — `cargo check`, `cargo clippy`, `cargo test`

Merges to `main` trigger Cloud Build, which deploys both Cloud Run services.
See `DEPLOYMENT.md`.
