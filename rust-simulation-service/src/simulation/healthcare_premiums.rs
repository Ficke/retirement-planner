//! Income-tested healthcare premiums: the ACA premium tax credit before
//! Medicare, and the IRMAA surcharge after it.
//!
//! Both make a withdrawal decision a healthcare decision. A Roth conversion at
//! 63 raises the Medicare premium at 65, and large Traditional draws before 65
//! can cost more in lost subsidy than they save in tax.
//!
//! Indexed annually, stated here for 2026. Mirrors
//! `data/healthcare-premiums.ts` and both change together.

use crate::types::{FilingStatus, RetirementHealthcare, MEDICARE_AGE};

/// HHS poverty guidelines for the 48 contiguous states, published January 2025
/// and the ones a 2026 coverage year is measured against. Alaska and Hawaii run
/// higher and are not modeled.
const FPL_FIRST_PERSON: f64 = 15_650.0;
const FPL_EACH_ADDITIONAL_PERSON: f64 = 5_500.0;

pub fn federal_poverty_level(household_size: u32) -> f64 {
    let people = household_size.max(1) as f64;
    FPL_FIRST_PERSON + (people - 1.0) * FPL_EACH_ADDITIONAL_PERSON
}

/// Share of income a household is expected to pay for the benchmark plan,
/// interpolated within each band (IRC 36B(b)(3)(A)(i), indexed for 2026 by
/// Rev. Proc. 2025-25).
///
/// There is no band above 400%. That is the subsidy cliff, which returned on
/// 2026-01-01 when the enhanced credits lapsed: one dollar over and the whole
/// credit is gone. It is a cliff here too, not a taper, because the
/// discontinuity is what makes managing MAGI worth modeling.
struct ApplicablePercentageBand {
    upper_fpl_ratio: f64,
    start_percent: f64,
    end_percent: f64,
}

const APPLICABLE_PERCENTAGE_BANDS: [ApplicablePercentageBand; 6] = [
    ApplicablePercentageBand {
        upper_fpl_ratio: 1.33,
        start_percent: 0.0210,
        end_percent: 0.0210,
    },
    ApplicablePercentageBand {
        upper_fpl_ratio: 1.5,
        start_percent: 0.0314,
        end_percent: 0.0419,
    },
    ApplicablePercentageBand {
        upper_fpl_ratio: 2.0,
        start_percent: 0.0419,
        end_percent: 0.0660,
    },
    ApplicablePercentageBand {
        upper_fpl_ratio: 2.5,
        start_percent: 0.0660,
        end_percent: 0.0844,
    },
    ApplicablePercentageBand {
        upper_fpl_ratio: 3.0,
        start_percent: 0.0844,
        end_percent: 0.0996,
    },
    ApplicablePercentageBand {
        upper_fpl_ratio: 4.0,
        start_percent: 0.0996,
        end_percent: 0.0996,
    },
];

pub const SUBSIDY_CLIFF_FPL_RATIO: f64 = 4.0;

/// The credit starts at the poverty level. Below it is the Medicaid population:
/// expansion states cover them, non-expansion states leave them in the coverage
/// gap, and this model can price neither. They pay list here, so a plan is not
/// handed free coverage for holding MAGI at zero.
pub const SUBSIDY_FLOOR_FPL_RATIO: f64 = 1.0;

/// What the household is expected to pay toward the benchmark plan, or `None`
/// when no credit reaches it: over the cliff, or under the floor.
pub fn expected_premium_contribution(magi: f64, household_size: u32) -> Option<f64> {
    let fpl_ratio = magi / federal_poverty_level(household_size);
    if !(SUBSIDY_FLOOR_FPL_RATIO..=SUBSIDY_CLIFF_FPL_RATIO).contains(&fpl_ratio) {
        return None;
    }

    let mut lower_ratio = 0.0;
    for band in APPLICABLE_PERCENTAGE_BANDS.iter() {
        if fpl_ratio <= band.upper_fpl_ratio {
            let span = band.upper_fpl_ratio - lower_ratio;
            let position = if span > 0.0 {
                ((fpl_ratio - lower_ratio) / span).clamp(0.0, 1.0)
            } else {
                0.0
            };
            let percent = band.start_percent + (band.end_percent - band.start_percent) * position;
            return Some(magi.max(0.0) * percent);
        }
        lower_ratio = band.upper_fpl_ratio;
    }
    None
}

