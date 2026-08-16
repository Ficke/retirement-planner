//! Federal, state, and FICA tax. Semantics are shared with the browser engine
//! in apps/web/src/engine/tax.ts.
use crate::types::{AnnualContributions, FilingStatus, State};

#[derive(Debug, Clone)]
pub struct TaxBracket {
    pub min: f64,
    pub max: Option<f64>,
    pub rate: f64,
}

#[derive(Debug, Clone)]
pub struct TaxResult {
    pub total_tax: f64,
    pub hsa_contribution: f64,
    pub k401_contribution: f64,
}

#[derive(Debug, Clone)]
pub struct WorkingCashFlowResult {
    pub tax: TaxResult,
    pub contributions: AnnualContributions,
    /// Spending above after-tax income. The portfolio covers it; not a failure.
    pub funding_gap: f64,
}

/// Income reaching the household from somewhere other than wages — RMDs and
/// portfolio withdrawals. Ordinary is taxed at bracket rates; qualified is the
/// realized-gain share of a taxable withdrawal.
#[derive(Debug, Clone, Copy, Default)]
pub struct OtherIncome {
    pub ordinary: f64,
    pub qualified: f64,
}

/// Household facts that decide which tax-advantaged space is actually available.
#[derive(Debug, Clone, Copy)]
pub struct ContributionPolicy {
    pub hsa_eligible: bool,
    pub use_backdoor_roth: bool,
}

struct PretaxContributionTargets {
    hsa: f64,
    traditional: f64,
}

fn get_federal_brackets(filing_status: &FilingStatus) -> Vec<TaxBracket> {
    match filing_status {
        FilingStatus::Single => vec![
            TaxBracket {
                min: 0.0,
                max: Some(11925.0),
                rate: 0.10,
            },
            TaxBracket {
                min: 11925.0,
                max: Some(48475.0),
                rate: 0.12,
            },
            TaxBracket {
                min: 48475.0,
                max: Some(103350.0),
                rate: 0.22,
            },
            TaxBracket {
                min: 103350.0,
                max: Some(197300.0),
                rate: 0.24,
            },
            TaxBracket {
                min: 197300.0,
                max: Some(250525.0),
                rate: 0.32,
            },
            TaxBracket {
                min: 250525.0,
                max: Some(626350.0),
                rate: 0.35,
            },
            TaxBracket {
                min: 626350.0,
                max: None,
                rate: 0.37,
            },
        ],
        FilingStatus::MarriedFilingJointly => vec![
            TaxBracket {
                min: 0.0,
                max: Some(23850.0),
                rate: 0.10,
            },
            TaxBracket {
                min: 23850.0,
                max: Some(96950.0),
                rate: 0.12,
            },
            TaxBracket {
                min: 96950.0,
                max: Some(206700.0),
                rate: 0.22,
            },
            TaxBracket {
                min: 206700.0,
                max: Some(394600.0),
                rate: 0.24,
            },
            TaxBracket {
                min: 394600.0,
                max: Some(501050.0),
                rate: 0.32,
            },
            TaxBracket {
                min: 501050.0,
                max: Some(751600.0),
                rate: 0.35,
            },
            TaxBracket {
                min: 751600.0,
                max: None,
                rate: 0.37,
            },
        ],
        FilingStatus::MarriedFilingSeparately => vec![
            TaxBracket {
                min: 0.0,
                max: Some(11925.0),
                rate: 0.10,
            },
            TaxBracket {
                min: 11925.0,
                max: Some(48475.0),
                rate: 0.12,
            },
            TaxBracket {
                min: 48475.0,
                max: Some(103350.0),
                rate: 0.22,
            },
            TaxBracket {
                min: 103350.0,
                max: Some(197300.0),
                rate: 0.24,
            },
            TaxBracket {
                min: 197300.0,
                max: Some(250525.0),
                rate: 0.32,
            },
            TaxBracket {
                min: 250525.0,
                max: Some(375800.0),
                rate: 0.35,
            },
            TaxBracket {
                min: 375800.0,
                max: None,
                rate: 0.37,
            },
        ],
        FilingStatus::HeadOfHousehold => vec![
            TaxBracket {
                min: 0.0,
                max: Some(17000.0),
                rate: 0.10,
            },
            TaxBracket {
                min: 17000.0,
                max: Some(64850.0),
                rate: 0.12,
            },
            TaxBracket {
                min: 64850.0,
                max: Some(103350.0),
                rate: 0.22,
            },
            TaxBracket {
                min: 103350.0,
                max: Some(197300.0),
                rate: 0.24,
            },
            TaxBracket {
                min: 197300.0,
                max: Some(250525.0),
                rate: 0.32,
            },
            TaxBracket {
                min: 250525.0,
                max: Some(626350.0),
                rate: 0.35,
            },
            TaxBracket {
                min: 626350.0,
                max: None,
                rate: 0.37,
            },
        ],
    }
}

