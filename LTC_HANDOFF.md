# LTC model — implementation spec (authoritative for this PR)

Probabilistic long-term-care episode, drawn once per Monte Carlo path from the
empirical distribution of *lifetime out-of-pocket* LTSS spending, charged at the
end of the horizon. Probabilities from data; price level from the user.

Source: ASPE Research Brief, Aug 2022 (revised), "Long-Term Services and Supports
for Older Americans: Risks and Financing, 2022" (Favreault et al., Urban
Institute, DYNASIM4 run id982, cohort turning 65 in 2021-2025).

## Decisions already made — do not revisit
1. Episode cost lands **on top of** retirement spending, not netted against it.
2. LTC model defaults **ON for every plan**, including plans migrated from
   schema v6. Existing plans' success rates will move. This is intended.
3. UI scope: **toggle + cost-multiplier dial** only. No with/without comparison.
4. Duration: **Table 2's highest-quintile row for all quintiles.** Duration is
   nearly flat across quintiles (0.7-1.2 yrs avg); dollars carry the real spread.

## Core semantics

### One uniform per path, comonotonic
Draw a single uniform `u` per path from a dedicated RNG stream. Read it against
BOTH the dollar distribution and the years distribution so big bills land on long
episodes. Independent draws produce $300k over four months.

**Condition both on "has an episode", then couple.** This is the part that is
easy to get wrong:
- Table 9 says 41.5% have any out-of-pocket spending (highest quintile).
- Table 2 says 43.8% have any paid LTSS.
- Coupling on the *raw* CDFs creates a dead band where years > 0 but dollars = 0,
  and the rate invariant below blows up.

So: if `u < P(no out-of-pocket)` there is **no episode at all** (zero cost, zero
years). Otherwise remap
`v = (u - P(none)) / (1 - P(none))`
and invert `v` against the dollar CDF **and** the years CDF, each renormalized
over its own has-care mass. One `v`, two inversions.

### Normalize every row before calibrating — load-bearing
ASPE rows do not sum to 100 (the highest quintile sums to 100.2). Normalize each
row by its own sum before computing anything. Verified: raw gives a top-bucket
mean excess of $264,345, normalized gives $265,809, and $265,809 is the
calibrated figure this design is specified against. Get this wrong and every
quintile is subtly off with nothing failing loudly.

### Tail shape
Open-ended top dollar bucket ($250,000+): **exponential** above the threshold with
the calibrated mean excess (memoryless above threshold), capped at **$2,000,000**.
The cap costs <0.2% of the mean; assert published means to 1% tolerance.
Open-ended top years bucket (>5 yrs): **uniform** from 5 to the cap of **10 years**.

Calibrate mean excess per quintile as
`(published_mean - closed_bucket_contribution) / P(top bucket) - 250000`
using uniform midpoints for closed buckets, on the NORMALIZED row. Assert each
row reproduces ASPE's published mean.

### Invariants to assert in tests
- **Implied annual rate**: `dollars / years` over the whole range of `v` must stay
  within **$38,000 - $210,000**/yr, bracketing CA home care and a CA private
  nursing-home room. Verified actual range: **$38,932 .. $200,425**.
  The floor is exact, not empirical: near v=0 both inversions are linear in v, so
  the ratio converges to the constant $38,932/yr. Do not "fix" a future failure by
  widening this band — a table edit that breaks it has drifted.
  This is also why the years cap is 10 and not 15: at 15 the worst path prices
  below a CA semi-private room.
- Each quintile row reproduces its published ASPE mean (1% tolerance).
- Each normalized row sums to 1.
- `u < P(none)` produces exactly zero cost AND zero years.
- Monotonicity: both dollars and years are non-decreasing in `u`.

### Quintile selection — live, per path, at age 65
ASPE conditions on income at 65 relative to FPL, where income is earnings +
pensions + SS + SSI + **annuitized financial assets** (self and spouse).

    income = annuity_factor * portfolio_at_65 + other_income_at_65
    ratio  = income / FPL(household_size)

Brookings "Seven Facts About the Economic Security of Older Adults," Online
Appendix Table 2 (CPS ASEC), income as share of poverty:
Q1 <1.51 | Q2 1.51-2.59 | Q3 2.59-3.96 | Q4 3.96-6.33 | Q5 >6.33

`annuity_factor = r / (1 - (1+r)^-n)`, r = 0.025 real,
n = max(life_expectancy - 65, 5). 4.78% at n=30. Deliberately below the ~6%
market annuity rate to stay consistent with the engine's real-terms basis.

Resolve **per path**, not once globally. The table is conditioned on income at 65
and each path knows its own portfolio there. This also deletes any deterministic
pre-pass: the episode is charged at the end of the horizon, so the loop passed 65
long ago — draw `u` at path start, defer both inversions until the quintile is
known.