/// IRMAA tiers for 2026, keyed on MAGI from two years prior. The surcharge is
/// the monthly Part B and Part D amount per enrolled person, on top of the
/// standard premium the household already entered. These are cliffs, not
/// phase-outs: a dollar over a threshold owes the whole next tier.
const IRMAA_TIERS_2026: [(f64, f64); 6] = [
    (109_000.0, 0.0),
    (137_000.0, 95.70),
    (171_000.0, 240.40),
    (205_000.0, 385.00),
    (500_000.0, 529.70),
    (f64::INFINITY, 578.00),
];

/// Married filing separately gets its own schedule rather than half the joint
/// one: standard to $109,000, then straight to the top two tiers.
const IRMAA_SEPARATE_BOUNDS: (f64, f64) = (109_000.0, 391_000.0);

/// The most MAGI a household can report and still owe no surcharge. Conversion
/// planning aims at this because IRMAA is a cliff: one dollar over buys the
/// whole next tier, for both spouses, for a year.
pub fn irmaa_free_magi_ceiling(filing_status: FilingStatus) -> f64 {
    match filing_status {
        FilingStatus::MarriedFilingSeparately => IRMAA_SEPARATE_BOUNDS.0,
        FilingStatus::MarriedFilingJointly => IRMAA_TIERS_2026[0].0 * 2.0,
        _ => IRMAA_TIERS_2026[0].0,
    }
}

/// The most MAGI a household can report without buying a tier above the one
/// `magi` already sits in. `None` in the top tier, where there is no further
/// threshold left to stay under.
pub fn irmaa_ceiling_above(magi: f64, filing_status: FilingStatus) -> Option<f64> {
    if filing_status == FilingStatus::MarriedFilingSeparately {
        return [IRMAA_SEPARATE_BOUNDS.0, IRMAA_SEPARATE_BOUNDS.1]
            .into_iter()
            .find(|bound| magi <= *bound);
    }
    let scale = if filing_status == FilingStatus::MarriedFilingJointly {
        2.0
    } else {
        1.0
    };
    IRMAA_TIERS_2026
        .iter()
        .map(|(bound, _)| bound * scale)
        .find(|bound| magi <= *bound)
        .filter(|bound| bound.is_finite())
}

/// The MAGI range a year's own income should try to land in.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MagiBand {
    /// Under the poverty level the credit is gone as surely as over the cliff,
    /// so this is a target to reach rather than only a bound to respect. Zero
    /// when no marketplace credit is in play.
    pub floor: f64,
    pub ceiling: f64,
}

