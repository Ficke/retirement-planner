# Development Setup

Use Node.js 24 and pnpm 10 so local builds match CI and the production image.

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

The native Rust service is optional. Without it the app runs the same Rust
simulation library as WebAssembly in a client-side Worker:

```bash
pnpm dev:rust                              # :8081, optimized build
```

Set `RUST_SERVICE_URL=http://localhost:8081` in `.env.local` to use it.

Both execution targets use the Rust simulation core. Scenario definitions stay
in `services/simulation.ts`, and `data/market-history-annual.ts` is the source
dataset. After editing it, regenerate the Rust table and browser artifact:

```bash
node scripts/gen-rust-historical-data.mjs
pnpm wasm:build
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

Every PR to `main` runs independent gates for:

- **Web** — typecheck, unit tests, production build, lint, and dependency audit
- **Browser** — Playwright smoke tests, including the real local Wasm path
- **Rust** — native and Wasm checks, strict Clippy, tests, and dependency audit
- **Engine contract** — native HTTP and Wasm fixtures with full-result parity
- **Containers** — production image smoke checks, Wasm MIME type, caching, and CSP

Merges to `main` trigger Cloud Build, which deploys both Cloud Run services.
See `DEPLOYMENT.md`.
