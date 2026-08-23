//! Long-term care episodes: one lifetime out-of-pocket LTSS bill per path,
//! drawn from the empirical distribution rather than modeled as a rate.
//!
//! Source: ASPE Research Brief, August 2022 (revised), "Long-Term Services and
//! Supports for Older Americans: Risks and Financing, 2022" (Favreault et al.,
//! Urban Institute; DYNASIM4 run id982; cohort turning 65 in 2021-2025).
//! Table 9 is lifetime family out-of-pocket LTSS spending by income quintile;
//! Table 2 is years of paid LTSS.
//!
//! The module is pure data and inverse-CDF math. It holds no plan config, does
//! no RNG seeding, and applies no price deflator: the caller supplies the
//! uniform and converts 2020 dollars to the plan's base year.

use std::sync::LazyLock;

/// One path's lifetime long-term care episode.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LtcEpisode {
    /// Lifetime out-of-pocket LTSS cost in 2020 dollars, the basis ASPE
    /// publishes and the basis these tables are calibrated against. Spending it
    /// without deflating to the plan's base year understates by roughly 25% and
    /// nothing else in the engine will notice.
    pub lifetime_cost_2020: f64,
    /// Years of paid LTSS measured in service days, where 365 paid days count as
    /// one year regardless of how many calendar years they span (ASPE p5). This
    /// is care intensity, not elapsed time, which is why the engine works in
    /// dollars and uses years only as a sanity check on the implied rate.
    pub years: f64,
}

/// ASPE's income quintiles at 65, less the lowest. `quintile_for` documents why
/// the lowest row cannot ship.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IncomeQuintile {
    Second,
    Middle,
    Fourth,
    Highest,
}

impl IncomeQuintile {
    fn index(self) -> usize {
        match self {
            IncomeQuintile::Second => 0,
            IncomeQuintile::Middle => 1,
            IncomeQuintile::Fourth => 2,
            IncomeQuintile::Highest => 3,
        }
    }
}

/// Income relative to the federal poverty level at the top of each quintile,
/// from Brookings, "Seven Facts About the Economic Security of Older Adults,"
/// Online Appendix Table 2 (CPS ASEC).
const LOWEST_QUINTILE_CEILING: f64 = 1.51;
const SECOND_QUINTILE_CEILING: f64 = 2.59;
const MIDDLE_QUINTILE_CEILING: f64 = 3.96;
const FOURTH_QUINTILE_CEILING: f64 = 6.33;

/// Maps income at 65 as a multiple of the federal poverty level to the ASPE
/// quintile whose spending distribution the path draws from. ASPE's own income
/// measure (endnote 11) is earnings, pensions, Social Security, SSI, and the
/// annuitized value of financial assets, for the individual and any spouse.
///
/// The lowest quintile is deliberately absent and its range returns `Second`.
/// ASPE's lowest row is internally inconsistent: its closed buckets contribute
/// $15,187.50 at uniform midpoints and 3.4% of the row sits above $250,000, so
/// the smallest mean the row can produce is $23,687.50 against a published mean
/// of $15,400. Calibrating a tail against that shortfall yields a mean excess of
/// -$243,750. There is no repair that keeps the published mean, so the row does
/// not ship.
pub fn quintile_for(income_to_fpl_ratio: f64) -> IncomeQuintile {
    if income_to_fpl_ratio < LOWEST_QUINTILE_CEILING {
        return IncomeQuintile::Second;
    }
    if income_to_fpl_ratio < SECOND_QUINTILE_CEILING {
        return IncomeQuintile::Second;
    }
    if income_to_fpl_ratio < MIDDLE_QUINTILE_CEILING {
        return IncomeQuintile::Middle;
    }
    if income_to_fpl_ratio < FOURTH_QUINTILE_CEILING {
        return IncomeQuintile::Fourth;
    }
    IncomeQuintile::Highest
}

/// Draws a path's episode from a single uniform, read against the spending and
/// duration distributions at the same quantile so that large bills land on long
/// episodes. Independent draws produce $300,000 spent over four months.
///
/// Returns `None` when the path has no out-of-pocket LTSS spending at all.
///
/// The two tables disagree about who receives care: Table 9 counts 41.5% with
/// any out-of-pocket spending in the highest quintile against Table 2's 43.7%
/// with any paid use, because Table 9 applies a less stringent disability
/// requirement (ASPE endnote 14). Coupling the raw CDFs would therefore open a
/// band where the draw has years of care and no cost. Each distribution is
/// conditioned on its own has-care mass first, and only the conditional
/// quantiles are coupled.
pub fn draw_episode(quintile: IncomeQuintile, u: f64) -> Option<LtcEpisode> {
    let model = &SPENDING_MODELS[quintile.index()];
    if u < model.no_spending_probability {
        return None;
    }

    let conditional_quantile = ((u - model.no_spending_probability)
        / (1.0 - model.no_spending_probability))
        .clamp(0.0, 1.0);

    Some(LtcEpisode {
        lifetime_cost_2020: spending_for(model, conditional_quantile),
        years: years_for(conditional_quantile),
    })
}