/// The band year `t`'s composition should aim for, or `None` when nothing will
/// read that year's MAGI and the plain withdrawal order stands.
///
/// Neither test reads the year it is levied on. The marketplace credit is
/// measured against prior-year MAGI and IRMAA against MAGI from two years back,
/// so what year `t` decides is `t+1`'s credit — if the household is still
/// pre-Medicare then — and `t+2`'s surcharge, once it is enrolled. That makes
/// the binding test age-dependent, and it flips between 63 and 64.
///
/// A test that prices no premium is left out: the credit cannot reduce a
/// premium of zero and a surcharge cannot be added to one, so managing MAGI
/// against it would buy nothing.
///
/// `committed_magi` is the income the year owes whatever the order does —
/// benefits, realized gains, forced distributions. A threshold it already
/// exceeds is dropped rather than aimed at, which is what keeps the rule from
/// protecting a credit that is gone either way; IRMAA is a staircase, so there
/// the next threshold up takes over.
pub fn magi_band_for(
    age: u32,
    filing_status: FilingStatus,
    household_size: u32,
    committed_magi: f64,
    healthcare: &RetirementHealthcare,
) -> Option<MagiBand> {
    let marketplace_applies = age + 1 < MEDICARE_AGE && healthcare.pre_medicare_premium > 0.0;
    let irmaa_applies = age + 2 >= MEDICARE_AGE && healthcare.medicare_premium > 0.0;

    let poverty_level = federal_poverty_level(household_size);
    let cliff = SUBSIDY_CLIFF_FPL_RATIO * poverty_level;
    let marketplace_ceiling = (marketplace_applies && committed_magi <= cliff).then_some(cliff);
    let irmaa_ceiling = if irmaa_applies {
        irmaa_ceiling_above(committed_magi, filing_status)
    } else {
        None
    };

    let ceiling = match (marketplace_ceiling, irmaa_ceiling) {
        (Some(marketplace), Some(irmaa)) => marketplace.min(irmaa),
        (Some(only), None) | (None, Some(only)) => only,
        (None, None) => return None,
    };
    Some(MagiBand {
        floor: if marketplace_ceiling.is_some() {
            SUBSIDY_FLOOR_FPL_RATIO * poverty_level
        } else {
            0.0
        },
        ceiling,
    })
}

