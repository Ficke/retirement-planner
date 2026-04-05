# RetirePlan

[![Tests](https://github.com/Ficke/retirement-planner/actions/workflows/test.yml/badge.svg)](https://github.com/Ficke/retirement-planner/actions/workflows/test.yml)

Monte Carlo retirement simulator with a Rust computation engine and a Next.js frontend. Models tax-aware withdrawals, Social Security claiming strategies, and correlated asset returns across thousands of scenarios.

## Quick Start

```bash
git clone https://github.com/Ficke/retirement-planner.git
cd retirement-planner
pnpm install
node scripts/setup          # interactive env config
```

If you have GCP access, you can pull secrets directly instead:

```bash
gcloud auth login && ./scripts/pull-secrets.sh
```

Then start both services:

```bash
pnpm dev                            # Next.js on :3000
cd rust-simulation-service && cargo run  # Rust engine on :8081
```

The Rust service is optional — the app falls back to client-side Web Workers automatically.

> **Note:** Don't export `DATABASE_URL` in your shell. It will override `.env.local`.

## Architecture

```
apps/web/                    Next.js frontend + API routes
  src/state/usePlan.ts       Zustand store, simulation orchestration
  src/engine/projection.ts   Single-path retirement projection
  src/workers/mc.worker.ts   Monte Carlo Web Worker (client-side fallback)
  src/services/simulation.ts Routes to Rust or client-side engine

rust-simulation-service/     Rust Monte Carlo engine
  src/simulation/            Projection, Monte Carlo, tax logic
```

**Data model** — Accounts store a balance and a stock/bond allocation. That's it. No transactions, snapshots, or holdings tracking.

**Simulation** — 5,000 Monte Carlo paths with historical bootstrapping. Server-first (Rust + Rayon), with automatic client-side fallback. Users can toggle this via a preference.

**State** — `plan.accounts` is the single source of truth. Profile settings auto-persist to localStorage immediately and to the database every 30 seconds. Generation counters discard stale simulation results.

## Tech Stack

| Layer | Stack |
|-------|-------|
| Frontend | Next.js 14, TypeScript, Tailwind + shadcn/ui, Zustand, Recharts |
| Simulation | Rust (Warp + Rayon), Web Workers (fallback) |
| Data | PostgreSQL (Neon), Firebase Auth |
| Infra | Google Cloud Run, Cloud Build |
| Testing | Vitest, Testing Library, Playwright |

## Scripts

```bash
pnpm dev              # dev server
pnpm build            # production build
pnpm test             # unit tests
pnpm e2e              # end-to-end tests
pnpm typecheck        # tsc --noEmit
pnpm lint             # eslint
```

```bash
# from rust-simulation-service/
cargo run             # start engine
cargo test            # unit tests
cargo build --release # optimized binary
```

## Methodology

- **Returns** — Correlated normal distributions with fat-tail adjustments
- **Inflation** — Explicit CPI modeling for real vs. nominal calculations
- **Taxes** — Progressive federal/state brackets with capital gains stacking
- **Social Security** — AIME/PIA calculations with claiming age adjustments
- **Withdrawals** — Tax-optimized ordering: Taxable, Traditional, Roth
- **Risk of ruin** — Fails if portfolio goes negative at any point, not just terminal wealth

## License

MIT