**Clamp Q1 to Q2.** ASPE's lowest-quintile row is internally inconsistent: its
closed buckets contribute $15,188 at uniform interpolation and 3.4% sits above
$250k, so the minimum achievable mean is $23,688 against a published $15,400.
Even floor-loading every bucket leaves $20,520. It must not ship. Assert this
clamp so nobody "fixes" it later.

Known bias, accept and document: Brookings cutoffs come from CPS income (excludes
annuitized assets) while ASPE's measure includes them, so assignment biases
upward. Conservative, but a bias.

## Units — the trap
The data module encodes tables in **2020 dollars** and asserts against ASPE's
published means in 2020 dollars. The deflator to the plan's base year is applied
**in the engine, not the table**. Name the type `lifetime_cost_2020` so a misuse
reads wrong at the call site. Otherwise every number is off ~25% and nothing
fails loudly.

`costMultiplier` means **location AND care level**, not geography alone. DYNASIM
varies provider prices by income within each band, so the dial expresses where you
live plus whether you would buy above or below the blend your band implies.
Income itself is already handled by quintile selection. Default 1.0; California
is roughly 1.2 (CareScout 2025 CA vs national, weighted at CA's actual care mix,
where HCBS serves >90% of LTSS participants, gives x1.17).

## Engine constraints (verified post-`wasm-sim`)
- **One engine.** Write it only in
  `rust-simulation-service/src/simulation/projection.rs`
  (`project_scenario_internal`). `domain/healthcare.ts` is only the profile-page
  preview and a distribution has nothing to preview, so **no TS mirror**.
- **RNG trap**: path seeds are `seed + path_index`, so an LTC stream at
  `seed + i + 1` *is* path i+1's market stream. Derive the LTC stream by **XOR
  with a large odd constant**, never a small offset.
- Cost lands in **three places at once**: `healthcare_cost`,
  `hsa_qualified_allowance` (care services are fully deductible under §213(d)),
  and `target_spending`.
- Horizon is deterministic (`life_expectancy - age + 1`), so end-anchoring costs
  nothing currently modeled — but every path's episode ends in the same year.
- Projection is single-life throughout (`Household::single`, `household_size: 1`),
  so the sex split and a couple's two-episode risk cannot be modeled. Do not try.
- Household size for FPL comes from `filingStatus`, matching how IRMAA does it.

## New constants
- FPL by household size, 2025: **$15,650** single / **$21,150** for two. Put it in
  its own dated constant file beside `tax-brackets-2025.ts`, same export style.
- Annuity factor constants as above.

## Rollout
`PLAN_SCHEMA_VERSION` 6 -> 7, `LTC_MODEL_SCHEMA_VERSION = 7` gate,
`#[serde(default)]` on the Rust config, zod schema with defaults, clamps beside
the healthcare block in `validation.rs`. Follow the healthcare feature's pattern
exactly — it is the template.

Per decision 2 above, the v6->v7 migration turns the model **ON**, unlike the
healthcare rollout's opt-in default.

## Known UX wart to handle with copy, not code
The cash-flow table renders the **median-terminal-wealth** path, and ~52% of paths
have no episode, so it will usually show zero care cost while the success rate
drops. Without a line of copy this reads as a bug.

## Explicitly out of scope
No insurance model. No Medi-Cal floor (asset limit reinstated at $130,000 on
2026-01-01; a household with a portfolio does not qualify until the portfolio is
gone, which the engine already scores as a failed path). No onset-age draw. No
couple's two-episode risk.

---

# Repo map + corrections to the design memo (verified recon)

Four things the memo got wrong. Follow this section over anything above it.

### 1. Do NOT add a new FPL constant — it already exists
FPL is already in `apps/web/src/data/healthcare-premiums.ts` L17-29 as a
*formula*, not a by-size table, with a Rust mirror in
`rust-simulation-service/src/simulation/healthcare_premiums.rs` L19-20:
```ts
const FEDERAL_POVERTY_LEVEL_2025 = { firstPerson: 15_650, eachAdditionalPerson: 5_500 } as const;
export function federalPovertyLevel(householdSize: number): number
```
Reuse `federal_poverty_level(household_size)`. Adding a second FPL constant to
`tax-brackets-2025.ts` would fork a number that must not fork.

### 2. `filingStatus` -> household size does NOT exist
The memo says "household size from filingStatus, matching IRMAA." IRMAA does no
such thing — it scales *thresholds* by filing status and never consults household
size. `householdSize` today has exactly one consumer (the ACA subsidy path) and
the engine hardcodes it to `1` (`projection.rs` L732), deliberately: the plan
models one age, and charging per filer "would double a couple's surcharge years
before the second person is eligible."