/// Table 9's closed spending buckets as printed: "<$10,000", "$10,000-$24,999",
/// and so on. The printed $24,999/$25,000 style gaps are rounding artifacts, so
/// the bounds are closed up into contiguous half-open intervals.
const SPENDING_BUCKETS: [(f64, f64); 8] = [
    (0.0, 10_000.0),
    (10_000.0, 25_000.0),
    (25_000.0, 50_000.0),
    (50_000.0, 75_000.0),
    (75_000.0, 100_000.0),
    (100_000.0, 150_000.0),
    (150_000.0, 200_000.0),
    (200_000.0, 250_000.0),
];

const SPENDING_TAIL_FLOOR: f64 = 250_000.0;

/// The open-ended top bucket needs a bound to keep a path finite. At $2,000,000
/// the truncation costs less than 0.2% of each row's mean, inside the 1%
/// tolerance the published means are asserted at.
const SPENDING_CAP: f64 = 2_000_000.0;

/// Table 2's closed duration buckets as printed: "<1 Year", "1.00-1.99",
/// "2.00-4.99".
const DURATION_BUCKETS: [(f64, f64); 3] = [(0.0, 1.0), (1.0, 2.0), (2.0, 5.0)];

const DURATION_TAIL_FLOOR: f64 = 5.0;

/// A longer cap would price the worst path below a California semi-private
/// nursing home room, breaking the implied-rate invariant the tests assert.
const DURATION_CAP: f64 = 10.0;

struct SpendingRow {
    /// Read only by the tests, which assert each row sits at its own index.
    /// Transcribing a row into the wrong slot is otherwise undetectable.
    #[cfg_attr(not(test), allow(dead_code))]
    quintile: IncomeQuintile,
    published_mean: f64,
    no_spending_percent: f64,
    closed_percent: [f64; 8],
    top_percent: f64,
}

/// Table 9, in 2020 dollars. Rows are ordered to match `IncomeQuintile::index`.
const SPENDING_ROWS: [SpendingRow; 4] = [
    SpendingRow {
        quintile: IncomeQuintile::Second,
        published_mean: 34_200.0,
        no_spending_percent: 67.1,
        closed_percent: [6.2, 4.5, 4.2, 4.4, 2.3, 3.8, 1.9, 1.2],
        top_percent: 4.4,
    },
    SpendingRow {
        quintile: IncomeQuintile::Middle,
        published_mean: 43_200.0,
        no_spending_percent: 65.3,
        closed_percent: [6.1, 4.8, 4.7, 3.5, 1.5, 3.9, 2.0, 1.9],
        top_percent: 6.3,
    },
    SpendingRow {
        quintile: IncomeQuintile::Fourth,
        published_mean: 57_900.0,
        no_spending_percent: 61.9,
        closed_percent: [6.2, 5.7, 4.4, 2.9, 2.5, 3.7, 2.8, 2.0],
        top_percent: 7.9,
    },
    SpendingRow {
        quintile: IncomeQuintile::Highest,
        published_mean: 75_400.0,
        no_spending_percent: 58.5,
        closed_percent: [5.6, 5.6, 4.7, 3.5, 3.3, 3.7, 3.1, 1.9],
        top_percent: 10.3,
    },
];

/// Table 2's highest-quintile row, used for every quintile. Duration is nearly
/// flat across quintiles (0.7 to 1.2 average years) while spending is not, so
/// the quintile-specific spread lives entirely in the dollar tables.
const DURATION_ROW: DurationRow = DurationRow {
    no_care_percent: 56.3,
    closed_percent: [22.9, 7.7, 10.1],
    top_percent: 3.1,
};

struct DurationRow {
    /// Not used to build the model, which conditions on the has-care mass. Kept
    /// so the tests can assert the row sums to 100 and catch a mistyped cell.
    #[cfg_attr(not(test), allow(dead_code))]
    no_care_percent: f64,
    closed_percent: [f64; 3],
    top_percent: f64,
}

