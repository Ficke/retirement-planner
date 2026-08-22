//! Roth conversions during the gap years between retirement and RMDs.
//!
//! Mirrors `engine/roth-conversion.ts`. The two engines share one set of
//! semantics, so any change here belongs there as well.

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

/// Halvings, over a bracket tightened below, to resolve well under a dollar.
const SOLVE_STEPS: usize = 20;

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
/// Bisection suits both ceilings: each measure rises monotonically with the
/// amount converted.
pub fn roth_conversion_for(input: &RothConversionInput) -> RothConversion {
    if !input.policy.enabled || input.traditional_balance <= 0.0 {
        return RothConversion::default();
    }

    let Some(limit) = ceiling_limit(input) else {
        return RothConversion::default();
    };
    let base_tax = tax_of(0.0, input.qualified_income, input);
    let fits = |conversion: f64| {
        measure(
            conversion,
            outcome_of(conversion, input, base_tax).funding_gain,
            input,
        ) <= limit
    };

    if !fits(0.0) {
        return RothConversion::default();
    }
    if fits(input.traditional_balance) {
        return settle(input.traditional_balance, input, base_tax);
    }

    // Ordinary income cannot outrun the ceiling by more than the untaxed benefit
    // and the deductions sitting under it, so the search never needs a wider
    // bracket -- and a tighter bracket is fewer halvings to the same resolution.
    let mut low = 0.0;
    let mut high = input
        .traditional_balance
        .min(2.0 * limit + input.social_security_benefit);
    for _ in 0..SOLVE_STEPS {
        let mid = (low + high) / 2.0;
        if fits(mid) {
            low = mid;
        } else {
            high = mid;
        }
    }

    // Whole dollars, rounded down. Nobody converts a fraction of a cent, and
    // pinning the result to an integer is what lets the two engines agree
    // exactly: bisection alone lands them a hair apart on the same root.
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
