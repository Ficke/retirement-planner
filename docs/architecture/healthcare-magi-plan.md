# Healthcare MAGI Plan

Two modeling choices make the pre-Medicare retirement years look worse than they
need to. Neither is an arithmetic bug; both are decisions the engine makes for a
household that a real household would make differently.

1. **The first retirement year is priced on a salary that no longer exists.** The
   marketplace credit is tested against prior-year MAGI, so a household retiring
   at 58 is charged the full list premium on the strength of its age-57
   paycheck.
2. **The withdrawal order is MAGI-blind.** It drains Taxable, then Traditional,
   and walks straight over the 400% FPL subsidy cliff while the Roth balance
   sits untouched.

## What the export showed

From a single-filer plan retiring at 58 (defaults: $15,900 pre-Medicare premium,
$3,000 out-of-pocket, 2% real growth from the as-of date):

| Age | Prior-year MAGI | Healthcare | Why |
| --- | --- | --- | --- |
| 58 | ~$93k salary | $29,803 | over the cliff — pays list |
| 59 | ~$41k taxable gains | $8,399 | subsidized |
| 60 | ~$37k | $7,887 | subsidized |
| 61 | $67.5k Traditional | $31,628 | over the cliff — pays list |
| 64 | $104.7k | $33,563 | list, plus 2%/yr |
| 65 | — | $13,857 | Medicare premium replaces the marketplace one |

The ramp into 64 is a feedback loop, not cost growth: the taxable basis drains,
withdrawals shift to Traditional, MAGI crosses the cliff, the premium jumps to
list, and the larger premium forces a larger withdrawal that keeps MAGI over the
cliff. The step-ups at 77 and 81 are IRMAA tiers firing as RMDs grow, and match
`IRMAA_TIERS_2026` exactly.

These figures are the 2026-09-03 export and are the baseline to re-derive
against, not verified output of any change proposed here.

## Corrections to earlier findings

Recorded so they are not re-derived wrong.

- **There is one engine, not two.** `apps/web/src/engine/mc.ts` is a Comlink
  Worker loader and `apps/web/src/workers/mc.worker.ts` calls into WASM;
  `rust-simulation-service/src/simulation/projection.rs` is the only projection
  implementation. `apps/web/src/domain/healthcare.ts` is the profile-page
  preview only. AGENTS.md's "Key Files" entry for `engine/projection.ts` and its
  "Two engines" framing are stale and should be fixed alongside this work.
- **The withdrawal order is implemented twice.** `BUCKET_ORDER`
  (`projection.rs:34`) drives `withdraw_in_order` (`:433`), which funds
  *working-year* shortfalls at `:883`. The retirement solve does not use it — 
  `evaluate_ordered_withdrawals` (`:1448`) walks Taxable, Traditional, Roth, HSA
  in four inline loops. Both have to change, or the order stops being one rule.
- **The representative path is p50 by pre-tax terminal wealth.**
  `monte_carlo.rs:345` sorts on `terminal_wealth`, with
  `after_tax_terminal_wealth` carried along but not the key.
- **The chart and the export are different aggregations.** `yearlyProjections`
  is that one representative path; the cash-flow chart averages the 45th–55th
  percentile cohort. They are not cross-referenceable.

## Work item 1 — MAGI-aware withdrawal ordering

The existing sequence is right in shape. What is missing is a ceiling on the
Traditional leg.

1. **Taxable first.** Unchanged. Only the gain is income, at long-term rates.
2. **Traditional up to the MAGI headroom**, not to exhaustion: `ceiling − other
   MAGI for the year`.
3. **Roth for the remainder.** Roth is the MAGI shock absorber — zero income,
   which is exactly what a binding cliff needs.
4. **Traditional again above the ceiling** once Roth and HSA are dry.
5. **HSA last.** Unchanged.

Step 4 is not optional. A path fails when any modeled year cannot be funded, so
the ceiling has to be a preference that yields. A hard cap would manufacture
failed paths out of years that were fundable.

### The ceiling binds on a future year, not this one

This is the part the first pass missed. Healthcare is priced *before* the
withdrawal solve, so a year's own composition cannot change its own premium.
What year `t`'s MAGI decides is:

