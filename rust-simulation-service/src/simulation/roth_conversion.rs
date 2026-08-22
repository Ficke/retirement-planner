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

/// The largest conversion a year can absorb without breaching its ceiling, and
/// what that conversion costs.
///
/// Headroom is solved rather than subtracted because a converted dollar does not
/// raise the measured quantity by a dollar: against a bracket top it also drags
/// more of the Social Security benefit into taxable income, so the ceiling binds
/// before a naive subtraction says it should. Bisection handles both ceilings
/// with one code path, since each measure rises monotonically with the amount
/// converted.
pub fn roth_conversion_for(input: &RothConversionInput) -> RothConversion {
    if !input.policy.enabled || input.traditional_balance <= 0.0 {
        return RothConversion::default();
    }

    let Some(limit) = ceiling_limit(input) else {
        return RothConversion::default();
    };

    if measure(0.0, input) >= limit {
        return RothConversion::default();
    }
    if measure(input.traditional_balance, input) <= limit {
        return settle(input.traditional_balance, input);
    }

    // Twenty halvings resolve any balance this model can hold to under a dollar.
    let mut low = 0.0;
    let mut high = input.traditional_balance;
    for _ in 0..20 {
        let mid = (low + high) / 2.0;
        if measure(mid, input) <= limit {
            low = mid;
        } else {
            high = mid;
        }
    }
    settle(low, input)
}

fn ceiling_limit(input: &RothConversionInput) -> Option<f64> {
    match input.policy.ceiling {
        RothConversionCeiling::IrmaaTier => {
            Some(irmaa_free_magi_ceiling(input.household.filing_status))
        }
        RothConversionCeiling::Bracket12 => {
            federal_bracket_top(0.12, &input.household.filing_status)
        }
        RothConversionCeiling::Bracket22 => {
            federal_bracket_top(0.22, &input.household.filing_status)
        }
        RothConversionCeiling::Bracket24 => {
            federal_bracket_top(0.24, &input.household.filing_status)
        }
        RothConversionCeiling::Bracket32 => {
            federal_bracket_top(0.32, &input.household.filing_status)
        }
    }
}

fn measure(conversion: f64, input: &RothConversionInput) -> f64 {
    if input.policy.ceiling == RothConversionCeiling::IrmaaTier {
        // Mirrors how the projection reports MAGI: the whole benefit, every
        // ordinary withdrawal, and the gain portion of what taxable paid out.
        return input.social_security_benefit
            + input.traditional_withdrawals
            + input.taxable_withdrawals * input.taxable_gain_ratio
            + conversion;
    }
    retirement_taxable_income(
        input.traditional_withdrawals + conversion,
        input.social_security_benefit,
        input.qualified_income,
        input.household,
        input.tax_year,
    )
}

fn tax_of(conversion: f64, input: &RothConversionInput) -> f64 {
    calculate_retirement_tax(
        input.traditional_withdrawals + conversion,
        input.social_security_benefit,
        input.qualified_income,
        input.household,
        input.state,
        input.tax_year,
    )
    .total_tax
}

/// Prices a conversion and decides which dollars pay for it. Paying from taxable
/// is what makes the trade worth doing — every converted dollar then compounds
/// tax-free — so taxable funds the bill while it lasts, and only the remainder
/// is withheld from the conversion itself.
fn settle(converted: f64, input: &RothConversionInput) -> RothConversion {
    if converted <= 0.0 {
        return RothConversion::default();
    }

    let tax = (tax_of(converted, input) - tax_of(0.0, input)).max(0.0);
    let from_taxable = tax.min(input.taxable_balance.max(0.0));
    let withheld = converted.min(tax - from_taxable);

    RothConversion {
        converted,
        tax,
        from_taxable,
        withheld,
    }
}
