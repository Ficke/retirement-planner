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
| `useHistoricalBootstrap` | ✅ honors `simulationModel` | ✅ now honored (was hardcoded) | Real toggle |
| Stock/bond means + vols | hardcoded constants | hardcoded constants | No API to override |
| Stock/bond correlation | hardcoded ~0.12 | hardcoded 0.12 | Single source: `market-history.ts` (TS) and `parametric_returns.rs` (Rust) — keep in sync manually |
| `useBackdoorRoth` | ✅ wired | not yet verified | TODO: confirm Rust path |
| `rebalanceAnnually` | ❌ not consumed | ❌ not consumed | Removed from UI; field still on type |
| `longevityOverride` | ❌ not consumed | ❌ not consumed | Removed from UI; field still on type |
| `randomSeed` | ✅ | ✅ | |
| `paths`, `block_size` | constants | constants | Not surfaced |

## Done (this session)

| # | Commit | Change |
|---|---|---|
| 1 | `025cfca` | Rust server path honors `assumptions.simulationModel` (4 call sites in `services/simulation.ts`) |
| 2 | `239d32c` | Assumptions page rewritten: drop CMA presets, surface bootstrap/parametric toggle, source numbers from `market-history.ts`, fix correlation |
| 3 | `54e3a5c` | Projections "Model" strip now uses engine constants and shows active method |
| 4 | `8d3322d` | Settings cleanup: drop duplicate model dropdown; remove dead `rebalanceAnnually` and `longevityOverride` controls |

## Remaining work

### 1. IA restructure: Inputs → Model → Results

Current sidebar mixes inputs and outputs. Proposed grouping:

```
Your situation        ← user-controlled facts about you
  Profile             (rename from "Plan" — overloaded word)
  Accounts

Model                 ← what the engine assumes about the world
  Assumptions

Results               ← what the engine produces
  Overview
  Projections
  Decisions

Account
  Settings
```

Rationale:
- The Assumptions → Results dependency becomes visible in the nav.
- "Profile" reads better than "Plan" (which is also the data structure
  and the product name).
- Settings becomes pure runtime/strategy with no model knobs.

Files:
- `apps/web/src/components/retire/sidebar.tsx` — `NAV` array + `PageId`.
- `apps/web/src/app/page.tsx` — page router, default route.
- `apps/web/src/components/retire/pages/plan.tsx` — rename heading to
  "Profile" (file rename optional; trade churn vs clarity).

### 2. Delete the dead CMA preset machinery

Once nothing references it:

- `apps/web/src/data/cma/presets.json` — the file.
- `assumptions.preset: Preset` on `ProjectionSettings`
  (`apps/web/src/domain/types.ts:78`) and the `Preset` type.
- Default `preset: 'Moderate'` in `usePlan.ts:241`.
- Schema entries in `apps/web/src/lib/validation.ts` and
  `apps/web/src/domain/schemas.ts` if present.
- `customReturns?: MarketAssumptions` on `ProjectionSettings` — also
  unused. Drop alongside `preset`.

Pre-flight: `grep -rn "preset\|customReturns\|presets.json" apps/web/src`
to verify no remaining consumers.

### 3. Decide the fate of `rebalanceAnnually` and `longevityOverride`

Two paths:

- **Wire them up.** `rebalanceAnnually=false` would mean letting
  allocation drift with returns — a real and useful sensitivity. Modest
  work in `engine/projection.ts` (and Rust mirror). `longevityOverride`
  similarly: `engine/projection.ts` reads `plan.profile.lifeExpectancy`;
  swap to `assumptions.longevityOverride ?? profile.lifeExpectancy`.
- **Delete them.** Strip from `ProjectionSettings`, schemas, Rust
  `types.rs`, default state. Aligns the type surface with the UI.

Recommendation: wire them up. They're short, useful, and removing them
loses real capability.

### 4. Verify `useBackdoorRoth` on the Rust path

The TS engine reads it (`engine/projection.ts:133`). Rust accepts it via
`types.rs` but I didn't trace it through `projection.rs`. Confirm with:

```
grep -n "use_backdoor_roth\|backdoor" rust-simulation-service/src/simulation/*.rs
```

If unwired, mirror the TS behavior. Otherwise the toggle is half-dead
the same way `simulationModel` was.

### 5. (Optional) Real CMA presets

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
