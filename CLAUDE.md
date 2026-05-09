## Architecture

### Data Model
Accounts store a **balance** and **stock/bond allocation** directly. No transactions, snapshots, or holdings tracking — the simulation only needs portfolio size and asset allocation.

### State Management
- `plan.accounts` is the single source of truth for account data
- Profile settings (age, salary, retirement age, etc.) persist to both localStorage (immediate) and database (periodic 30s sync)
- Generation counters prevent stale simulation results from overwriting newer ones

### Simulation
- **Server-first**: Rust Monte Carlo service at `rust-simulation-service/` (5000 paths, Rayon parallelism)
- **Graceful fallback**: Client-side Web Worker if Rust service unavailable
- **User toggle**: `useServerSideCalculations` preference for privacy-conscious users
- **Risk-of-ruin**: A path fails if portfolio goes negative at ANY point, not just terminal wealth

### Key Files
- `apps/web/src/state/usePlan.ts` — Zustand store, simulation orchestration, profile persistence
- `apps/web/src/engine/projection.ts` — Single-path retirement projection (TS)
- `apps/web/src/workers/mc.worker.ts` — Monte Carlo Web Worker with median path extraction
- `apps/web/src/services/simulation.ts` — Routes simulations to Rust service or client-side
- `rust-simulation-service/src/simulation/projection.rs` — Rust projection engine

# important-instruction-reminders
Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.