So derive it locally for FPL only: `MarriedFilingJointly => 2, otherwise => 1`.
Put that in the LTC module, document why it does not reuse an existing helper
(there isn't one), and do not change `projection.rs` L732.

### 3. `domain/healthcare.ts` is a real engine mirror, not a preview
It is a line-for-line TS mirror of `healthcare_cost_for`, exercised by
`apps/web/tests/engine/healthcare.test.ts`. The "no TS mirror" conclusion still
holds for LTC — there is no TS projection loop at all, the browser runs Wasm — but
do not repeat the memo's reasoning about it in code comments.

### 4. RNG landmine is live
`historical_data.rs` L743-750 (`seed_42_sampling_has_pinned_year_and_block_results`)
and `parametric_returns.rs` L152 pin `ChaCha12Rng::seed_from_u64(42)` output.
**Any change to the market generator's draw order breaks them.** The LTC draw must
come from a SEPARATE `ChaCha12Rng`, seeded by XOR with a large odd constant, and
must not touch `returns_generator` at all. If those two tests go red you have
pulled from the wrong RNG — fix the draw, never re-pin the tests.

## Insertion points

**Rust** (`rust-simulation-service/src/`):
- `types.rs` — `PLAN_SCHEMA_VERSION: u32 = 6` L3 -> 7; add
  `LTC_MODEL_SCHEMA_VERSION: u32 = 7` beside `HEALTHCARE_MODEL_SCHEMA_VERSION` L19
  (copy its doc-comment style). Add config struct modeled exactly on
  `RetirementHealthcare` L103-119 (derive `Default`, `#[serde(rename=..., default)]`
  on every field). Wire onto `UserProfile` beside L96-97.
- `validation.rs` — clamps beside the healthcare block L106-120, same shape
  (finite check + range check + single `Err(...)`).
- `simulation/projection.rs`:
  - horizon `let total_years = profile.life_expectancy - age + 1;` L454-456
  - loop `for year in 0..total_years {` L475 .. L946
  - `let mut healthcare_cost = 0.0;` L522
  - the three-way landing zone L743-753: `hsa_qualified_allowance +=`,
    `healthcare_cost =`, `let target_spending = ... + healthcare_cost;`
  - `healthcare_cost: healthcare_cost.min(spending.max(0.0))` L941-944 — note this
    cap exists because outcome cohorts average the field; LTC must respect it.
- New module `simulation/ltc.rs`, registered in `simulation/mod.rs` (healthcare is
  registered at L2). Tables in 2020 dollars live here.

**TypeScript** (`apps/web/src/`):
- `domain/constants.ts` L3 — `PLAN_SCHEMA_VERSION = 6` -> 7. TS has NO gate-version
  counterpart; do not invent one.
- `domain/schemas.ts` — zod object in `profileBaseShape` (healthcare is L52-59);
  `simulationPlanSchema` L221 `z.literal(PLAN_SCHEMA_VERSION)`; BOTH legacy
  normalizers need an LTC fallback (stored-profile L132-137 and
  `legacySimulationProfileSchema` L171-176). Per decision 2 the fallback turns LTC
  **ON**, unlike healthcare's zeros-are-a-no-op fallback — comment that divergence.
- `domain/types.ts` — interface beside `RetirementHealthcare` L46; field on the
  profile beside L84.
- `state/usePlan.ts` — default merge beside L265-268; default value imported from
  `@/data/tax-brackets-2025` like `DEFAULT_RETIREMENT_HEALTHCARE` (L181-186 is the
  style template: multi-paragraph JSDoc citing sources, then `as const`).
- `lib/simulation-request.ts` L48 clamps `schemaVersion` to `PLAN_SCHEMA_VERSION-1`
  — check this still means what it should after the bump.
- UI: `components/retire/pages/profile.tsx` — healthcare `DashboardCard` L218-262
  is the template; `updateHealthcare` L61-62 is the patch-helper idiom. Add the
  toggle + multiplier dial. `NumberField` with `step`/`min`/`max` and `/100`
  conversion is at L238-245.
  Read-only summary line in `settings.tsx` L281 if it fits cheaply.
- `updatePlan` (`usePlan.ts` L576-600) re-parses the whole plan and **rejects the
  entire change** if the schema fails, with `Plan change was not applied: ...`. A
  too-tight zod clamp shows up as the UI silently refusing edits.

## Test targets
- Rust: inline `#[cfg(test)] mod tests`. New tests in `simulation/ltc.rs`;
  projection-level tests join `projection.rs` L1332+.
- TS: Vitest, `apps/web/tests/**` ONLY (`include: ['tests/**/*.{test,spec}.{js,ts}']`
  — a test under `src/**` is silently not run). `tests/engine/healthcare.test.ts`
  is the template; `tests/schemas.test.ts` L37/L84 for migration.
- Note: the memo claims `server-client-comparison.test.ts` exists and is
  gitignored. **It does not exist and is not gitignored.** Ignore that.

## Commands
```
cargo test                                              # from rust-simulation-service/
cargo clippy --all-targets --all-features -- -D warnings
cargo fmt --all -- --check
cargo clippy --release --target wasm32-unknown-unknown --lib -- -D warnings
pnpm test            # root; vitest is in WATCH mode -- use `vitest run` in CI-style checks
pnpm -C apps/web test:contract
pnpm typecheck && pnpm lint
pnpm wasm:build && pnpm wasm:check
```
**`pnpm wasm:build` is mandatory after any Rust type change** — CI regenerates the
Wasm interface files and `git diff --exit-code`s them. Forgetting this reds CI
with a diff, not a test failure.

---

# VERIFIED DATA — extracted from the ASPE PDF, use these exact numbers

All figures **2020 dollars**. Confirmed verbatim from the table notes:
`NOTES: Estimates are reported in 2020 inflation-adjusted dollars.`

## Table 9 — lifetime family out-of-pocket LTSS spending, by income quintile
Printed title: "TABLE 9. Projected Average and Distribution of Sum of Family
Out-of-Pocket LTSS Expenditures from Age 65 to Death for Adults Turning 65 in
2021-2025, by Income Quintile". Source: DYNASIM4 run id982.

Buckets as printed: None | <$10,000 | $10,000-$24,999 | $25,000-$49,999 |
$50,000-$74,999 | $75,000-$99,999 | $100,000-$149,999 | $150,000-$199,999 |
$200,000-$249,999 | >$250,000

| Quintile | Mean | %any | None | <10k | 10-25k | 25-50k | 50-75k | 75-100k | 100-150k | 150-200k | 200-250k | >250k |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Lowest  | 15,400 | 27.6 | 72.4 | 5.3 | 4.7 | 4.1 | 2.0 | 1.9 | 3.4 | 1.8 | 1.0 | 3.4 |
| Second  | 34,200 | 32.9 | 67.1 | 6.2 | 4.5 | 4.2 | 4.4 | 2.3 | 3.8 | 1.9 | 1.2 | 4.4 |
| Middle  | 43,200 | 34.7 | 65.3 | 6.1 | 4.8 | 4.7 | 3.5 | 1.5 | 3.9 | 2.0 | 1.9 | 6.3 |
| Fourth  | 57,900 | 38.1 | 61.9 | 6.2 | 5.7 | 4.4 | 2.9 | 2.5 | 3.7 | 2.8 | 2.0 | 7.9 |
| Highest | 75,400 | 41.5 | 58.5 | 5.6 | 5.6 | 4.7 | 3.5 | 3.3 | 3.7 | 3.1 | 1.9 | 10.3 |

Row sums: Lowest/Second/Middle/Fourth = 100.0 exactly; **Highest = 100.2**.
Normalize every row anyway — see below.

## Table 2 — years of paid LTSS (Highest quintile row, used for ALL quintiles)
Printed buckets are **`<1 Year | 1.00-1.99 | 2.00-4.99 | >5`** — NOT the memo's
"1-2 / 2-5". Encode as [0,1), [1,2), [2,5), [5,cap]. The 4.99/5.00 gap is a
printed-rounding artifact; closing it is correct.

Highest quintile: None 56.3 | <1yr 22.9 | 1.00-1.99 7.7 | 2.00-4.99 10.1 | >5 3.1
Average years 0.7, percent with any paid LTSS use 43.7.

**Measured in service days, not calendar time.** Body text, p5, verbatim:
"measured in service days (where 365 days of paid LTSS counts as one year,
regardless of whether all care occurs in the same calendar year)". This is why we
work in dollars and derive years only for the rate sanity-check.