fn get_ca_brackets(filing_status: &FilingStatus) -> Vec<TaxBracket> {
    match filing_status {
        FilingStatus::Single => vec![
            TaxBracket {
                min: 0.0,
                max: Some(11079.0),
                rate: 0.01,
            },
            TaxBracket {
                min: 11079.0,
                max: Some(26264.0),
                rate: 0.02,
            },
            TaxBracket {
                min: 26264.0,
                max: Some(41452.0),
                rate: 0.04,
            },
            TaxBracket {
                min: 41452.0,
                max: Some(57542.0),
                rate: 0.06,
            },
            TaxBracket {
                min: 57542.0,
                max: Some(72724.0),
                rate: 0.08,
            },
            TaxBracket {
                min: 72724.0,
                max: Some(371479.0),
                rate: 0.093,
            },
            TaxBracket {
                min: 371479.0,
                max: Some(445771.0),
                rate: 0.103,
            },
            TaxBracket {
                min: 445771.0,
                max: Some(742953.0),
                rate: 0.113,
            },
            TaxBracket {
                min: 742953.0,
                max: Some(1000000.0),
                rate: 0.123,
            },
            TaxBracket {
                min: 1000000.0,
                max: None,
                rate: 0.133,
            },
        ],
        FilingStatus::MarriedFilingJointly => vec![
            TaxBracket {
                min: 0.0,
                max: Some(22158.0),
                rate: 0.01,
            },
            TaxBracket {
                min: 22158.0,
                max: Some(52528.0),
                rate: 0.02,
            },
            TaxBracket {
                min: 52528.0,
                max: Some(82904.0),
                rate: 0.04,
            },
            TaxBracket {
                min: 82904.0,
                max: Some(115084.0),
                rate: 0.06,
            },
            TaxBracket {
                min: 115084.0,
                max: Some(145448.0),
                rate: 0.08,
            },
            TaxBracket {
                min: 145448.0,
                max: Some(742958.0),
                rate: 0.093,
            },
            TaxBracket {
                min: 742958.0,
                max: Some(891542.0),
                rate: 0.103,
            },
            // The 1% Mental Health Services Tax starts inside the statutory
            // 11.3% bracket, so that bracket is split at $1,000,000.
            TaxBracket {
                min: 891542.0,
                max: Some(1000000.0),
                rate: 0.113,
            },
            TaxBracket {
                min: 1000000.0,
                max: Some(1485906.0),
                rate: 0.123,
            },
            TaxBracket {
                min: 1485906.0,
                max: None,
                rate: 0.133,
            },
        ],
        FilingStatus::MarriedFilingSeparately => vec![
            TaxBracket {
                min: 0.0,
                max: Some(11079.0),
                rate: 0.01,
            },
            TaxBracket {
                min: 11079.0,
                max: Some(26264.0),
                rate: 0.02,
            },
            TaxBracket {
                min: 26264.0,
                max: Some(41452.0),
                rate: 0.04,
            },
            TaxBracket {
                min: 41452.0,
                max: Some(57542.0),
                rate: 0.06,
            },
            TaxBracket {
                min: 57542.0,
                max: Some(72724.0),
                rate: 0.08,
            },
            TaxBracket {
                min: 72724.0,
                max: Some(371479.0),
                rate: 0.093,
            },
            TaxBracket {
                min: 371479.0,
                max: Some(445771.0),
                rate: 0.103,
            },
            TaxBracket {
                min: 445771.0,
                max: Some(742953.0),
                rate: 0.113,
            },
            TaxBracket {
                min: 742953.0,
                max: Some(1000000.0),
                rate: 0.123,
            },
            TaxBracket {
                min: 1000000.0,
                max: None,
                rate: 0.133,
            },
        ],
        FilingStatus::HeadOfHousehold => vec![
            TaxBracket {
                min: 0.0,
                max: Some(22173.0),
                rate: 0.01,
            },
            TaxBracket {
                min: 22173.0,
                max: Some(52530.0),
                rate: 0.02,
            },
            TaxBracket {
                min: 52530.0,
                max: Some(67716.0),
                rate: 0.04,
            },
            TaxBracket {
                min: 67716.0,
                max: Some(83805.0),
                rate: 0.06,
            },
            TaxBracket {
                min: 83805.0,
                max: Some(98990.0),
                rate: 0.08,
            },
            TaxBracket {
                min: 98990.0,
                max: Some(505208.0),
                rate: 0.093,
            },
            TaxBracket {
                min: 505208.0,
                max: Some(606251.0),
                rate: 0.103,
            },
            TaxBracket {
                min: 606251.0,
                max: Some(1000000.0),
                rate: 0.113,
            },
            TaxBracket {
                min: 1000000.0,
                max: Some(1010417.0),
                rate: 0.123,
            },
            TaxBracket {
                min: 1010417.0,
                max: None,
                rate: 0.133,
            },
        ],
    }
}