struct SpendingModel {
    no_spending_probability: f64,
    /// Conditional cumulative probability at the upper edge of each closed
    /// bucket. The last entry is where the open-ended tail begins.
    cumulative: [f64; 8],
    /// Mean of the exponential excess above `SPENDING_TAIL_FLOOR`.
    tail_mean_excess: f64,
}

struct DurationModel {
    cumulative: [f64; 3],
}

/// Conditional cumulative probabilities over the closed buckets, given that the
/// path has care at all.
fn conditional_cumulative<const N: usize>(closed_percent: &[f64; N], top_percent: f64) -> [f64; N] {
    let has_care_percent = closed_percent.iter().sum::<f64>() + top_percent;
    let mut cumulative = [0.0; N];
    let mut running = 0.0;
    for (slot, percent) in cumulative.iter_mut().zip(closed_percent) {
        running += percent;
        *slot = running / has_care_percent;
    }
    cumulative
}

/// ASPE's rows do not all sum to 100 - the highest quintile sums to 100.2 - so
/// every row is divided by its own sum before anything is derived from it. The
/// difference is not cosmetic: the highest quintile calibrates to a tail mean
/// excess of $265,809 normalized against $264,345 raw.
fn build_spending_model(row: &SpendingRow) -> SpendingModel {
    let row_sum =
        row.no_spending_percent + row.closed_percent.iter().sum::<f64>() + row.top_percent;
    let probability = |percent: f64| percent / row_sum;

    let closed_contribution: f64 = row
        .closed_percent
        .iter()
        .zip(SPENDING_BUCKETS)
        .map(|(percent, (low, high))| probability(*percent) * f64::midpoint(low, high))
        .sum();
    let top_probability = probability(row.top_percent);

    SpendingModel {
        no_spending_probability: probability(row.no_spending_percent),
        cumulative: conditional_cumulative(&row.closed_percent, row.top_percent),
        tail_mean_excess: (row.published_mean - closed_contribution) / top_probability
            - SPENDING_TAIL_FLOOR,
    }
}

static SPENDING_MODELS: LazyLock<[SpendingModel; 4]> =
    LazyLock::new(|| SPENDING_ROWS.each_ref().map(build_spending_model));

static DURATION: LazyLock<DurationModel> = LazyLock::new(|| DurationModel {
    cumulative: conditional_cumulative(&DURATION_ROW.closed_percent, DURATION_ROW.top_percent),
});

/// Inverts the conditional CDF within the closed buckets, spreading each bucket
/// uniformly. Returns `None` when the quantile falls in the open-ended tail.
fn invert_closed_buckets<const N: usize>(
    quantile: f64,
    cumulative: &[f64; N],
    buckets: &[(f64, f64); N],
) -> Option<f64> {
    let mut lower_cumulative = 0.0;
    for (upper_cumulative, (low, high)) in cumulative.iter().zip(buckets) {
        if quantile < *upper_cumulative {
            let mass = upper_cumulative - lower_cumulative;
            let position = if mass > 0.0 {
                (quantile - lower_cumulative) / mass
            } else {
                0.0
            };
            return Some(low + position * (high - low));
        }
        lower_cumulative = *upper_cumulative;
    }
    None
}

fn tail_position(quantile: f64, tail_entry: f64) -> f64 {
    ((quantile - tail_entry) / (1.0 - tail_entry)).clamp(0.0, 1.0)
}

fn spending_for(model: &SpendingModel, quantile: f64) -> f64 {
    if let Some(dollars) = invert_closed_buckets(quantile, &model.cumulative, &SPENDING_BUCKETS) {
        return dollars;
    }
    // ASPE prints only "$250,000 or more", so the shape above the threshold is a
    // modeling choice and the row mean is the one calibrated moment. Memoryless
    // above the threshold keeps the choice to a single parameter.
    let position = tail_position(quantile, model.cumulative[SPENDING_BUCKETS.len() - 1]);
    (SPENDING_TAIL_FLOOR - model.tail_mean_excess * (1.0 - position).ln()).min(SPENDING_CAP)
}

fn years_for(quantile: f64) -> f64 {
    if let Some(years) = invert_closed_buckets(quantile, &DURATION.cumulative, &DURATION_BUCKETS) {
        return years;
    }
    let position = tail_position(quantile, DURATION.cumulative[DURATION_BUCKETS.len() - 1]);
    DURATION_TAIL_FLOOR + position * (DURATION_CAP - DURATION_TAIL_FLOOR)
}

