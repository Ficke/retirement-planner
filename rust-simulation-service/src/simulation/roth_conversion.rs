//! Roth conversions during the gap years between retirement and RMDs.
//!
//! Used by both native and WebAssembly adapters, so all targets share these
//! semantics.

use crate::simulation::healthcare_premiums::irmaa_free_magi_ceiling;
use crate::simulation::tax::{
    calculate_retirement_tax, federal_bracket_top, retirement_taxable_income, Household,
};
use crate::types::{RothConversionCeiling, RothConversionPolicy, State};

pub struct RothConversionInput<'a> {
    pub policy: RothConversionPolicy,
    /// Ordinary income the year has already realized, before any conversion.
    pub traditional_withdrawals: f64,
    pub social_security_benefit: f64,
    pub qualified_income: f64,
    /// Taxable-account withdrawals, which reach MAGI at the plan's gain ratio.
    pub taxable_withdrawals: f64,
    pub taxable_gain_ratio: f64,
    pub household: &'a Household,
    pub state: &'a State,
    pub tax_year: i32,
    pub traditional_balance: f64,
    pub taxable_balance: f64,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct RothConversion {
    /// Pre-tax dollars leaving the Traditional bucket.
    pub converted: f64,
    /// Tax the conversion adds to the year, over and above its other tax.
    pub tax: f64,
    /// Tax funded by selling from taxable, which keeps the Roth whole.
    pub from_taxable: f64,
    /// Tax withheld out of the conversion, so those dollars never reach the Roth.
    pub withheld: f64,
}

/// The loop shrinks its error by roughly a gain share times a marginal rate each
/// pass, so four settle any balance this model can hold to a few dollars -- well
/// inside the resolution of the ceilings being aimed at.
const SETTLING_PASSES: usize = 4;

/// Cap on root-finding steps. False position resolves a piecewise-linear
/// measure in a handful; the cap only matters if a kink lands badly, and the
/// bisection safeguard below keeps even that case converging.
const SOLVE_STEPS: usize = 24;

/// Whole dollars is the answer's resolution, so a narrower bracket is waste.
const SOLVE_TOLERANCE: f64 = 1.0;

struct Outcome {
    tax: f64,
    from_taxable: f64,
    withheld: f64,
    /// Gain realized selling to pay, which counts toward MAGI like any other.
    funding_gain: f64,
}

/// A conversion and everything that follows from its size: what it costs, which
/// dollars pay for it, and the capital gain those dollars realize on the way out.
///
/// Paying the bill from taxable is what makes the trade worth doing -- every
/// converted dollar then compounds tax-free -- so taxable funds it while it
/// lasts, and only the remainder is withheld from the conversion itself.
///
/// Selling to pay is a taxable event of its own, and the gain it realizes feeds
/// back into the tax that prompted the sale. Each pass closes more of that loop.
fn outcome_of(conversion: f64, input: &RothConversionInput, base_tax: f64) -> Outcome {
    let taxable_balance = input.taxable_balance.max(0.0);
    let mut qualified_income = input.qualified_income;
    let mut tax = 0.0;
    let mut from_taxable = 0.0;

    for _ in 0..SETTLING_PASSES {
        tax = (tax_of(conversion, qualified_income, input) - base_tax).max(0.0);
        from_taxable = tax.min(taxable_balance);
        qualified_income = input.qualified_income + from_taxable * input.taxable_gain_ratio;
    }

    Outcome {
        tax,
        from_taxable,
        withheld: conversion.min(tax - from_taxable),
        funding_gain: from_taxable * input.taxable_gain_ratio,
    }
}

/// The largest conversion a year can absorb without breaching its ceiling, and
/// what that conversion costs.
///
/// Headroom is solved rather than subtracted because a converted dollar does not
/// raise the measured quantity by a dollar. Against a bracket top it drags more
/// of the Social Security benefit into taxable income; against either ceiling it
/// also forces the sale that pays its own tax, and the gain on that sale counts
/// too. Each candidate is measured against the sale it would itself require, so
/// the amount that gets reported is one the ceiling has already been checked
/// against -- which matters most for the IRMAA ceiling, where a dollar over buys
/// a whole tier and there is no partial credit for being close.
///
/// Both measures rise monotonically with the amount converted, so the root is
/// bracketed from the start and the search only has to narrow it.
pub fn roth_conversion_for(input: &RothConversionInput) -> RothConversion {
    if !input.policy.enabled || input.traditional_balance <= 0.0 {
        return RothConversion::default();
    }

    let Some(limit) = ceiling_limit(input) else {
        return RothConversion::default();
    };
    let base_tax = tax_of(0.0, input.qualified_income, input);
    // How far a candidate sits over its ceiling, negative while it still fits.
    let gap_at = |conversion: f64| {
        measure(
            conversion,
            outcome_of(conversion, input, base_tax).funding_gain,
            input,
        ) - limit
    };

    if gap_at(0.0) >= 0.0 {
        return RothConversion::default();
    }
    if gap_at(input.traditional_balance) <= 0.0 {
        return settle(input.traditional_balance, input, base_tax);
    }

    // Ordinary income cannot outrun the ceiling by more than the untaxed benefit
    // and the deductions sitting under it, so the search never needs a wider
    // bracket to start from.
    //
    // Both measures are piecewise linear in the amount converted -- progressive
    // brackets and the Social Security phase-in are each a run of straight
    // segments -- so interpolating between the bracket's ends lands on or very
    // near the root instead of merely halving the interval. Every other step
    // bisects regardless, which bounds the worst case when a kink falls between
    // the two ends and interpolation would otherwise crawl.
    let mut low = 0.0;
    let mut low_gap = gap_at(low);
    let mut high = input
        .traditional_balance
        .min(2.0 * limit + input.social_security_benefit);
    let mut high_gap = gap_at(high);

    let mut step = 0;
    while step < SOLVE_STEPS && high - low > SOLVE_TOLERANCE {
        let interpolate = step % 2 == 0 && high_gap > low_gap;
        let guess = if interpolate {
            low + (high - low) * -low_gap / (high_gap - low_gap)
        } else {
            (low + high) / 2.0
        };
        // Interpolation can land on an endpoint; nudge inside so the bracket
        // shrinks.
        let mid = guess
            .max(low + (high - low) / 64.0)
            .min(high - (high - low) / 64.0);

        let gap = gap_at(mid);
        if gap <= 0.0 {
            low = mid;
            low_gap = gap;
        } else {
            high = mid;
            high_gap = gap;
        }
        step += 1;
    }

    // Whole dollars, rounded down. Nobody converts a fraction of a cent, and
    // pinning the result to an integer preserves exact results across native
    // and WebAssembly targets: bisection alone can land a hair apart.
    settle(low.floor(), input, base_tax)
}