fn get_standard_deduction(
    filing_status: &FilingStatus,
    age: u32,
    modified_adjusted_gross_income: f64,
) -> f64 {
    let base = match filing_status {
        FilingStatus::Single => 15750.0,
        FilingStatus::MarriedFilingJointly => 31500.0,
        FilingStatus::MarriedFilingSeparately => 15750.0,
        FilingStatus::HeadOfHousehold => 23625.0,
    };

    let additional = if age >= 65 {
        match filing_status {
            FilingStatus::Single => 2000.0,
            FilingStatus::MarriedFilingJointly => 1600.0,
            FilingStatus::MarriedFilingSeparately => 1600.0,
            FilingStatus::HeadOfHousehold => 2000.0,
        }
    } else {
        0.0
    };

    let enhanced = if age >= 65 && !matches!(filing_status, FilingStatus::MarriedFilingSeparately) {
        let phaseout_start = if matches!(filing_status, FilingStatus::MarriedFilingJointly) {
            150_000.0
        } else {
            75_000.0
        };
        (6_000.0 - (modified_adjusted_gross_income - phaseout_start).max(0.0) * 0.06).max(0.0)
    } else {
        0.0
    };

    base + additional + enhanced
}

fn get_ca_standard_deduction(filing_status: &FilingStatus) -> f64 {
    match filing_status {
        FilingStatus::Single => 5706.0,
        FilingStatus::MarriedFilingJointly => 11412.0,
        FilingStatus::MarriedFilingSeparately => 5706.0,
        FilingStatus::HeadOfHousehold => 11412.0,
    }
}

fn get_k401_contribution_limit(age: u32) -> f64 {
    if (60..=63).contains(&age) {
        23500.0 + 11250.0
    } else if age >= 50 {
        23500.0 + 7500.0
    } else {
        23500.0
    }
}

fn get_hsa_contribution_limit(age: u32) -> f64 {
    let base = 4300.0; // Individual coverage
    let catchup = if age >= 55 { 1000.0 } else { 0.0 };
    base + catchup
}

pub fn get_ira_contribution_limit(age: u32) -> f64 {
    if age >= 50 {
        7000.0 + 1000.0 // Base + catch-up
    } else {
        7000.0
    }
}

pub fn calculate_progressive_tax(income: f64, brackets: &[TaxBracket]) -> f64 {
    let mut tax = 0.0;
    let mut remaining_income = income;

    for bracket in brackets {
        if remaining_income <= 0.0 {
            break;
        }

        let bracket_max = bracket.max.unwrap_or(f64::INFINITY);
        let bracket_width = bracket_max - bracket.min;
        let taxable_in_bracket = remaining_income.min(bracket_width);

        if taxable_in_bracket > 0.0 {
            tax += taxable_in_bracket * bracket.rate;
            remaining_income -= taxable_in_bracket;
        }
    }

    tax
}