## Calibrated tail mean excess above $250,000 (NORMALIZED rows)
Second **113,409** · Middle **133,214** · Fourth **217,310** · Highest **265,809**

Normalization is load-bearing only for Highest (the one row that does not sum to
100): raw gives 264,345, normalized gives 265,809. Normalize all rows regardless
so the code path is uniform.

## Lowest quintile MUST NOT SHIP — clamp Q1 to Q2
Confirmed by extraction. The binding constraint is
`closed_contribution + 250,000 x P(top) <= published_mean`, since everyone in the
top bucket has at least $250,000:
Lowest floor = 15,187.50 + 250,000 x 0.034 = **23,687.50** against a published
**15,400**. Short by $8,287.50. Calibration yields a *negative* tail excess of
-243,750, which is nonsense. Clamp Q1 to Q2 and assert the clamp.
(Second is also tight — $4,990 headroom, implying a top-bucket mean of $363k —
but it is consistent and ships.)

## REVISED invariant — the memo's single band is wrong
The memo's "$40k-$210k across the whole range" was derived from the Highest
quintile alone. Because every quintile uses Highest's duration row (decision 4)
while carrying its own smaller dollar distribution, lower quintiles necessarily
imply lower annual rates. Verified floors and ceilings:

| Quintile | implied $/yr floor | ceiling |
|---|---|---|
| Second  | 27,744 | 148,475 |
| Middle  | 29,741 | 174,110 |
| Fourth  | 32,129 | 200,088 |
| Highest | 38,932 | 200,478 |

