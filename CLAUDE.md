## Architecture

### Data Model
Accounts store a **balance** and **stock/bond allocation** directly. No transactions, snapshots, or holdings tracking — the simulation only needs portfolio size and asset allocation.

One fact is stored once and everything else derived: the profile keeps
`birthDate` (age and the RMD / Social Security birth-year cohort follow) and
`retirementSpendingMultiplier` (the dollar retirement target follows from
current spending). The engines receive the resolved dollar figure; storage
keeps the multiplier.

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
- **Savings is the residual**: gross income less taxes and spending, all of it
  invested. Contributions fill statutory limits HSA → 401(k) → Roth IRA, and
  taxable absorbs the rest, so `gross = taxes + spending + savings` closes
  exactly. A working year that spends beyond its income draws on the portfolio,
  exactly as a retirement year does
- **Accounts collapse into per-type buckets** at the top of each projection,
  weights blended by balance. Splitting one balance across two accounts of the
  same type cannot change a projection
- **Success/risk-of-ruin**: a path fails if any modeled year — working or
  retirement — cannot be funded even after drawing down the portfolio, not just
  on terminal wealth. Both engines use this definition

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