/// Tax on a working year. Contribution targets are clamped to statutory
/// limits and to what the income can actually fund.
fn calculate_tax(
    gross_income: f64,
    qualified_income: f64,
    age: u32,
    filing_status: &FilingStatus,
    state: &State,
    requested: &PretaxContributionTargets,
    other_ordinary_income: f64,
) -> TaxResult {
    let hsa_max = get_hsa_contribution_limit(age);
    let k401_max = get_k401_contribution_limit(age);
    let federal_brackets = get_federal_brackets(filing_status);
    let hsa_contribution = requested.hsa.clamp(0.0, hsa_max).min(gross_income);
    let k401_contribution = requested
        .traditional
        .clamp(0.0, k401_max)
        .min((gross_income - hsa_contribution).max(0.0));

    let after_hsa_income = gross_income - hsa_contribution;
    let after_k401_income = after_hsa_income - k401_contribution;
    let standard_deduction = get_standard_deduction(
        filing_status,
        age,
        after_k401_income + other_ordinary_income + qualified_income,
    );
    let federal_taxable_income =
        (after_k401_income + other_ordinary_income - standard_deduction).max(0.0);
    let federal_tax = calculate_progressive_tax(federal_taxable_income, &federal_brackets);

    let state_tax = match state {
        State::CA => {
            let ca_deduction = get_ca_standard_deduction(filing_status);
            // California does not conform to the federal HSA deduction.
            let ca_taxable =
                (gross_income + other_ordinary_income - k401_contribution - ca_deduction).max(0.0);
            let ca_brackets = get_ca_brackets(filing_status);
            calculate_progressive_tax(ca_taxable, &ca_brackets)
        }
        _ => 0.0,
    };

    const FICA_WAGE_BASE: f64 = 176100.0;
    const SOCIAL_SECURITY_RATE: f64 = 0.062;
    const MEDICARE_RATE: f64 = 0.0145;
    const MEDICARE_ADDITIONAL_THRESHOLD: f64 = 200000.0;
    const MEDICARE_ADDITIONAL_RATE: f64 = 0.009;
    let social_security_tax = gross_income.min(FICA_WAGE_BASE) * SOCIAL_SECURITY_RATE;
    let medicare_tax = gross_income * MEDICARE_RATE;
    let additional_medicare_threshold = match filing_status {
        FilingStatus::MarriedFilingJointly => 250_000.0,
        FilingStatus::MarriedFilingSeparately => 125_000.0,
        _ => MEDICARE_ADDITIONAL_THRESHOLD,
    };
    let additional_medicare_tax = if gross_income > additional_medicare_threshold {
        (gross_income - additional_medicare_threshold) * MEDICARE_ADDITIONAL_RATE
    } else {
        0.0
    };
    let fica_tax = social_security_tax + medicare_tax + additional_medicare_tax;

    let total_tax = federal_tax + state_tax + fica_tax;

    TaxResult {
        total_tax,
        hsa_contribution,
        k401_contribution,
    }
}

/// Savings is the residual: whatever gross income does not lose to taxes and
/// spending gets invested. Contributions fill statutory limits in the order
/// HSA → Traditional → Roth, and taxable absorbs the remainder — so no cash is
/// ever left over, and none of it disappears. Matches TypeScript.
pub fn calculate_working_cash_flow(
    gross_income: f64,
    annual_spending: f64,
    age: u32,
    filing_status: &FilingStatus,
    state: &State,
    policy: &ContributionPolicy,
    other: OtherIncome,
) -> WorkingCashFlowResult {
    let hsa_max = if policy.hsa_eligible {
        get_hsa_contribution_limit(age)
    } else {
        0.0
    };
    let k401_max = get_k401_contribution_limit(age);
    let mut requested = PretaxContributionTargets {
        hsa: 0.0,
        traditional: 0.0,
    };
    let mut tax = calculate_tax(
        gross_income,
        other.qualified,
        age,
        filing_status,
        state,
        &requested,
        other.ordinary,
    );
    for _ in 0..4 {
        let available_before_contributions =
            (gross_income + other.ordinary - tax.total_tax - annual_spending).max(0.0);
        let hsa = hsa_max.min(available_before_contributions);
        let traditional = k401_max.min((available_before_contributions - hsa).max(0.0));
        requested = PretaxContributionTargets { hsa, traditional };
        tax = calculate_tax(
            gross_income,
            other.qualified,
            age,
            filing_status,
            state,
            &requested,
            other.ordinary,
        );
    }

    let cash_after_pretax_and_spending = gross_income + other.ordinary
        - tax.total_tax
        - annual_spending
        - tax.hsa_contribution
        - tax.k401_contribution;
    let funding_gap = (-cash_after_pretax_and_spending).max(0.0);
    let after_tax_budget = cash_after_pretax_and_spending.max(0.0);
    let roth = if policy.use_backdoor_roth {
        get_ira_contribution_limit(age).min(after_tax_budget)
    } else {
        0.0
    };
    let taxable = after_tax_budget - roth;

    let contributions = AnnualContributions {
        hsa: tax.hsa_contribution,
        traditional: tax.k401_contribution,
        roth,
        taxable,
    };
    WorkingCashFlowResult {
        tax,
        contributions,
        funding_gap,
    }
}