This is **correct, not drift** — endnote 9, verbatim: "DYNASIM4 varies LTSS prices
somewhat based on income, so that some lower-income families use lower-cost
providers--especially for home care--and some higher-income families--especially
those covered by LTCI--use higher-cost providers."

So assert BOTH:
1. Global range within **[$25,000, $210,000]**/yr.
2. **Floors and ceilings both strictly increase across Q2 < Q3 < Q4 < Q5.**

(2) is the real drift detector — it encodes endnote 9's income-price gradient as a
structural property, and it trips on a single mistyped cell in any row, which a
single global band does not. Do not weaken either assert to make a future edit
pass.

Mean reconstruction check (exponential tail + $2M cap, 200k-point integration)
reproduces published means to within 0.05%: Fourth 57,895 vs 57,900; Highest
75,362 vs 75,400. A 1% tolerance is ample. The cap is what costs the last 0.05%.

## Quintile definition — confirmed, endnote 11, verbatim
"We define income quintile by income relative to the federal poverty level... The
measure includes earnings, pensions, Social Security, Supplemental Security
Income, and asset income (defined as the annuitized value of financial assets)
received by individuals and, if married, their spouses."
Poverty-ratio based and couple-adjusted, exactly as the spec assumes.

## One more discrepancy, already handled
Endnote 14: Table 9's percent-with-expenditures uses a slightly less stringent
disability requirement than Table 2's percent-with-paid-use (49.3% vs 45.3%
overall). This is why the two tables disagree on who has care — and it is exactly
why the coupled draw conditions each distribution on its OWN has-care mass before
coupling, rather than coupling raw CDFs.

---

# ENGINE LAYER — wiring contract

## RNG stream
```rust
const LTC_STREAM_SALT: u64 = 0x9E37_79B9_7F4A_7C15; // odd; 64-bit golden ratio
let mut ltc_rng = ChaCha12Rng::seed_from_u64(config.seed ^ LTC_STREAM_SALT);
let u: f64 = ltc_rng.gen();
```
Draw `u` ONCE, at path start, before the year loop. Never pull from
`returns_generator`.

Why XOR and not `seed + N`: path seeds are `base_seed + path_index`, so any small
offset collides — an LTC stream at `seed + i + 1` *is* path i+1's market stream,
which would correlate every path's care draw with its neighbour's returns.

**Guard rail:** `historical_data.rs` L743-750
(`seed_42_sampling_has_pinned_year_and_block_results`) and
`parametric_returns.rs` L152 pin `ChaCha12Rng::seed_from_u64(42)` output. If
either goes red you have perturbed the market generator's draw order. Fix the
draw; never re-pin those tests.

## Age-65 income observation — the fiddly part

Quintile is resolved **per path**, from that path's own state at age 65. Draw `u`
at path start but defer both CDF inversions until the quintile is known; the
episode is charged at the end of the horizon, so the loop has long passed 65.

    income_at_65 = annuity_factor * portfolio_at_65 + other_income_at_65
    ratio        = income_at_65 / federal_poverty_level(household_size)

- `annuity_factor = r / (1 - (1+r)^-n)`, r = 0.025 real,
  `n = max(life_expectancy - 65, 5)`. 4.78% at n=30. Deliberately below the ~6%
  market annuity rate to stay consistent with the engine's real-terms basis —
  do not "correct" it upward.
- `portfolio_at_65` = total across all buckets in the year `current_age == 65`.
- `other_income_at_65` = that year's income as the engine already computes it
  (earnings if still working, plus Social Security if claimed). ASPE's measure is
  earnings + pensions + SS + SSI + annuitized assets; this engine models earnings,
  SS, and the portfolio, and has no pension or SSI concept. Do not invent one.
- `household_size` = `MarriedFilingJointly => 2, otherwise => 1`, local to the LTC
  path. Reuse `federal_poverty_level` from `simulation/healthcare_premiums.rs`
  (L19). Do NOT add a second FPL constant, and do NOT change `projection.rs` L732,
  which hardcodes `household_size: 1` for IRMAA on purpose.

### Edge cases you must handle explicitly
1. **Plan starts after 65** (`age > 65` at as-of date): there is no age-65 year in
   the loop. Use the FIRST modeled year's portfolio and income instead, and
   comment that this is a deliberate fallback. Common case — many users of this
   app are already retired.
2. **Plan ends before 65** (`life_expectancy < 65`): no episode. Return early.
3. **Retirement after 65**: at 65 the person may still be working, so
   `other_income_at_65` is earnings, not SS. That is on-label for ASPE's measure.
4. `n` floored at 5 as above, so a short horizon cannot blow up the annuity factor.