#[cfg(test)]
mod tests {
    use super::*;

    const QUINTILES: [IncomeQuintile; 4] = [
        IncomeQuintile::Second,
        IncomeQuintile::Middle,
        IncomeQuintile::Fourth,
        IncomeQuintile::Highest,
    ];

    /// Both the mean integration and the implied-rate extremes are quadrature
    /// over a midpoint grid, and the tail extremes are resolution-dependent:
    /// the sampled ceiling approaches `SPENDING_CAP / DURATION_CAP` as the grid
    /// refines. The expected values below are pinned at this count.
    const SAMPLE_COUNT: usize = 200_000;

    fn conditional_quantiles() -> impl Iterator<Item = f64> {
        (0..SAMPLE_COUNT).map(|i| (i as f64 + 0.5) / SAMPLE_COUNT as f64)
    }

    fn episodes(quintile: IncomeQuintile) -> impl Iterator<Item = LtcEpisode> {
        let no_spending = SPENDING_MODELS[quintile.index()].no_spending_probability;
        conditional_quantiles().map(move |v| {
            draw_episode(quintile, no_spending + v * (1.0 - no_spending))
                .expect("quantiles above the no-spending mass always produce an episode")
        })
    }

    fn implied_annual_rates(quintile: IncomeQuintile) -> (f64, f64) {
        episodes(quintile).fold((f64::MAX, f64::MIN), |(floor, ceiling), episode| {
            let rate = episode.lifetime_cost_2020 / episode.years;
            (floor.min(rate), ceiling.max(rate))
        })
    }

    #[test]
    fn model_order_matches_quintile_index() {
        for quintile in QUINTILES {
            assert_eq!(SPENDING_ROWS[quintile.index()].quintile, quintile);
        }
    }

    #[test]
    fn published_rows_sum_to_one_hundred_percent() {
        for row in &SPENDING_ROWS {
            let total: f64 =
                row.no_spending_percent + row.closed_percent.iter().sum::<f64>() + row.top_percent;
            assert!(
                (total - 100.0).abs() < 0.25,
                "Table 9 row {:?} sums to {total}, not 100",
                row.quintile
            );
        }
        let duration: f64 = DURATION_ROW.no_care_percent
            + DURATION_ROW.closed_percent.iter().sum::<f64>()
            + DURATION_ROW.top_percent;
        assert!(
            (duration - 100.0).abs() < 0.25,
            "Table 2 row sums to {duration}, not 100"
        );
    }

    #[test]
    fn calibrated_tail_mean_excess_matches_published_figures() {
        let expected = [113_409.0, 133_214.0, 217_310.0, 265_809.0];
        for (quintile, expected) in QUINTILES.into_iter().zip(expected) {
            let actual = SPENDING_MODELS[quintile.index()].tail_mean_excess;
            assert!(
                (actual - expected).abs() < 1.0,
                "{quintile:?} tail mean excess {actual} vs {expected}"
            );
        }
    }

    #[test]
    fn published_means_are_reproduced() {
        for (quintile, row) in QUINTILES.into_iter().zip(&SPENDING_ROWS) {
            let mean = (0..SAMPLE_COUNT)
                .map(|i| {
                    let u = (i as f64 + 0.5) / SAMPLE_COUNT as f64;
                    draw_episode(quintile, u).map_or(0.0, |e| e.lifetime_cost_2020)
                })
                .sum::<f64>()
                / SAMPLE_COUNT as f64;
            let error = (mean - row.published_mean).abs() / row.published_mean;
            assert!(
                error < 0.01,
                "{quintile:?} mean {mean} vs published {}",
                row.published_mean
            );
        }
    }

    #[test]
    fn normalized_rows_sum_to_one() {
        for row in &SPENDING_ROWS {
            let sum =
                row.no_spending_percent + row.closed_percent.iter().sum::<f64>() + row.top_percent;
            let normalized = (row.no_spending_percent
                + row.closed_percent.iter().sum::<f64>()
                + row.top_percent)
                / sum;
            assert!((normalized - 1.0).abs() < 1e-12);
        }

        let duration_sum = DURATION_ROW.no_care_percent
            + DURATION_ROW.closed_percent.iter().sum::<f64>()
            + DURATION_ROW.top_percent;
        assert!((duration_sum / duration_sum - 1.0).abs() < 1e-12);

        for quintile in QUINTILES {
            let model = &SPENDING_MODELS[quintile.index()];
            let tail = 1.0 - model.cumulative[SPENDING_BUCKETS.len() - 1];
            assert!(tail > 0.0, "{quintile:?} has no tail mass");
        }
    }

