//! Income-tested healthcare premiums: the ACA premium tax credit before
//! Medicare, and the IRMAA surcharge after it.
//!
//! Both make a withdrawal decision a healthcare decision. A Roth conversion at
//! 63 raises the Medicare premium at 65, and large Traditional draws before 65
//! can cost more in lost subsidy than they save in tax.
//!
//! Indexed annually, stated here for 2026. Mirrors
//! `data/healthcare-premiums.ts` and both change together.

use crate::types::FilingStatus;

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
