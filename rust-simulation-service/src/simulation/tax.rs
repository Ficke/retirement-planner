/// Tax calculation module - ports TypeScript tax.ts logic to Rust
/// Implements federal/state income tax, FICA, and retirement account contribution calculations
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
    pub total_contributions: f64,
    pub funding_gap: f64,
}

// 2025 Federal Tax Brackets
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

// 2025 California Tax Brackets
fn get_ca_brackets(filing_status: &FilingStatus) -> Vec<TaxBracket> {
    match filing_status {
        FilingStatus::Single => vec![
            TaxBracket {
                min: 0.0,
                max: Some(10099.0),
                rate: 0.01,
            },
            TaxBracket {
                min: 10099.0,
                max: Some(23942.0),
                rate: 0.02,
            },
            TaxBracket {
                min: 23942.0,
                max: Some(37788.0),
                rate: 0.04,
            },
            TaxBracket {
                min: 37788.0,
                max: Some(52455.0),
                rate: 0.06,
            },
            TaxBracket {
                min: 52455.0,
                max: Some(66295.0),
                rate: 0.08,
            },
            TaxBracket {
                min: 66295.0,
                max: Some(338639.0),
                rate: 0.093,
            },
            TaxBracket {
                min: 338639.0,
                max: Some(406364.0),
                rate: 0.103,
            },
            TaxBracket {
                min: 406364.0,
                max: Some(677278.0),
                rate: 0.113,
            },
            TaxBracket {
                min: 677278.0,
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
                max: Some(20198.0),
                rate: 0.01,
            },
            TaxBracket {
                min: 20198.0,
                max: Some(47884.0),
                rate: 0.02,
            },
            TaxBracket {
                min: 47884.0,
                max: Some(75576.0),
                rate: 0.04,
            },
            TaxBracket {
                min: 75576.0,
                max: Some(104910.0),
                rate: 0.06,
            },
            TaxBracket {
                min: 104910.0,
                max: Some(132590.0),
                rate: 0.08,
            },
            TaxBracket {
                min: 132590.0,
                max: Some(677278.0),
                rate: 0.093,
            },
            TaxBracket {
                min: 677278.0,
                max: Some(812728.0),
                rate: 0.103,
            },
            // 11.3% statutory bracket runs to 1,354,556, but the 1% Mental
            // Health Services Tax applies above 1,000,000 — split accordingly.
            TaxBracket {
                min: 812728.0,
                max: Some(1000000.0),
                rate: 0.113,
            },
            TaxBracket {
                min: 1000000.0,
                max: Some(1354556.0),
                rate: 0.123,
            },
            TaxBracket {
                min: 1354556.0,
                max: None,
                rate: 0.133,
            },
        ],
        FilingStatus::MarriedFilingSeparately => vec![
            TaxBracket {
                min: 0.0,
                max: Some(10099.0),
                rate: 0.01,
            },
            TaxBracket {
                min: 10099.0,
                max: Some(23942.0),
                rate: 0.02,
            },
            TaxBracket {
                min: 23942.0,
                max: Some(37788.0),
                rate: 0.04,
            },
            TaxBracket {
                min: 37788.0,
                max: Some(52455.0),
                rate: 0.06,
            },
            TaxBracket {
                min: 52455.0,
                max: Some(66295.0),
                rate: 0.08,
            },
            TaxBracket {
                min: 66295.0,
                max: Some(338639.0),
                rate: 0.093,
            },
            TaxBracket {
                min: 338639.0,
                max: Some(406364.0),
                rate: 0.103,
            },
            TaxBracket {
                min: 406364.0,
                max: Some(677278.0),
                rate: 0.113,
            },
            TaxBracket {
                min: 677278.0,
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
                max: Some(20198.0),
                rate: 0.01,
            },
            TaxBracket {
                min: 20198.0,
                max: Some(47884.0),
                rate: 0.02,
            },
            TaxBracket {
                min: 47884.0,
                max: Some(61917.0),
                rate: 0.04,
            },
            TaxBracket {
                min: 61917.0,
                max: Some(76138.0),
                rate: 0.06,
            },
            TaxBracket {
                min: 76138.0,
                max: Some(90302.0),
                rate: 0.08,
            },
            TaxBracket {
                min: 90302.0,
                max: Some(460547.0),
                rate: 0.093,
            },
            TaxBracket {
                min: 460547.0,
                max: Some(552658.0),
                rate: 0.103,
            },
            TaxBracket {
                min: 552658.0,
                max: Some(921095.0),
                rate: 0.113,
            },
            TaxBracket {
                min: 921095.0,
                max: Some(1000000.0),
                rate: 0.123,
            },
            TaxBracket {
                min: 1000000.0,
                max: None,
                rate: 0.133,
            },
        ],
    }
}

// Standard deductions
fn get_standard_deduction(filing_status: &FilingStatus, age: u32) -> f64 {
    let base = match filing_status {
        FilingStatus::Single => 15000.0,
        FilingStatus::MarriedFilingJointly => 30000.0,
        FilingStatus::MarriedFilingSeparately => 15000.0,
        FilingStatus::HeadOfHousehold => 22500.0,
    };

    // Additional deduction for seniors (65+)
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

    base + additional
}

// CA standard deductions
fn get_ca_standard_deduction(filing_status: &FilingStatus) -> f64 {
    match filing_status {
        FilingStatus::Single => 5540.0,
        FilingStatus::MarriedFilingJointly => 11080.0,
        FilingStatus::MarriedFilingSeparately => 5540.0,
        FilingStatus::HeadOfHousehold => 11080.0,
    }
}