/// Calculate tax on retirement income (no FICA, no retirement contributions)
/// Matches TypeScript calculateRetirementTax() function
pub fn calculate_retirement_tax(
    traditional_withdrawals: f64,
    social_security_benefit: f64,
    qualified_income: f64,
    age: u32,
    filing_status: &FilingStatus,
    state: &State,
) -> TaxResult {
    // Calculate taxable portion of Social Security
    let taxable_ss = calculate_taxable_social_security(
        traditional_withdrawals,
        social_security_benefit,
        qualified_income,
        filing_status,
    );

    // Total ordinary income
    let total_ordinary_income = traditional_withdrawals + taxable_ss;

    // Federal tax
    let standard_deduction =
        get_standard_deduction(filing_status, age, total_ordinary_income + qualified_income);
    let federal_taxable_income = (total_ordinary_income - standard_deduction).max(0.0);
    let federal_brackets = get_federal_brackets(filing_status);
    let federal_tax = calculate_progressive_tax(federal_taxable_income, &federal_brackets);

    // LTCG tax on qualified income
    let unused_standard_deduction = (standard_deduction - total_ordinary_income).max(0.0);
    let taxable_qualified_income = (qualified_income - unused_standard_deduction).max(0.0);
    let ltcg_tax = calculate_ltcg_tax(
        federal_taxable_income,
        taxable_qualified_income,
        filing_status,
    );
    let net_investment_income_threshold = match filing_status {
        FilingStatus::MarriedFilingJointly => 250_000.0,
        FilingStatus::MarriedFilingSeparately => 125_000.0,
        _ => 200_000.0,
    };
    let net_investment_income_tax = 0.038
        * qualified_income.min(
            (total_ordinary_income + qualified_income - net_investment_income_threshold).max(0.0),
        );
    let total_federal_tax = federal_tax + ltcg_tax + net_investment_income_tax;

    // State tax
    let state_tax = match state {
        State::CA => {
            let ca_deduction = get_ca_standard_deduction(filing_status);
            // California excludes Social Security and taxes capital gains as ordinary income.
            let ca_total_income = traditional_withdrawals + qualified_income;
            let ca_taxable = (ca_total_income - ca_deduction).max(0.0);
            let ca_brackets = get_ca_brackets(filing_status);
            calculate_progressive_tax(ca_taxable, &ca_brackets)
        }
        _ => 0.0,
    };

    // No FICA in retirement
    let total_tax = total_federal_tax + state_tax;

    TaxResult {
        total_tax,
        hsa_contribution: 0.0,
        k401_contribution: 0.0,
    }
}

/// Calculate taxable portion of Social Security benefits
pub fn calculate_taxable_social_security(
    other_income: f64,
    social_security_benefit: f64,
    qualified_income: f64,
    filing_status: &FilingStatus,
) -> f64 {
    if social_security_benefit == 0.0 {
        return 0.0;
    }

    // Combined income = AGI + nontaxable interest + 50% of SS benefits
    let combined_income = other_income + qualified_income + (social_security_benefit * 0.5);

    // IRS thresholds
    let (tier1, tier2) = match filing_status {
        FilingStatus::Single => (25000.0, 34000.0),
        FilingStatus::MarriedFilingJointly => (32000.0, 44000.0),
        FilingStatus::MarriedFilingSeparately => (0.0, 0.0),
        FilingStatus::HeadOfHousehold => (25000.0, 34000.0),
    };

    if combined_income <= tier1 {
        0.0
    } else if combined_income <= tier2 {
        // Up to 50% taxable
        let excess = combined_income - tier1;
        (social_security_benefit * 0.5).min(excess * 0.5)
    } else {
        // Up to 85% taxable
        let lower_tier_taxable = (social_security_benefit * 0.5).min((tier2 - tier1) * 0.5);
        (social_security_benefit * 0.85).min((combined_income - tier2) * 0.85 + lower_tier_taxable)
    }
}