pub fn irmaa_annual_surcharge(
    magi: f64,
    filing_status: FilingStatus,
    people_on_medicare: u32,
) -> f64 {
    let per_person = if filing_status == FilingStatus::MarriedFilingSeparately {
        if magi <= IRMAA_SEPARATE_BOUNDS.0 {
            0.0
        } else if magi < IRMAA_SEPARATE_BOUNDS.1 {
            IRMAA_TIERS_2026[4].1
        } else {
            IRMAA_TIERS_2026[5].1
        }
    } else {
        let scale = if filing_status == FilingStatus::MarriedFilingJointly {
            2.0
        } else {
            1.0
        };
        IRMAA_TIERS_2026
            .iter()
            .find(|(bound, _)| magi <= bound * scale)
            .map(|(_, surcharge)| *surcharge)
            .unwrap_or(IRMAA_TIERS_2026[5].1)
    };
    per_person * 12.0 * people_on_medicare as f64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expected_contribution_matches_the_typescript_bands() {
        // 300% of a one-person poverty level, where the percentage is 9.96%.
        let magi = 15_650.0 * 3.0;
        let expected = expected_premium_contribution(magi, 1).expect("under the cliff");
        assert!((expected - magi * 0.0996).abs() < 0.01);
    }

    #[test]
    fn the_cliff_is_a_cliff() {
        let at_cliff = 15_650.0 * 4.0;
        assert!(expected_premium_contribution(at_cliff, 1).is_some());
        assert!(expected_premium_contribution(at_cliff + 1.0, 1).is_none());
    }

    /// A plan that prices both premiums, so both tests are live.
    fn insured() -> RetirementHealthcare {
        RetirementHealthcare {
            pre_medicare_premium: 15_900.0,
            medicare_premium: 4_500.0,
            out_of_pocket: 3_000.0,
            real_growth_rate: 0.02,
        }
    }

    #[test]
    fn the_binding_test_flips_between_63_and_64() {
        let cliff = federal_poverty_level(1) * SUBSIDY_CLIFF_FPL_RATIO;
        let irmaa = irmaa_free_magi_ceiling(FilingStatus::Single);

        // At 62 only next year's marketplace credit reads this MAGI.
        let early = magi_band_for(62, FilingStatus::Single, 1, 0.0, &insured()).expect("a band");
        assert_eq!(early.ceiling, cliff);
        assert_eq!(
            early.floor,
            federal_poverty_level(1) * SUBSIDY_FLOOR_FPL_RATIO
        );

        // At 63 both read it, and the lower of the two binds.
        let both = magi_band_for(63, FilingStatus::Single, 1, 0.0, &insured()).expect("a band");
        assert_eq!(both.ceiling, cliff.min(irmaa));
        assert_eq!(both.ceiling, cliff);

        // At 64 the marketplace is out of reach and IRMAA alone binds, which
        // raises the ceiling rather than lowering it.
        let late = magi_band_for(64, FilingStatus::Single, 1, 0.0, &insured()).expect("a band");
        assert_eq!(late.ceiling, irmaa);
        assert_eq!(late.floor, 0.0);
    }

    #[test]
    fn a_threshold_already_exceeded_is_dropped_rather_than_aimed_at() {
        let cliff = federal_poverty_level(1) * SUBSIDY_CLIFF_FPL_RATIO;

        // Still working at 62 on a salary over the cliff: the credit is gone
        // next year whatever the order does, so there is nothing left to aim at.
        assert!(magi_band_for(62, FilingStatus::Single, 1, cliff + 1.0, &insured()).is_none());

        // At 63 the same salary leaves IRMAA as the only live test.
        let band =
            magi_band_for(63, FilingStatus::Single, 1, cliff + 1.0, &insured()).expect("a band");
        assert_eq!(band.ceiling, irmaa_free_magi_ceiling(FilingStatus::Single));
        assert_eq!(band.floor, 0.0);
    }

    #[test]
    fn above_the_first_irmaa_tier_the_ceiling_is_the_next_threshold_up() {
        let band = magi_band_for(70, FilingStatus::Single, 1, 150_000.0, &insured()).expect("band");
        assert_eq!(band.ceiling, 171_000.0);
        assert_eq!(
            irmaa_annual_surcharge(band.ceiling, FilingStatus::Single, 1),
            240.40 * 12.0
        );
        assert!(
            irmaa_annual_surcharge(band.ceiling + 1.0, FilingStatus::Single, 1)
                > irmaa_annual_surcharge(band.ceiling, FilingStatus::Single, 1)
        );

        // In the top tier there is no further threshold, so nothing to manage.
        assert!(magi_band_for(70, FilingStatus::Single, 1, 600_000.0, &insured()).is_none());
    }

    #[test]
    fn a_premium_the_plan_does_not_price_is_not_worth_managing_magi_against() {
        let uninsured = RetirementHealthcare::default();
        assert!(magi_band_for(62, FilingStatus::Single, 1, 0.0, &uninsured).is_none());
        assert!(magi_band_for(70, FilingStatus::Single, 1, 0.0, &uninsured).is_none());

        // Medicare-only pricing leaves the pre-Medicare years unmanaged.
        let medicare_only = RetirementHealthcare {
            medicare_premium: 4_500.0,
            ..Default::default()
        };
        assert!(magi_band_for(62, FilingStatus::Single, 1, 0.0, &medicare_only).is_none());
        assert!(magi_band_for(63, FilingStatus::Single, 1, 0.0, &medicare_only).is_some());
    }

    #[test]
    fn irmaa_thresholds_double_for_a_joint_return_but_not_a_separate_one() {
        assert_eq!(
            irmaa_annual_surcharge(109_000.0, FilingStatus::Single, 1),
            0.0
        );
        assert!(irmaa_annual_surcharge(109_001.0, FilingStatus::Single, 1) > 0.0);
        assert_eq!(
            irmaa_annual_surcharge(218_000.0, FilingStatus::MarriedFilingJointly, 1),
            0.0
        );
        // Filing separately keeps the single threshold and skips to the top tiers.
        assert!(
            irmaa_annual_surcharge(150_000.0, FilingStatus::MarriedFilingSeparately, 1)
                > irmaa_annual_surcharge(150_000.0, FilingStatus::Single, 1)
        );
    }
}