- year `t+1`'s marketplace credit, when the household is still pre-65 then; and
- year `t+2`'s IRMAA surcharge, once it is 65 or older then.

So the ceiling for year `t` is the minimum of whichever tests will actually be
applied, given the age the household reaches in each of those years:

| Age at `t` | Tests that will read this MAGI | Ceiling (single) |
| --- | --- | --- |
| ≤ 62 | marketplace credit at `t+1` | `SUBSIDY_CLIFF_FPL_RATIO × federal_poverty_level` = $62,600 |
| 63 | marketplace at `t+1`, IRMAA at `t+2` | min of the two — the FPL cliff binds |
| ≥ 64 | IRMAA at `t+2` | `irmaa_free_magi_ceiling` = $109,000, then the next tier boundary above it |

Both tables already exist, in `healthcare_premiums.rs` and its TypeScript mirror
`apps/web/src/data/healthcare-premiums.ts`. IRMAA is a staircase rather than one
cliff, so above the first tier the target is the next boundary, not "give up."

### The floor matters as much as the cliff

`expected_premium_contribution` returns `None` below `SUBSIDY_FLOOR_FPL_RATIO`
(100% FPL) as well as above the cliff — that population is Medicaid-eligible or
in the coverage gap, and the model prices neither. Driving MAGI to zero
therefore costs the household the entire subsidy. The rule targets a **band**,
not a cap: draw Traditional at least to the floor before switching to Roth.

### Monotonicity

`execute_ordered_withdrawals` bisects `cash_available_after_tax` and states the
assumption outright at `projection.rs:1404`. The reordering preserves it:
premiums are fixed before the solve, so at any budget the composition is
deterministic, total withdrawn is non-decreasing in the budget, and shifting a
marginal dollar from Traditional to Roth only raises net cash. Assert this with
a property test rather than trusting the argument — sweep the budget over a
plan whose ceiling binds mid-range and check `cash_available_after_tax` never
decreases.

### What the benchmark found

`magi_aware_ordering_benchmark` in `projection.rs`, 2,000 historical paths,
seed 42, the product's default healthcare figures:

| Shape | Success Δ | After-tax p50 Δ |
| --- | --- | --- |
| retire 58, Roth-heavy | +1.6pp | +$33,123 |
| retire 58, Roth-light | +3.5pp | +$46,601 |
| retire 62, balanced | 0.0pp | $0 |
| retire 65, no gap | 0.0pp | $0 |
| retire 58, converting | 0.0pp | $0 |

The predicted trade did not appear. No shape lost terminal wealth, and the two
that gained gained on both measures. Holding MAGI under the cliff at 58–64 does
not spend cheap bracket space the way a conversion does, because the dollars it
moves are ones the household had to withdraw regardless — the choice is which
bucket, not whether.

The zero rows are all mechanism, not noise:

- **Retiring at 62 or 65** never reaches the ceiling. Taxable is drawn first and
  covers the pre-Medicare years outright, so MAGI is realized gains alone.
- **Converting is where the two features fight.** With a `bracket22` ceiling the
  conversion refills exactly the headroom the ordering just cleared — on the
  representative path the age-62 conversion goes from $10,991 to $44,232 while
  the Traditional draw falls by the same amount, healthcare stays at the list
  $20,458 either way, and the year nets out identical. The conversion ceiling
  is a taxable-income bracket top; it does not know about the subsidy cliff.
  Making it respect the same band is a separate decision, not this change.

So the default should be on. It is off in the commit that introduces it and
turns on with the schema 8 gate below, so the one bump carries one behavior
change rather than two.

### Ship it as a setting, not a default

Burning Roth at 58–64 to stay under $62,600 spends exactly the low-bracket years
otherwise used to draw Traditional down cheaply and shrink later RMDs and IRMAA.
This is the trap already recorded on the Roth conversion work: the change can
lift success probability while lowering terminal wealth. Both numbers have to be
reported before this becomes anyone's default.

`RothConversionPolicy` is the precedent to copy — a small struct on
`ProjectionSettings` with `#[serde(default)]` on the Rust side, which means an
off-by-default setting needs no schema bump. Old payloads deserialize to
"off" and keep today's behavior.

## Work item 2 — the retirement-year premium estimate

### Two obvious approaches are traps