    #[test]
    fn no_episode_below_the_no_spending_probability() {
        for quintile in QUINTILES {
            let no_spending = SPENDING_MODELS[quintile.index()].no_spending_probability;
            assert!(no_spending > 0.5, "{quintile:?} no-spending {no_spending}");
            for i in 0..1_000 {
                let u = no_spending * (i as f64 / 1_000.0);
                assert_eq!(draw_episode(quintile, u), None, "{quintile:?} at u={u}");
            }
            assert!(draw_episode(quintile, no_spending).is_some());
        }
    }

    #[test]
    fn cost_and_years_are_non_decreasing_in_u() {
        for quintile in QUINTILES {
            let mut previous = LtcEpisode {
                lifetime_cost_2020: 0.0,
                years: 0.0,
            };
            for episode in episodes(quintile) {
                assert!(
                    episode.lifetime_cost_2020 >= previous.lifetime_cost_2020,
                    "{quintile:?} cost fell from {} to {}",
                    previous.lifetime_cost_2020,
                    episode.lifetime_cost_2020
                );
                assert!(
                    episode.years >= previous.years,
                    "{quintile:?} years fell from {} to {}",
                    previous.years,
                    episode.years
                );
                previous = episode;
            }
        }
    }

    #[test]
    fn implied_annual_rate_stays_within_global_band() {
        for quintile in QUINTILES {
            let (floor, ceiling) = implied_annual_rates(quintile);
            assert!(
                floor >= 25_000.0 && ceiling <= 210_000.0,
                "{quintile:?} implied rate {floor}..{ceiling}"
            );
        }
    }

    /// DYNASIM4 varies LTSS prices by income (ASPE endnote 9), so a lower
    /// quintile drawing the same durations from Table 2 must imply a lower
    /// annual rate at both ends. A single mistyped table cell moves one of these
    /// eight figures well past the tolerance; do not widen it to make an edit
    /// pass.
    #[test]
    fn implied_annual_rate_floors_and_ceilings_increase_with_income() {
        let expected = [
            (27_744.0, 148_475.0),
            (29_741.0, 174_110.0),
            (32_129.0, 200_088.0),
            (38_932.0, 200_478.0),
        ];

        let mut previous: Option<(f64, f64)> = None;
        for (quintile, (expected_floor, expected_ceiling)) in QUINTILES.into_iter().zip(expected) {
            let (floor, ceiling) = implied_annual_rates(quintile);
            assert!(
                (floor - expected_floor).abs() < 10.0,
                "{quintile:?} floor {floor} vs {expected_floor}"
            );
            assert!(
                (ceiling - expected_ceiling).abs() < 10.0,
                "{quintile:?} ceiling {ceiling} vs {expected_ceiling}"
            );
            if let Some((previous_floor, previous_ceiling)) = previous {
                assert!(floor > previous_floor, "{quintile:?} floor {floor}");
                assert!(ceiling > previous_ceiling, "{quintile:?} ceiling {ceiling}");
            }
            previous = Some((floor, ceiling));
        }
    }

    #[test]
    fn lowest_quintile_clamps_to_second() {
        for ratio in [0.0, 0.4, 1.0, 1.5099] {
            assert_eq!(quintile_for(ratio), IncomeQuintile::Second, "ratio {ratio}");
        }
    }

    #[test]
    fn quintile_boundaries_match_brookings_cutoffs() {
        assert_eq!(quintile_for(1.51), IncomeQuintile::Second);
        assert_eq!(quintile_for(2.58), IncomeQuintile::Second);
        assert_eq!(quintile_for(2.59), IncomeQuintile::Middle);
        assert_eq!(quintile_for(3.95), IncomeQuintile::Middle);
        assert_eq!(quintile_for(3.96), IncomeQuintile::Fourth);
        assert_eq!(quintile_for(6.32), IncomeQuintile::Fourth);
        assert_eq!(quintile_for(6.33), IncomeQuintile::Highest);
        assert_eq!(quintile_for(50.0), IncomeQuintile::Highest);
    }

    #[test]
    fn extreme_uniforms_respect_the_caps() {
        for quintile in QUINTILES {
            assert_eq!(draw_episode(quintile, 0.0), None);

            let episode = draw_episode(quintile, 1.0).expect("u=1 is above the no-spending mass");
            assert_eq!(episode.lifetime_cost_2020, SPENDING_CAP);
            assert_eq!(episode.years, DURATION_CAP);
        }
    }
}
