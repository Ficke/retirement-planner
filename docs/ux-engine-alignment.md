# UX ↔ Engine alignment plan

Tracking the work to make the UI honest about what the simulation engine
actually does. The first pass landed on branch `ux-update`; the rest is
follow-on cleanup.

## Background

After the big UX refactor, an audit found that several controls in the UI
were misleading or non-functional:

- The **CMA preset selector** (Conservative/Moderate/Aggressive) on
  Assumptions was fully fictional — neither the TS engine nor the Rust
  server consumed `assumptions.preset` or `customReturns`. Both engines
  hardcode US 1926–2024 stats.
- The **bootstrap-vs-parametric toggle** was wired in the local TS
  engine but ignored on the Rust server path (the default), so the
  toggle was effectively dead for most users.
- The **stock/bond correlation row** displayed `0.15`; the engine uses
  `0.12`.
- **`rebalanceAnnually`** and **`longevityOverride`** were accepted by
  the Rust types and stored in state, but never read by simulation code.

## Engine truth (as of 2026-05-08)

| Knob | TS local engine | Rust server | Notes |
|---|---|---|---|
| `useHistoricalBootstrap` | ✅ honors `simulationModel` | ✅ honored | Real toggle |
| Stock/bond means + vols | hardcoded constants | hardcoded constants | No API to override |
| Stock/bond correlation | hardcoded ~0.12 | hardcoded 0.12 | Single source: `market-history.ts` (TS) and `parametric_returns.rs` (Rust) — keep in sync manually |
| `useBackdoorRoth` | ✅ wired | ✅ wired (`projection.rs:202`) | Confirmed both paths |
| `randomSeed` | ✅ | ✅ | |
| `paths`, `block_size` | constants | constants | Not surfaced |

`preset` / `customReturns` / `rebalanceAnnually` / `longevityOverride`
have been deleted from both type systems (commit `797c81f`). Revisit
only if we want to wire them up as real sensitivity knobs.

## Done (this session)

| # | Commit | Change |
|---|---|---|
| 1 | `025cfca` | Rust server path honors `assumptions.simulationModel` (4 call sites in `services/simulation.ts`) |
| 2 | `239d32c` | Assumptions page rewritten: drop CMA presets, surface bootstrap/parametric toggle, source numbers from `market-history.ts`, fix correlation |
| 3 | `54e3a5c` | Projections "Model" strip now uses engine constants and shows active method |
| 4 | `8d3322d` | Settings cleanup: drop duplicate model dropdown; remove dead `rebalanceAnnually` and `longevityOverride` controls |
| 5 | `797c81f` | Delete dead `preset`, `customReturns`, `rebalanceAnnually`, `longevityOverride` fields and the orphan `assumptions-panel.tsx` from both engines |
| 6 | _pending_ | Sidebar IA restructure: Your situation / Model / Results / Account; rename Plan→Profile in nav and page heading |

## Remaining work

### 1. (Maybe) Wire up rebalance / longevity as real knobs

Both fields were deleted in `797c81f` rather than implemented. If the
team wants real sensitivity controls:

- `rebalanceAnnually=false` lets allocation drift — stocks compound,
  stock share creeps up, risk rises with age. Real engine work in
  `engine/projection.ts` and `rust-simulation-service/src/simulation/projection.rs`.
- `longevityOverride` — one-line `??` swap in each engine where it
  reads `profile.lifeExpectancy`.

If reintroduced, restore the fields on `ProjectionSettings`,
`projectionSettingsSchema`, the API validation schema, and
`rust-simulation-service/src/types.rs::ProjectionSettings`.

### 2. (Optional) Real CMA presets

If you ever want presets to mean something, the work is real:

1. Add `MarketStats` (means + vols) to the Rust simulation request
   payload in `rust-simulation-service/src/types.rs`.
2. Plumb through `monte_carlo.rs` → `parametric_returns.rs`. Today
   `generate_parametric_returns` reads module-level consts; would need
   to take stats as a parameter.
3. Mirror in TS: `ParametricReturnsGenerator` and
   `generateCorrelatedReturns` in `engine/projection.ts`.
4. Bring the preset selector back, this time wired.

Block-bootstrap mode is fundamentally incompatible with custom
means/vols (it samples real history); presets only make sense as a
parametric-mode feature.

## Open questions

- Should the Settings page even keep the **Engine: server vs local**
  selector? It's a debugging knob, not a user-facing choice. Maybe move
  to a dev-only / footer toggle.
- The `MONTE_CARLO_DEFAULTS` constant in `data/market-history.ts` still
  has `use_historical_bootstrap: true` and `block_size: 3`. The first is
  now dead-code (we route via `simulationModel`); the second is still
  used. Consider removing the bootstrap default.