fn ceiling_limit(input: &RothConversionInput) -> Option<f64> {
    let filing_status = &input.household.filing_status;
    match input.policy.ceiling {
        RothConversionCeiling::IrmaaTier => Some(irmaa_free_magi_ceiling(*filing_status)),
        RothConversionCeiling::Bracket12 => federal_bracket_top(0.12, filing_status),
        RothConversionCeiling::Bracket22 => federal_bracket_top(0.22, filing_status),
        RothConversionCeiling::Bracket24 => federal_bracket_top(0.24, filing_status),
        RothConversionCeiling::Bracket32 => federal_bracket_top(0.32, filing_status),
    }
}

fn measure(conversion: f64, funding_gain: f64, input: &RothConversionInput) -> f64 {
    if input.policy.ceiling == RothConversionCeiling::IrmaaTier {
        // Mirrors how the projection reports MAGI: the whole benefit, every
        // ordinary withdrawal, and the gain portion of what taxable paid out.
        return input.social_security_benefit
            + input.traditional_withdrawals
            + conversion
            + input.taxable_withdrawals * input.taxable_gain_ratio
            + funding_gain;
    }
    retirement_taxable_income(
        input.traditional_withdrawals + conversion,
        input.social_security_benefit,
        input.qualified_income + funding_gain,
        input.household,
        input.tax_year,
    )
}

fn tax_of(conversion: f64, qualified_income: f64, input: &RothConversionInput) -> f64 {
    calculate_retirement_tax(
        input.traditional_withdrawals + conversion,
        input.social_security_benefit,
        qualified_income,
        input.household,
        input.state,
        input.tax_year,
    )
    .total_tax
}

fn settle(converted: f64, input: &RothConversionInput, base_tax: f64) -> RothConversion {
    if converted <= 0.0 {
        return RothConversion::default();
    }
    let outcome = outcome_of(converted, input, base_tax);
    RothConversion {
        converted,
        tax: outcome.tax,
        from_taxable: outcome.from_taxable,
        withheld: outcome.withheld,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::FilingStatus;

    fn input_for<'a>(
        ceiling: RothConversionCeiling,
        household: &'a Household,
        state: &'a State,
    ) -> RothConversionInput<'a> {
        RothConversionInput {
            policy: RothConversionPolicy {
                enabled: true,
                ceiling,
            },
            traditional_withdrawals: 8_000.0,
            social_security_benefit: 0.0,
            qualified_income: 2_000.0,
            taxable_withdrawals: 4_000.0,
            taxable_gain_ratio: 0.5,
            household,
            state,
            tax_year: 2025,
            traditional_balance: 2_000_000.0,
            taxable_balance: 1_000_000.0,
        }
    }

    #[test]
    fn conversion_fills_the_selected_bracket_without_crossing_it() {
        let household = Household::single(FilingStatus::Single, 65);
        let state = State::CA;
        let input = input_for(RothConversionCeiling::Bracket22, &household, &state);
        let conversion = roth_conversion_for(&input);
        let bracket_top = federal_bracket_top(0.22, &household.filing_status).unwrap();
        let taxable_income = measure(
            conversion.converted,
            conversion.from_taxable * input.taxable_gain_ratio,
            &input,
        );

        assert!(conversion.converted > 0.0);
        assert!(taxable_income <= bracket_top);
        assert!(bracket_top - taxable_income < 2.0);
    }

    #[test]
    fn conversion_keeps_magi_below_the_first_irmaa_surcharge_tier() {
        let household = Household::single(FilingStatus::Single, 65);
        let state = State::CA;
        let mut input = input_for(RothConversionCeiling::IrmaaTier, &household, &state);
        input.social_security_benefit = 24_000.0;
        let conversion = roth_conversion_for(&input);
        let ceiling = irmaa_free_magi_ceiling(FilingStatus::Single);
        let magi = measure(
            conversion.converted,
            conversion.from_taxable * input.taxable_gain_ratio,
            &input,
        );

        assert!(conversion.converted > 0.0);
        assert!(magi <= ceiling);
        assert!(ceiling - magi < 2.0);
    }
}
