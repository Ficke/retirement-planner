## Architecture

### Data Model
Accounts store a **balance** and **stock/bond allocation** directly. No transactions, snapshots, or holdings tracking — the simulation only needs portfolio size and asset allocation.

### Data Modes
Two data modes, always **derived**, never stored: LOCAL (not signed in, or cloud
sync off — profile + accounts in localStorage only) and CLOUD (signed in with
cloud sync on — DB persistence, localStorage as write-through cache). The app is
fully usable without an account. Independently, `useServerSideCalculations`
picks the compute engine: cloud (Rust service, inputs transient, never stored)
or local (Web Worker).

### State Management
- `plan` (including `plan.accounts`) in `usePlan.ts` is the single source of truth
- All plan changes go through `updatePlan`/account actions, which persist,
  invalidate results, and debounce-reschedule all simulations (300ms)
- Generation counters prevent stale simulation results from overwriting newer ones

### Simulation
- **Two engines, one set of semantics**: scenario sweeps, seeds, and the
  historical dataset are defined once (`services/simulation.ts`,
  `data/market-history-annual.ts`) and shared by both engines
- **Canonical dataset**: `data/market-history-annual.ts` (1928–2024, Damodaran
  S&P 500 + 10yr Treasury, BLS CPI). The Rust table is GENERATED from it —
  after editing run `node scripts/gen-rust-historical-data.mjs`
- **Server-first**: Rust Monte Carlo service at `rust-simulation-service/`
  (5000 paths, Rayon parallelism), client Web Worker as graceful fallback
- **Public endpoints are gated**: `/api/simulation/*` is unauthenticated by
  design but rate-limited per IP and clamped (`lib/simulation-request.ts`)
- **Success/risk-of-ruin**: a path fails if it ever runs short mid-retirement,
  not just on terminal wealth — both engines use this definition

### Key Files
- `apps/web/src/state/usePlan.ts` — Zustand store, data modes, simulation orchestration
- `apps/web/src/engine/projection.ts` — Single-path retirement projection (TS)
- `apps/web/src/workers/mc.worker.ts` — Client Monte Carlo engine + aggregation
- `apps/web/src/services/simulation.ts` — Shared scenario builders, engine routing
- `rust-simulation-service/src/simulation/projection.rs` — Rust projection engine

# important-instruction-reminders
Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.