## Where the cost lands — three places at once
Deflate first: the table is 2020 dollars, the plan is in its own base year.
```
cost = episode.lifetime_cost_2020 * deflator_2020_to_base * config.cost_multiplier
```
Then, in the FINAL modeled year (end-anchored), add `cost` to all three of:
- `healthcare_cost`
- `hsa_qualified_allowance` (care services are fully deductible under IRC §213(d))
- `target_spending`

Follow the existing three-line pattern at `projection.rs` L743-753 exactly.

**Respect the existing cap** at L941-944:
`healthcare_cost: healthcare_cost.min(spending.max(0.0))` — it exists because
outcome cohorts average that field. LTC must not bypass it.

Per the user's decision the cost is charged **on top of** retirement spending, not
netted against it. Slightly conservative (someone in residential care stops paying
some ordinary living costs) — that is accepted, do not add a displacement factor.

## Deflator — DECIDED by the user 2026-08-23
Two separate factors, both apply. Conflating them is the mistake to avoid.

**1. Unit rebasing, 2020 -> plan base year.** NOT a growth assumption — a change
of unit. ASPE publishes in 2020 dollars. Use the repo's canonical BLS CPI series
(`data/market-history-annual.ts`, 1928-2025; the Rust table is generated from it),
factor `CPI_base / CPI_2020`. **No new constant, no hardcoded 1.25.**

**2. Real growth above inflation.** Reuse the EXISTING
`profile.retirement_healthcare.real_growth_rate`. The user was explicit: do not
add an LTC-specific growth field.

Applied as a **cohort adjustment, not an episode-timing adjustment**:
```
growth_years = (year person turns 65) - 2023   // ASPE cohort midpoint; may be negative
cost = lifetime_cost_2020
     * (cpi_base / cpi_2020)
     * (1 + real_growth_rate).powi(growth_years)
     * cost_multiplier
```
Compounding to the END OF HORIZON would be wrong: the ASPE figure is already a
whole-life total at DYNASIM's own price path, so ~30 years of excess inflation on
top double-counts the lifetime span. The 2023 cohort anchor is a judgment call and
lives in a named constant citing the ASPE cohort definition.

## Gate
Run the LTC block only when
`plan.schema_version >= LTC_MODEL_SCHEMA_VERSION && plan.profile.long_term_care.enabled`.
Mirrors the `HEALTHCARE_MODEL_SCHEMA_VERSION` gate at L714-719.

---

# LANDED: schema layer (commit 79c9f6e) — facts for downstream agents

- `PLAN_SCHEMA_VERSION` is now **7** in both languages.
  `LTC_MODEL_SCHEMA_VERSION = 7` exists in `types.rs` and is **currently unused** —
  the engine layer must gate on it.
- Config is live in both languages:
  Rust `profile.long_term_care: LongTermCare { enabled: bool, cost_multiplier: f64 }`,
  hand-written `impl Default` = `{ true, 1.0 }`.
  TS `profile.longTermCare: { enabled: boolean; costMultiplier: number }`,
  default `DEFAULT_LONG_TERM_CARE` in `data/tax-brackets-2025.ts`.
- **`longTermCare` is REQUIRED, not optional**, in the TS interface and the zod
  schema, with no zod `.default()`. Legacy input is covered by the two legacy
  normalizers plus `hydratePlan`. Anything constructing a profile from raw parts
  must supply the field or tsc fails.
- `cost_multiplier` clamp is `0.5..=3.0` in Rust and `min(0.5).max(3)` in zod.
- `validation.rs` had NO `#[cfg(test)]` block before; one now exists.
- `projection.rs` L1371 `test_plan()` already had `long_term_care: Default::default(),`
  added to it — the fixture constructs `UserProfile` literally. It is in the test
  module only.
- Six test fixture files gained one line each: engine-facing fixtures
  (`mc.test.ts`, `roth-conversion-lever.test.ts`, `simulation-service.test.ts`,
  `contracts/wasm-native-parity.test.ts`) got `{ enabled: false, costMultiplier: 1 }`
  so they stay inert; transport fixtures (`simulation-request.test.ts`,
  `api/cloud-routes.test.ts`) got `{ enabled: true, costMultiplier: 1 }`.
  **The engine agent should flip whichever it needs** — several of these will want
  LTC on to test the new path.
- `lib/simulation-request.ts` L48 was checked and deliberately left alone: it now
  accepts `<= 6` on the legacy branch, so an old bundle in flight keeps v6 pricing
  via the Rust gate while stored plans migrate ON and stamp v7 on next save.

---
---

# HANDOFF STATUS — read this first

Written 2026-08-23. Branch `lrc-model`, base `aeb9a3e`.

This file is **untracked and must stay untracked** — it is a working document,
not project documentation. `git status` will show it; do not `git add` it. Delete
it when the PR merges.

## Done