// 401k contribution limits
fn get_k401_contribution_limit(age: u32) -> f64 {
    if (60..=63).contains(&age) {
        // Enhanced catch-up for ages 60-63 (SECURE 2.0)
        23500.0 + 11250.0
    } else if age >= 50 {
        // Standard catch-up for 50+
        23500.0 + 7500.0
    } else {
        23500.0
    }
}

// HSA contribution limits
fn get_hsa_contribution_limit(age: u32) -> f64 {
    let base = 4300.0; // Individual coverage
    let catchup = if age >= 55 { 1000.0 } else { 0.0 };
    base + catchup
}

// IRA contribution limits
pub fn get_ira_contribution_limit(age: u32) -> f64 {
    if age >= 50 {
        7000.0 + 1000.0 // Base + catch-up
    } else {
        7000.0
    }
}

/// Calculate progressive tax given income and brackets
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

/// Calculate federal and state income taxes during working years
/// Matches TypeScript calculateTax() function
pub fn calculate_tax(
    gross_income: f64,
    _qualified_income: f64,
    age: u32,
    filing_status: &FilingStatus,
    state: &State,
    requested_hsa: f64,
    requested_traditional: f64,
) -> TaxResult {
    let hsa_max = get_hsa_contribution_limit(age);
    let k401_max = get_k401_contribution_limit(age);
    let standard_deduction = get_standard_deduction(filing_status, age);
    let federal_brackets = get_federal_brackets(filing_status);
    let hsa_contribution = requested_hsa.clamp(0.0, hsa_max).min(gross_income);
    let k401_contribution = requested_traditional
        .clamp(0.0, k401_max)
        .min((gross_income - hsa_contribution).max(0.0));

    let after_hsa_income = gross_income - hsa_contribution;
    let after_k401_income = after_hsa_income - k401_contribution;
    let federal_taxable_income = (after_k401_income - standard_deduction).max(0.0);
    let federal_tax = calculate_progressive_tax(federal_taxable_income, &federal_brackets);

    let state_tax = match state {
        State::CA => {
            let ca_deduction = get_ca_standard_deduction(filing_status);
            // California does not conform to the federal HSA deduction.
            let ca_taxable = (gross_income - k401_contribution - ca_deduction).max(0.0);
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

/// Resolve explicit annual targets against taxes, statutory limits, and
/// available cash. Priority matches TypeScript: HSA → Traditional → Roth → Taxable.
pub fn calculate_working_cash_flow(
    gross_income: f64,
    annual_spending: f64,
    age: u32,
    filing_status: &FilingStatus,
    state: &State,
    targets: &AnnualContributions,
) -> WorkingCashFlowResult {
    let mut tax = calculate_tax(gross_income, 0.0, age, filing_status, state, 0.0, 0.0);
    for _ in 0..4 {
        let available_before_contributions =
            (gross_income - tax.total_tax - annual_spending).max(0.0);
        let hsa = targets.hsa.min(available_before_contributions);
        let traditional = targets
            .traditional
            .min((available_before_contributions - hsa).max(0.0));
        tax = calculate_tax(
            gross_income,
            0.0,
            age,
            filing_status,
            state,
            hsa,
            traditional,
        );
    }

    let cash_after_pretax_and_spending = gross_income
        - tax.total_tax
        - annual_spending
        - tax.hsa_contribution
        - tax.k401_contribution;
    let funding_gap = (-cash_after_pretax_and_spending).max(0.0);
    let mut after_tax_budget = cash_after_pretax_and_spending.max(0.0);
    let roth = targets
        .roth
        .min(get_ira_contribution_limit(age))
        .min(after_tax_budget);
    after_tax_budget -= roth;
    let taxable = targets.taxable.min(after_tax_budget);

    let contributions = AnnualContributions {
        hsa: tax.hsa_contribution,
        traditional: tax.k401_contribution,
        roth,
        taxable,
    };
    let total_contributions =
        contributions.hsa + contributions.traditional + contributions.roth + contributions.taxable;

    WorkingCashFlowResult {
        tax,
        contributions,
        total_contributions,
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
    let standard_deduction = get_standard_deduction(filing_status, age);
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
    let total_federal_tax = federal_tax + ltcg_tax;

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
    fn working_cash_flow_uses_explicit_targets_and_reconciles() {
        let result = calculate_working_cash_flow(
            100_000.0,
            50_000.0,
            40,
            &FilingStatus::Single,
            &State::TX,
            &AnnualContributions {
                hsa: 4_300.0,
                traditional: 10_000.0,
                roth: 7_000.0,
                taxable: 5_000.0,
            },
        );

        assert_eq!(result.contributions.hsa, 4_300.0);
        assert_eq!(result.contributions.traditional, 10_000.0);
        assert_eq!(result.contributions.roth, 7_000.0);
        assert_eq!(result.contributions.taxable, 5_000.0);
        assert!(result.tax.total_tax + 50_000.0 + result.total_contributions <= 100_000.0);

        let underfunded = calculate_working_cash_flow(
            50_000.0,
            60_000.0,
            40,
            &FilingStatus::Single,
            &State::TX,
            &AnnualContributions {
                hsa: 0.0,
                traditional: 0.0,
                roth: 0.0,
                taxable: 0.0,
            },
        );
        assert!(underfunded.funding_gap > 10_000.0);
    }

    #[test]
    fn social_security_first_tier_uses_half_the_excess() {
        let taxable =
            calculate_taxable_social_security(20_000.0, 20_000.0, 0.0, &FilingStatus::Single);
        assert_eq!(taxable, 2_500.0);
    }
}