**Pricing on realized current-year MAGI** — what the law actually reconciles to —
breaks the solve. Healthcare is priced at `projection.rs:996`, the solve runs at
`:1066`, and feeding the credit into the tax function destroys the monotonicity
the bisection needs: crossing 400% FPL drops after-tax cash by the entire
subsidy in one step, so the bisection can converge on the wrong side of the
cliff. The pre-solve pricing is load-bearing.

**Iterating to a fixed point** may have no fixed point to reach. Premium up →
withdrawal up → over the cliff → premium up. It can oscillate.

### What works: fix the estimate, keep it pre-solve

A real enrollee reports *projected* income and reconciles later. The only thing
making prior-year MAGI wrong is the retirement discontinuity — the salary that
stopped. So replace the `prior_year_magi` field of `PremiumIncomeTest` with an
estimate built from state known at the start of the year:

```
estimate = prior-year MAGI
         − prior-year wages
         + portfolio income implied by this year's planned spending
```

The third term runs target spending through the withdrawal order against current
balances and `taxable_gain_ratio`. It is a single forward pass, no circularity,
and deliberately not reconciled against the solve — exactly like a real estimate.

**Do not stop at subtracting wages.** Prior-year-MAGI-minus-salary at 58 is
roughly $0, which falls under the subsidy floor and returns `None` — the
household pays full list, worse than today. The portfolio-draw term is what
keeps the estimate inside the band.

On the export's numbers that puts age 58 at ~$40.8k MAGI → 2.61× FPL → 8.76%
applicable percentage → ~$3,574 premium plus ~$4,731 out-of-pocket ≈ $8.3k,
against $29,803 today.

### `magi_by_year` needs wages separated

`magi_by_year` (`projection.rs:1190`) pushes one blended figure. The estimate
needs the wage component separable, so either push a small struct or carry a
parallel wage vector.

### Rollout

This one changes every plan's numbers, so it takes a version gate in the
established pattern: a new constant beside `HEALTHCARE_MODEL_SCHEMA_VERSION`
(`rust-simulation-service/src/types.rs:19`), gated on `plan.schema_version >=`
it, with `PLAN_SCHEMA_VERSION` bumped 7 → 8 in both
`rust-simulation-service/src/types.rs` and
`apps/web/src/domain/constants.ts`. Gate on the new constant, never on the
current version — that is what keeps the *next* bump from silently reverting
this behavior.

The bump reaches `domain/schemas.ts` (a `z.literal`), `lib/persistence.ts`
(local cache), `services/server/database.ts` (column default and writes), and
`lib/simulation-request.ts` (clamps). The cleanup-pass note about a pending
lazy migration applies here.

`domain/healthcare.ts` is the profile preview and currently passes no income
test at all, so it prices at list. It should carry the same estimate for the
first retirement year, or the previewed spending stops matching what the engine
funds — which is the stated contract in its docblock.

## Sequencing

Work item 1 first. It is behind a setting, needs no schema bump, and its
benchmark output is what tells us whether the ordering is worth defaulting on.
Work item 2 second, because it changes every plan and carries the rollout.

1. Separate wages in `magi_by_year`; add the ceiling helper over the existing
   premium tables (pure, unit-testable, no engine changes).
2. Withdrawal ordering behind the new setting, in both
   `evaluate_ordered_withdrawals` and `withdraw_in_order`.
3. Benchmark: success probability *and* terminal wealth, on and off, across the
   plan shapes we care about. Decide the default from that, not from the
   pre-Medicare years alone.
4. First-year premium estimate, behind the new schema constant, with the
   `PLAN_SCHEMA_VERSION` bump and the TypeScript preview updated to match.
5. Fix the stale AGENTS.md entries listed above.

## Tests

- Ceiling helper: cliff, floor, the 63/64 transition, and the IRMAA staircase
  above the first tier.
- Ordering: a plan whose Traditional draw would cross the cliff draws Roth
  instead; a plan with Roth and HSA exhausted still funds the year rather than
  failing it; a plan far under the ceiling is unchanged from today.
- Monotonicity property test over `cash_available_after_tax`, as above.
- Estimate: the first retirement year lands inside the subsidy band, and a
  wages-only subtraction is caught by an explicit case at the floor.
- Version gate: a schema-7 request reproduces today's numbers exactly.