**Engine wiring — COMMITTED as `9cd812e`.** `projection.rs` only; `ltc.rs`
untouched. Rust 111 -> 124 tests, Wasm parity 7/7, every suite clean. Deflator is
fully derived, no magic number: CPI rebasing reads `inflation_rate` out of
`historical_data::HISTORICAL_RETURNS` (factor 1.2452018079501 for 2020->2025), and
real growth reuses `retirement_healthcare.real_growth_rate` compounded from
`LTC_COHORT_ANCHOR_YEAR = 2023`, clamped to +/-40 years.

Two corrections it made to this doc, both right: the no-episode guard is
`life_expectancy <= 65`, not `< 65` (it also guarantees the observation year is
strictly before the charged year, removing an ordering hazard); and a final
*working* year cannot occur, because `validation.rs` L75 requires
`life_expectancy > retirement_age`.

`test_plan()` now sets `long_term_care: { enabled: false, cost_multiplier: 1.0 }`
so existing projection tests stay pinned — deliberate, and it diverges from the
product default. Two existing tests were confirmed to move for a real reason
(`projections[1]` is the final year in both) rather than being blanket-updated.

**`wasm-pack` is a root devDependency but pnpm skips its build script.** Before
final PR verification: `pnpm install --frozen-lockfile && pnpm rebuild wasm-pack`.

**Data module — COMMITTED as `35988e9`.** `simulation/ltc.rs`, 12 tests, all
green; full Rust suite 111 passed, clippy `-D warnings` and fmt clean. The agent
assigned to it hit a session limit after writing the file but before registering
it in `mod.rs` or committing, so the work was recovered rather than redone. Public
surface is exactly as specified:
```rust
pub struct LtcEpisode { pub lifetime_cost_2020: f64, pub years: f64 }
pub enum IncomeQuintile { Second, Middle, Fourth, Highest }   // four, not five
pub fn quintile_for(income_to_fpl_ratio: f64) -> IncomeQuintile;
pub fn draw_episode(quintile: IncomeQuintile, u: f64) -> Option<LtcEpisode>;
```
Two data-integrity fields (`SpendingRow::quintile`, `DurationRow::no_care_percent`)
are read only by tests and carry `#[cfg_attr(not(test), allow(dead_code))]`; they
back the row-order and row-sum asserts that catch a transcription error. Do not
delete them to silence a warning.

**Schema layer — COMMITTED as `79c9f6e`.** All suites green at that commit
(Rust 99 passed, TS 143 passed, clippy/fmt/tsc/lint clean). Full detail in the
"LANDED: schema layer" section above. Nothing here needs revisiting.

**Research — COMPLETE, do not redo.** Every ASPE number in the "VERIFIED DATA"
section was extracted from the source PDF and independently recomputed. The
source memo had four errors, all corrected in this document. Do not re-derive
these numbers or fall back to the memo.

## Not started

**1. Engine wiring** (`projection.rs`) — brief is the "ENGINE LAYER" section.
Depends on (1). Note `projection.rs` L1371 `test_plan()` already carries
`long_term_care: Default::default()`.

**3. UI** (`components/retire/pages/profile.tsx`) — toggle + cost-multiplier dial
only. Healthcare's `DashboardCard` (L218-262) and `updateHealthcare` (L61-62) are
the templates. Scope was deliberately held to these two controls.

**3. Code docs audit.** Run the `code-docs-audit` skill across the whole feature
diff before opening the PR — every file touched by all four layers. The user asked
for this explicitly. It audits comments, docblocks, and developer docs against the
active standards (default to no comment; a comment must carry what the code
cannot) and fixes accepted findings in a scoped commit. Do this AFTER the UI lands
and BEFORE the PR, so it sees the finished diff.

**4. Final verification + PR.** Must include `pnpm wasm:build` — CI regenerates
the Wasm interface files and `git diff --exit-code`s them, so skipping it reds CI
with a diff rather than a test failure.

Full remaining sequence: engine -> UI -> docs audit -> wasm build -> full green -> PR.

## Decisions already made by the user — do not reopen
1. Episode cost lands **on top of** retirement spending, not netted.
2. LTC defaults **ON for every plan, including migrated v6 plans**. Existing
   plans' success rates will move. This is intended and is implemented.
3. UI scope is **toggle + multiplier dial only** — no with/without comparison.
4. Duration uses **Table 2's Highest-quintile row for all quintiles**.
5. **No results-view note** about success rates moving. Asked and declined.

## Resolved 2026-08-23: NO results-view note
Defaulting ON means every existing plan's success rate drops when this ships. I
proposed a one-line note in the results view explaining why. **The user declined.
Do not build it and do not re-propose it.**

Separately, the spec's "Known UX wart" section documents a narrower, already-
identified problem: the cash-flow table renders the median-terminal-wealth path
and ~52% of paths have no episode, so it will usually show zero care cost while
the success rate drops. That one is part of the design and needs copy.

