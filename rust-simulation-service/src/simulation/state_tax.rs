// This file is generated; do not edit it by hand.
// The source of truth is apps/web/src/data/state-tax.ts.
// Regenerate it with: node scripts/gen-rust-state-tax.mjs
//
// State income tax as data. A state with no income tax and a state nobody has
// modeled yet both produce zero tax; `status` is what tells them apart.

use crate::simulation::tax::TaxBracket;
use crate::types::{FilingStatus, State};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StateTaxStatus {
    Modeled,
    NoIncomeTax,
    NotModeled,
}

#[derive(Debug, Clone)]
pub struct StateTaxProfile {
    // Name and status exist so this table stays a faithful copy of the
    // TypeScript one; only the web UI reads them.
    #[allow(dead_code)]
    pub name: &'static str,
    #[allow(dead_code)]
    pub status: StateTaxStatus,
    pub social_security_exempt: bool,
    /// California allows no deduction for HSA contributions; most states do.
    pub conforms_to_federal_hsa: bool,
}

pub fn state_tax_profile(state: &State) -> StateTaxProfile {
    match state {
        State::CA => StateTaxProfile {
            name: "California",
            status: StateTaxStatus::Modeled,
            social_security_exempt: true,
            conforms_to_federal_hsa: false,
        },
        State::TX => StateTaxProfile {
            name: "Texas",
            status: StateTaxStatus::NoIncomeTax,
            social_security_exempt: true,
            conforms_to_federal_hsa: true,
        },
        State::FL => StateTaxProfile {
            name: "Florida",
            status: StateTaxStatus::NoIncomeTax,
            social_security_exempt: true,
            conforms_to_federal_hsa: true,
        },
        State::WA => StateTaxProfile {
            name: "Washington",
            status: StateTaxStatus::NoIncomeTax,
            social_security_exempt: true,
            conforms_to_federal_hsa: true,
        },
        State::NY => StateTaxProfile {
            name: "New York",
            status: StateTaxStatus::NotModeled,
            social_security_exempt: true,
            conforms_to_federal_hsa: true,
        },
        State::Other => StateTaxProfile {
            name: "Other",
            status: StateTaxStatus::NotModeled,
            social_security_exempt: true,
            conforms_to_federal_hsa: true,
        },
    }
}

pub fn state_brackets(state: &State, filing_status: &FilingStatus) -> Option<Vec<TaxBracket>> {
    match state {
        State::CA => Some(match filing_status {
            FilingStatus::Single => vec![
                TaxBracket { min: 0.0, max: Some(11079.0), rate: 0.01 },
                TaxBracket { min: 11079.0, max: Some(26264.0), rate: 0.02 },
                TaxBracket { min: 26264.0, max: Some(41452.0), rate: 0.04 },
                TaxBracket { min: 41452.0, max: Some(57542.0), rate: 0.06 },
                TaxBracket { min: 57542.0, max: Some(72724.0), rate: 0.08 },
                TaxBracket { min: 72724.0, max: Some(371479.0), rate: 0.093 },
                TaxBracket { min: 371479.0, max: Some(445771.0), rate: 0.103 },
                TaxBracket { min: 445771.0, max: Some(742953.0), rate: 0.113 },
                TaxBracket { min: 742953.0, max: Some(1000000.0), rate: 0.123 },
                TaxBracket { min: 1000000.0, max: None, rate: 0.133 },
            ],
            FilingStatus::MarriedFilingJointly => vec![
                TaxBracket { min: 0.0, max: Some(22158.0), rate: 0.01 },
                TaxBracket { min: 22158.0, max: Some(52528.0), rate: 0.02 },
                TaxBracket { min: 52528.0, max: Some(82904.0), rate: 0.04 },
                TaxBracket { min: 82904.0, max: Some(115084.0), rate: 0.06 },
                TaxBracket { min: 115084.0, max: Some(145448.0), rate: 0.08 },
                TaxBracket { min: 145448.0, max: Some(742958.0), rate: 0.093 },
                TaxBracket { min: 742958.0, max: Some(891542.0), rate: 0.103 },
                TaxBracket { min: 891542.0, max: Some(1000000.0), rate: 0.113 },
                TaxBracket { min: 1000000.0, max: Some(1485906.0), rate: 0.123 },
                TaxBracket { min: 1485906.0, max: None, rate: 0.133 },
            ],
            FilingStatus::MarriedFilingSeparately => vec![
                TaxBracket { min: 0.0, max: Some(11079.0), rate: 0.01 },
                TaxBracket { min: 11079.0, max: Some(26264.0), rate: 0.02 },
                TaxBracket { min: 26264.0, max: Some(41452.0), rate: 0.04 },
                TaxBracket { min: 41452.0, max: Some(57542.0), rate: 0.06 },
                TaxBracket { min: 57542.0, max: Some(72724.0), rate: 0.08 },
                TaxBracket { min: 72724.0, max: Some(371479.0), rate: 0.093 },
                TaxBracket { min: 371479.0, max: Some(445771.0), rate: 0.103 },
                TaxBracket { min: 445771.0, max: Some(742953.0), rate: 0.113 },
                TaxBracket { min: 742953.0, max: Some(1000000.0), rate: 0.123 },
                TaxBracket { min: 1000000.0, max: None, rate: 0.133 },
            ],
            FilingStatus::HeadOfHousehold => vec![
                TaxBracket { min: 0.0, max: Some(22173.0), rate: 0.01 },
                TaxBracket { min: 22173.0, max: Some(52530.0), rate: 0.02 },
                TaxBracket { min: 52530.0, max: Some(67716.0), rate: 0.04 },
                TaxBracket { min: 67716.0, max: Some(83805.0), rate: 0.06 },
                TaxBracket { min: 83805.0, max: Some(98990.0), rate: 0.08 },
                TaxBracket { min: 98990.0, max: Some(505208.0), rate: 0.093 },
                TaxBracket { min: 505208.0, max: Some(606251.0), rate: 0.103 },
                TaxBracket { min: 606251.0, max: Some(1000000.0), rate: 0.113 },
                TaxBracket { min: 1000000.0, max: Some(1010417.0), rate: 0.123 },
                TaxBracket { min: 1010417.0, max: None, rate: 0.133 },
            ],
        }),
        _ => None,
    }
}

pub fn state_standard_deduction(state: &State, filing_status: &FilingStatus) -> Option<f64> {
    match state {
        State::CA => Some(match filing_status {
            FilingStatus::Single => 5706.0,
            FilingStatus::MarriedFilingJointly => 11412.0,
            FilingStatus::MarriedFilingSeparately => 5706.0,
            FilingStatus::HeadOfHousehold => 11412.0,
        }),
        _ => None,
    }
}