/// Calculate Long-Term Capital Gains tax
fn calculate_ltcg_tax(
    ordinary_taxable_income: f64,
    ltcg_income: f64,
    filing_status: &FilingStatus,
) -> f64 {
    if ltcg_income <= 0.0 {
        return 0.0;
    }

    // 2025 LTCG brackets
    let brackets: Vec<(f64, Option<f64>, f64)> = match filing_status {
        FilingStatus::Single => vec![
            (0.0, Some(48450.0), 0.00),
            (48450.0, Some(533400.0), 0.15),
            (533400.0, None, 0.20),
        ],
        FilingStatus::MarriedFilingJointly => vec![
            (0.0, Some(96900.0), 0.00),
            (96900.0, Some(600050.0), 0.15),
            (600050.0, None, 0.20),
        ],
        FilingStatus::MarriedFilingSeparately => vec![
            (0.0, Some(48450.0), 0.00),
            (48450.0, Some(300025.0), 0.15),
            (300025.0, None, 0.20),
        ],
        FilingStatus::HeadOfHousehold => vec![
            (0.0, Some(65250.0), 0.00),
            (65250.0, Some(566700.0), 0.15),
            (566700.0, None, 0.20),
        ],
    };

    // LTCG is stacked on top of ordinary income
    let mut tax = 0.0;
    let mut remaining_ltcg = ltcg_income;
    let mut current_threshold = ordinary_taxable_income;

    for (min, max, rate) in brackets {
        if remaining_ltcg <= 0.0 {
            break;
        }

        let bracket_max = max.unwrap_or(f64::INFINITY);

        if current_threshold < bracket_max {
            let applicable = remaining_ltcg.min(bracket_max - current_threshold.max(min));

            if applicable > 0.0 {
                tax += applicable * rate;
                remaining_ltcg -= applicable;
                current_threshold += applicable;
            }
        }
    }

    tax
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_progressive_tax_calculation() {
        let brackets = vec![
            TaxBracket {
                min: 0.0,
                max: Some(10000.0),
                rate: 0.10,
            },
            TaxBracket {
                min: 10000.0,
                max: Some(40000.0),
                rate: 0.12,
            },
            TaxBracket {
                min: 40000.0,
                max: None,
                rate: 0.22,
            },
        ];

        // Test income in first bracket
        let tax1 = calculate_progressive_tax(5000.0, &brackets);
        assert_eq!(tax1, 500.0); // 5000 * 0.10

        // Test income spanning two brackets
        let tax2 = calculate_progressive_tax(20000.0, &brackets);
        let expected = 10000.0 * 0.10 + 10000.0 * 0.12;
        assert_eq!(tax2, expected);

        // Test income spanning all brackets
        let tax3 = calculate_progressive_tax(50000.0, &brackets);
        let expected = 10000.0 * 0.10 + 30000.0 * 0.12 + 10000.0 * 0.22;
        assert_eq!(tax3, expected);
    }

    #[test]
    fn test_401k_limits() {
        assert_eq!(get_k401_contribution_limit(30), 23500.0);
        assert_eq!(get_k401_contribution_limit(50), 31000.0); // 23500 + 7500
        assert_eq!(get_k401_contribution_limit(60), 34750.0); // 23500 + 11250
        assert_eq!(get_k401_contribution_limit(64), 31000.0); // Back to standard catch-up
    }

    #[test]
    fn test_hsa_limits() {
        assert_eq!(get_hsa_contribution_limit(30), 4300.0);
        assert_eq!(get_hsa_contribution_limit(55), 5300.0); // 4300 + 1000
    }

    #[test]
    fn applies_2025_enhanced_senior_deduction() {
        assert_eq!(
            get_standard_deduction(&FilingStatus::Single, 65, 50_000.0),
            23_750.0
        );
        assert_eq!(
            get_standard_deduction(&FilingStatus::Single, 65, 175_000.0),
            17_750.0
        );
        assert_eq!(get_ca_standard_deduction(&FilingStatus::Single), 5_706.0);
    }

    #[test]
    fn working_cash_flow_invests_the_entire_residual() {
        let result = calculate_working_cash_flow(
            100_000.0,
            50_000.0,
            40,
            &FilingStatus::Single,
            &State::TX,
            &ContributionPolicy {
                hsa_eligible: true,
                use_backdoor_roth: true,
            },
            OtherIncome::default(),
        );

        let total_contributions = result.contributions.hsa
            + result.contributions.traditional
            + result.contributions.roth
            + result.contributions.taxable;
        // Gross is fully accounted for: taxed, spent, or saved. No fourth bucket.
        assert!((result.tax.total_tax + 50_000.0 + total_contributions - 100_000.0).abs() < 1e-6);
    }

    #[test]
    fn working_cash_flow_fills_statutory_limits_before_taxable() {
        let result = calculate_working_cash_flow(
            500_000.0,
            40_000.0,
            40,
            &FilingStatus::Single,
            &State::TX,
            &ContributionPolicy {
                hsa_eligible: true,
                use_backdoor_roth: true,
            },
            OtherIncome::default(),
        );

        assert_eq!(result.contributions.hsa, 4_300.0);
        assert_eq!(result.contributions.traditional, 23_500.0);
        assert_eq!(result.contributions.roth, 7_000.0);
        assert!(result.contributions.taxable > 100_000.0);
    }

    #[test]
    fn working_cash_flow_skips_unusable_space_without_losing_the_cash() {
        let eligible = calculate_working_cash_flow(
            200_000.0,
            40_000.0,
            40,
            &FilingStatus::Single,
            &State::TX,
            &ContributionPolicy {
                hsa_eligible: true,
                use_backdoor_roth: true,
            },
            OtherIncome::default(),
        );
        let ineligible = calculate_working_cash_flow(
            200_000.0,
            40_000.0,
            40,
            &FilingStatus::Single,
            &State::TX,
            &ContributionPolicy {
                hsa_eligible: false,
                use_backdoor_roth: false,
            },
            OtherIncome::default(),
        );

        assert_eq!(ineligible.contributions.hsa, 0.0);
        assert_eq!(ineligible.contributions.roth, 0.0);
        // The money still gets saved — it just goes to taxable instead.
        assert!(ineligible.contributions.taxable > eligible.contributions.taxable);
    }

    #[test]
    fn working_cash_flow_reports_a_funding_gap() {
        let underfunded = calculate_working_cash_flow(
            50_000.0,
            60_000.0,
            40,
            &FilingStatus::Single,
            &State::TX,
            &ContributionPolicy {
                hsa_eligible: false,
                use_backdoor_roth: false,
            },
            OtherIncome::default(),
        );
        assert!(underfunded.funding_gap > 10_000.0);
    }

    #[test]
    fn working_rmd_is_ordinary_income_but_not_wages() {
        let policy = ContributionPolicy {
            hsa_eligible: false,
            use_backdoor_roth: false,
        };
        let wages_only = calculate_working_cash_flow(
            100_000.0,
            60_000.0,
            75,
            &FilingStatus::Single,
            &State::TX,
            &policy,
            OtherIncome::default(),
        );
        let with_rmd = calculate_working_cash_flow(
            100_000.0,
            60_000.0,
            75,
            &FilingStatus::Single,
            &State::TX,
            &policy,
            OtherIncome {
                ordinary: 40_000.0,
                qualified: 0.0,
            },
        );
        let rmd_misclassified_as_wages = calculate_working_cash_flow(
            140_000.0,
            60_000.0,
            75,
            &FilingStatus::Single,
            &State::TX,
            &policy,
            OtherIncome::default(),
        );

        assert!(with_rmd.tax.total_tax > wages_only.tax.total_tax);
        // RMD proceeds are income the household did not spend, so they land in taxable.
        assert!(with_rmd.contributions.taxable > wages_only.contributions.taxable);
        assert!(rmd_misclassified_as_wages.tax.total_tax > with_rmd.tax.total_tax);
    }

    #[test]
    fn social_security_first_tier_uses_half_the_excess() {
        let taxable =
            calculate_taxable_social_security(20_000.0, 20_000.0, 0.0, &FilingStatus::Single);
        assert_eq!(taxable, 2_500.0);
    }

    #[test]
    fn applies_net_investment_income_tax_above_threshold() {
        let result =
            calculate_retirement_tax(0.0, 0.0, 250_000.0, 64, &FilingStatus::Single, &State::TX);
        assert!((result.total_tax - 29_770.0).abs() < 0.01);
    }
}