## Traps that will bite you
- **RNG**: draw from a separate `ChaCha12Rng` seeded `config.seed ^ 0x9E37_79B9_7F4A_7C15`.
  Never a small offset (path seeds are `base + path_index`, so `seed + i + 1` IS
  path i+1's market stream). If `historical_data.rs` L743-750 or
  `parametric_returns.rs` L152 go red, you perturbed the market draw order — fix
  the draw, never re-pin those tests.
- **Units**: tables are 2020 dollars; the deflator is applied in the engine, never
  in the table module. The field is named `lifetime_cost_2020` so misuse reads
  wrong at the call site.
- **Normalize every ASPE row** by its own sum before calibrating. Only the Highest
  row is affected (sums to 100.2) but the code path must be uniform.
- **Q1 must not ship** — clamp to Q2, and assert the clamp.
- `pnpm test` runs vitest in WATCH mode. Use `pnpm exec vitest run`.

---

# UI DESIGN — approved direction, execute AFTER the engine lands

A full design pass on the "Retirement healthcare" card, which must absorb the LTC
controls. Do not treat this as "add two controls to the existing card" — the card
is already muddled and adding to it as-is makes it worse.

A working draft of the implementation exists at
`scratchpad/profile.draft.tsx` (session scratchpad, may be gone — the spec below
is authoritative either way). `apps/web/src/components/ui/switch.tsx` is already
written and committed-ready: a shadcn-idiom Switch over `@radix-ui/react-switch`,
which ships inside the unified `radix-ui` package already in `package.json`. There
was no Switch primitive in the repo before.

## The diagnosis
The four inputs are laid out as peers but are not peers:
- `preMedicarePremium` and `medicarePremium` are the SAME quantity at two life
  phases.
- `outOfPocket` applies to BOTH phases.
- `realGrowthRate` modifies all three.

The two preview tiles silently do the arithmetic (15,900 + 3,000 = 18,900) while
the input order does not mirror it, so nothing on screen reveals that
out-of-pocket is shared. That is the actual mess.

## The structure — position encodes scope
A three-column matrix: row-label | Before 65 | From 65.

```
                 BEFORE 65              FROM 65
                 Marketplace or COBRA   Medicare
  Premiums       [ $15,900 ]            [ $4,650 ]
  Out-of-pocket  [ $3,000 ]  Both phases
  ----------------------------------------------
  Per year       $18,900                $7,650
  Growth         [ 3 ]  % a year above inflation
```

Four moves, each with a reason:
1. **Out-of-pocket spans both columns.** It applies to both, and now that is
   visible instead of buried in tile arithmetic.
2. **Column totals replace the preview tiles.** Same numbers, but under the inputs
   that produce them, so the sum reads down the column.
3. **Growth leaves the input row.** It modifies the totals over time, so it
   attaches to them rather than posing as a fourth peer dollar amount.
4. **Phase captions move into the headers.** "Marketplace or COBRA" and "Part B,
   Part D, and supplemental" were stranded in tiles; they belong where the number
   is chosen. Shorten the second to "Medicare".

## Long-term care is a separate band, not a fifth input
Below a `border-t`, its own heading, a Switch on the right, and the cost-level
input revealed only when enabled. LTC is a probabilistic risk, not a recurring
annual cost — flattening those two mental models into one row is what would make
the card messy again.

Label the multiplier **"Cost level"**, not "cost multiplier" — name what the
person controls, not how the engine is built. Hint: `National average · California ≈ 1.2`.
Step 0.05, min 0.5, max 3 (matching the zod and Rust clamps).

Sub-line under the heading: "A possible care episode, drawn per scenario from
national spending data." One line. Do not explain the ASPE methodology in the UI.

## Copy
Card description: "Today's dollars, whole household. Added to your spending target."

The HSA paragraph goes from three lines to one, losing nothing:
"An HSA covers out-of-pocket, Medicare, COBRA, and long-term care — not
marketplace premiums."

House style: sentence case, active voice, no filler, status lines carry state
rather than definitions. No wordy statements anywhere in this card.

**Per an explicit user decision there is NO note anywhere explaining that success
rates moved because LTC now defaults on.** Do not add one.

## Implementation notes
- `CurrencyField` and `NumberField` need an optional label: when the row and
  column headers already name the field, render the bare `Input` with an
  `aria-label` instead of the `Wrap`. Make `label` optional and add `ariaLabel`.
  Every matrix cell must still be labelled for screen readers.
- `SpendingPreview` is still used by the spending card — **do not delete it**,
  only stop using it in the healthcare card. (Deleting it breaks the build; this
  was hit during the draft.)
- The row-label column plus two inputs is tight at 375px. Verify responsively and
  adjust the label column or stack if it does not hold.
- Keyboard focus must stay visible, and the Switch must be reachable and operable.
