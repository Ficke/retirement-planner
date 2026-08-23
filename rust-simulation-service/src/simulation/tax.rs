//! Federal, state, and FICA tax shared by native and browser WebAssembly builds.
use crate::simulation::historical_data::HISTORICAL_RETURNS;
use crate::simulation::state_tax::{state_brackets, state_standard_deduction, state_tax_profile};
use crate::types::{AnnualContributions, FilingStatus, State};

/// The tax year every bracket, deduction, and limit here is stated in.
pub const TAX_LAW_YEAR: i32 = 2025;

/// The OBBBA enhanced senior deduction — per qualifying individual, phased out
/// on the household total, and scheduled to lapse after 2028.
const OBBBA_PER_PERSON: f64 = 6_000.0;
const OBBBA_PHASEOUT_START_JOINT: f64 = 150_000.0;
const OBBBA_PHASEOUT_START_OTHER: f64 = 75_000.0;
const OBBBA_PHASEOUT_RATE: f64 = 0.06;
const OBBBA_LAST_YEAR: i32 = 2028;

/// Long-run CPI, derived from the same dataset the engines sample, used only to
/// erode thresholds Congress never indexed.
static LONG_RUN_INFLATION: std::sync::LazyLock<f64> = std::sync::LazyLock::new(|| {
    let total: f64 = HISTORICAL_RETURNS.iter().map(|r| r.inflation_rate).sum();
    total / HISTORICAL_RETURNS.len() as f64
});

/// The people a plan models. Ages drive per-person deductions; filing status is
/// a separate fact, because a married couple with one earner still files jointly.
#[derive(Debug, Clone)]
pub struct Household {
    pub filing_status: FilingStatus,
    /// One age, or two when the plan models a spouse.
    pub ages: Vec<u32>,
}

impl Household {
    pub fn new(filing_status: FilingStatus, ages: Vec<u32>) -> Self {
        Self {
            filing_status,
            ages,
        }
    }

    pub fn single(filing_status: FilingStatus, age: u32) -> Self {
        Self::new(filing_status, vec![age])
    }

    fn primary_age(&self) -> u32 {
        self.ages.first().copied().unwrap_or(0)
    }

    fn seniors(&self) -> usize {
        self.ages.iter().filter(|age| **age >= 65).count()
    }
}

/// A threshold Congress wrote in nominal dollars and never indexed, expressed in
/// the real dollars the engines work in. Regular brackets and the standard
/// deduction are inflation-indexed, so they stay fixed in real terms; these do
/// the opposite and shrink every year.
fn frozen_threshold(nominal_2025: f64, tax_year: i32) -> f64 {
    let years = tax_year - TAX_LAW_YEAR;
    if years <= 0 {
        return nominal_2025;
    }
    nominal_2025 / (1.0 + *LONG_RUN_INFLATION).powi(years)
}

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
    /// Cash left once taxes, spending, and pretax contributions are paid.
    /// Negative means the portfolio has to cover the difference; that is a
    /// drawdown, not a failure.
    pub net_cash_flow: f64,
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

/// The standard deduction the household actually gets. The additional senior
/// amount and the OBBBA enhanced deduction are both per qualifying individual,
/// so a couple where both are 65 or older receives two of each.
pub fn deduction_for(
    household: &Household,
    tax_year: i32,
    modified_adjusted_gross_income: f64,
) -> f64 {
    let filing_status = &household.filing_status;
    let base = match filing_status {
        FilingStatus::Single => 15750.0,
        FilingStatus::MarriedFilingJointly => 31500.0,
        FilingStatus::MarriedFilingSeparately => 15750.0,
        FilingStatus::HeadOfHousehold => 23625.0,
    };
    let seniors = household.seniors();
    if seniors == 0 {
        return base;
    }

    let per_senior = match filing_status {
        FilingStatus::Single => 2000.0,
        FilingStatus::MarriedFilingJointly => 1600.0,
        FilingStatus::MarriedFilingSeparately => 1600.0,
        FilingStatus::HeadOfHousehold => 2000.0,
    };
    let deduction = base + seniors as f64 * per_senior;

    // Married filing separately is not eligible, and the enhanced deduction is
    // scheduled to lapse after 2028. Its phaseout applies to the household total
    // rather than to each person's share.
    if matches!(filing_status, FilingStatus::MarriedFilingSeparately) || tax_year > OBBBA_LAST_YEAR
    {
        return deduction;
    }

    let phaseout_start = if matches!(filing_status, FilingStatus::MarriedFilingJointly) {
        OBBBA_PHASEOUT_START_JOINT
    } else {
        OBBBA_PHASEOUT_START_OTHER
    };
    let reduction =
        (modified_adjusted_gross_income - phaseout_start).max(0.0) * OBBBA_PHASEOUT_RATE;
    deduction + (seniors as f64 * OBBBA_PER_PERSON - reduction).max(0.0)
}

/// Federal income tax on one year, whether or not wages are still coming in.
///
/// Qualified dividends and long-term gains stack on top of ordinary income for
/// rate determination, and any standard deduction ordinary income did not use is
/// applied to them first. Working and retirement years differ only in what they
/// put into `ordinary` — which is why they share this and not two copies of it.
pub fn federal_tax_on(
    ordinary: f64,
    qualified: f64,
    deduction: f64,
    filing_status: &FilingStatus,
    tax_year: i32,
) -> f64 {
    let brackets = get_federal_brackets(filing_status);
    let taxable_income = (ordinary - deduction).max(0.0);
    let ordinary_tax = calculate_progressive_tax(taxable_income, &brackets);

    let unused_deduction = (deduction - ordinary).max(0.0);
    let taxable_qualified = (qualified - unused_deduction).max(0.0);
    let ltcg_tax = calculate_ltcg_tax(taxable_income, taxable_qualified, filing_status);

    let net_investment_income_threshold = match filing_status {
        FilingStatus::MarriedFilingJointly => 250_000.0,
        FilingStatus::MarriedFilingSeparately => 125_000.0,
        _ => 200_000.0,
    };
    let net_investment_income_tax = 0.038
        * qualified.max(0.0).min(
            (ordinary + qualified - frozen_threshold(net_investment_income_threshold, tax_year))
                .max(0.0),
        );

    ordinary_tax + ltcg_tax + net_investment_income_tax
}

pub struct StateTaxInput {
    pub wages: f64,
    pub other_ordinary: f64,
    pub qualified: f64,
    pub social_security: f64,
    pub pretax_hsa: f64,
    pub pretax_traditional: f64,
}

/// State income tax from the state's own profile. A state with no income tax and
/// a state nobody has modeled yet both produce zero here.
pub fn state_tax_of(state: &State, filing_status: &FilingStatus, input: &StateTaxInput) -> f64 {
    let (Some(brackets), Some(deduction)) = (
        state_brackets(state, filing_status),
        state_standard_deduction(state, filing_status),
    ) else {
        return 0.0;
    };
    let profile = state_tax_profile(state);

    let deductible_pretax = if profile.conforms_to_federal_hsa {
        input.pretax_hsa + input.pretax_traditional
    } else {
        input.pretax_traditional
    };
    let social_security = if profile.social_security_exempt {
        0.0
    } else {
        input.social_security
    };

    let taxable_income = (input.wages + input.other_ordinary + input.qualified + social_security
        - deductible_pretax
        - deduction)
        .max(0.0);
    calculate_progressive_tax(taxable_income, &brackets)
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

/// Federal, state, and FICA tax on a working year. Contribution targets are
/// clamped to statutory limits and to what the income can actually fund.
fn calculate_tax(
    gross_income: f64,
    qualified_income: f64,
    household: &Household,
    state: &State,
    tax_year: i32,
    requested: &PretaxContributionTargets,
    other_ordinary_income: f64,
) -> TaxResult {
    let filing_status = &household.filing_status;
    let primary_age = household.primary_age();
    let hsa_contribution = requested
        .hsa
        .clamp(0.0, get_hsa_contribution_limit(primary_age))
        .min(gross_income);
    let k401_contribution = requested
        .traditional
        .clamp(0.0, get_k401_contribution_limit(primary_age))
        .min((gross_income - hsa_contribution).max(0.0));

    let after_pretax_wages = gross_income - hsa_contribution - k401_contribution;
    let ordinary = after_pretax_wages + other_ordinary_income;
    let deduction = deduction_for(household, tax_year, ordinary + qualified_income);
    let federal_tax = federal_tax_on(
        ordinary,
        qualified_income,
        deduction,
        filing_status,
        tax_year,
    );

    let state_tax = state_tax_of(
        state,
        filing_status,
        &StateTaxInput {
            wages: gross_income,
            other_ordinary: other_ordinary_income,
            qualified: qualified_income,
            social_security: 0.0,
            pretax_hsa: hsa_contribution,
            pretax_traditional: k401_contribution,
        },
    );

    const FICA_WAGE_BASE: f64 = 176100.0;
    const SOCIAL_SECURITY_RATE: f64 = 0.062;
    const MEDICARE_RATE: f64 = 0.0145;
    const MEDICARE_ADDITIONAL_RATE: f64 = 0.009;
    let social_security_tax = gross_income.min(FICA_WAGE_BASE) * SOCIAL_SECURITY_RATE;
    let medicare_tax = gross_income * MEDICARE_RATE;
    let additional_medicare_threshold = frozen_threshold(
        match filing_status {
            FilingStatus::MarriedFilingJointly => 250_000.0,
            FilingStatus::MarriedFilingSeparately => 125_000.0,
            _ => 200_000.0,
        },
        tax_year,
    );
    let additional_medicare_tax = if gross_income > additional_medicare_threshold {
        (gross_income - additional_medicare_threshold) * MEDICARE_ADDITIONAL_RATE
    } else {
        0.0
    };
    let fica_tax = social_security_tax + medicare_tax + additional_medicare_tax;

    TaxResult {
        total_tax: federal_tax + state_tax + fica_tax,
        hsa_contribution,
        k401_contribution,
    }
}

/// Savings is the residual: whatever gross income does not lose to taxes and
/// spending gets invested. Contributions fill statutory limits in the order
/// HSA → Traditional → Roth, and taxable absorbs the remainder — so no cash is
/// ever left over, and none of it disappears.
pub fn calculate_working_cash_flow(
    gross_income: f64,
    annual_spending: f64,
    household: &Household,
    state: &State,
    tax_year: i32,
    policy: &ContributionPolicy,
    other: OtherIncome,
) -> WorkingCashFlowResult {
    let primary_age = household.primary_age();
    let hsa_max = if policy.hsa_eligible {
        get_hsa_contribution_limit(primary_age)
    } else {
        0.0
    };
    let k401_max = get_k401_contribution_limit(primary_age);
    let mut tax = calculate_tax(
        gross_income,
        other.qualified,
        household,
        state,
        tax_year,
        &PretaxContributionTargets {
            hsa: 0.0,
            traditional: 0.0,
        },
        other.ordinary,
    );
    for _ in 0..4 {
        let available_before_contributions =
            (gross_income + other.ordinary - tax.total_tax - annual_spending).max(0.0);
        let hsa = hsa_max.min(available_before_contributions);
        let traditional = k401_max.min((available_before_contributions - hsa).max(0.0));
        tax = calculate_tax(
            gross_income,
            other.qualified,
            household,
            state,
            tax_year,
            &PretaxContributionTargets { hsa, traditional },
            other.ordinary,
        );
    }

    let cash_after_pretax_and_spending = gross_income + other.ordinary
        - tax.total_tax
        - annual_spending
        - tax.hsa_contribution
        - tax.k401_contribution;
    let after_tax_budget = cash_after_pretax_and_spending.max(0.0);
    let roth = if policy.use_backdoor_roth {
        get_ira_contribution_limit(primary_age).min(after_tax_budget)
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
        net_cash_flow: cash_after_pretax_and_spending,
    }
}

/// Taxable income a retirement year reports, which is what a bracket ceiling is
/// measured against. Split out from `calculate_retirement_tax` because the tax
/// itself is not what a conversion is aiming at.
pub fn retirement_taxable_income(
    traditional_withdrawals: f64,
    social_security_benefit: f64,
    qualified_income: f64,
    household: &Household,
    tax_year: i32,
) -> f64 {
    let taxable_ss = calculate_taxable_social_security(
        traditional_withdrawals,
        social_security_benefit,
        qualified_income,
        &household.filing_status,
        tax_year,
    );
    let ordinary = traditional_withdrawals + taxable_ss;
    let deduction = deduction_for(household, tax_year, ordinary + qualified_income);
    (ordinary - deduction).max(0.0)
}

/// Top of the bounded federal bracket at `rate`. Brackets are inflation-indexed,
/// so the 2025 table stands unadjusted in the real dollars the projection uses.
pub fn federal_bracket_top(rate: f64, filing_status: &FilingStatus) -> Option<f64> {
    get_federal_brackets(filing_status)
        .into_iter()
        .find(|bracket| (bracket.rate - rate).abs() < 1e-9)
        .and_then(|bracket| bracket.max)
}

/// Tax on a retirement year. Wages have stopped, so there is no FICA and no
/// contribution to deduct; Social Security is taxed under its own rules.
pub fn calculate_retirement_tax(
    traditional_withdrawals: f64,
    social_security_benefit: f64,
    qualified_income: f64,
    household: &Household,
    state: &State,
    tax_year: i32,
) -> TaxResult {
    let filing_status = &household.filing_status;
    let taxable_ss = calculate_taxable_social_security(
        traditional_withdrawals,
        social_security_benefit,
        qualified_income,
        filing_status,
        tax_year,
    );

    let ordinary = traditional_withdrawals + taxable_ss;
    let deduction = deduction_for(household, tax_year, ordinary + qualified_income);
    let federal_tax = federal_tax_on(
        ordinary,
        qualified_income,
        deduction,
        filing_status,
        tax_year,
    );

    let state_tax = state_tax_of(
        state,
        filing_status,
        &StateTaxInput {
            wages: 0.0,
            other_ordinary: traditional_withdrawals,
            qualified: qualified_income,
            social_security: social_security_benefit,
            pretax_hsa: 0.0,
            pretax_traditional: 0.0,
        },
    );

    TaxResult {
        total_tax: federal_tax + state_tax,
        hsa_contribution: 0.0,
        k401_contribution: 0.0,
    }
}

pub fn calculate_taxable_social_security(
    other_income: f64,
    social_security_benefit: f64,
    qualified_income: f64,
    filing_status: &FilingStatus,
    tax_year: i32,
) -> f64 {
    if social_security_benefit == 0.0 {
        return 0.0;
    }

    // Combined income = AGI + nontaxable interest + 50% of SS benefits
    let combined_income = other_income + qualified_income + (social_security_benefit * 0.5);

    // Fixed in nominal dollars since 1984, so in the real dollars the engine
    // works in they shrink every year and take a larger share of every benefit.
    let (nominal_tier1, nominal_tier2) = match filing_status {
        FilingStatus::Single => (25000.0, 34000.0),
        FilingStatus::MarriedFilingJointly => (32000.0, 44000.0),
        FilingStatus::MarriedFilingSeparately => (0.0, 0.0),
        FilingStatus::HeadOfHousehold => (25000.0, 34000.0),
    };
    let tier1 = frozen_threshold(nominal_tier1, tax_year);
    let tier2 = frozen_threshold(nominal_tier2, tax_year);

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

    fn assert_close(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() < 0.01,
            "expected {expected:.2}, got {actual:.2}"
        );
    }

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
        let single_at_65 = Household::single(FilingStatus::Single, 65);
        assert_eq!(deduction_for(&single_at_65, 2026, 50_000.0), 23_750.0);
        assert_eq!(deduction_for(&single_at_65, 2026, 175_000.0), 17_750.0);
    }

    #[test]
    fn enhanced_senior_deduction_lapses_after_2028() {
        let single_at_65 = Household::single(FilingStatus::Single, 65);
        assert_eq!(deduction_for(&single_at_65, 2028, 50_000.0), 23_750.0);
        assert_eq!(deduction_for(&single_at_65, 2029, 50_000.0), 17_750.0);
    }

    #[test]
    fn senior_amounts_are_per_person() {
        let one = Household::new(FilingStatus::MarriedFilingJointly, vec![66, 60]);
        let both = Household::new(FilingStatus::MarriedFilingJointly, vec![66, 67]);
        // Each qualifying spouse adds $1,600 and another $6,000 of OBBBA.
        assert_eq!(
            deduction_for(&both, 2026, 50_000.0) - deduction_for(&one, 2026, 50_000.0),
            7_600.0
        );
    }

    #[test]
    fn frozen_thresholds_shrink_in_real_terms() {
        assert_eq!(frozen_threshold(25_000.0, 2025), 25_000.0);
        assert!(frozen_threshold(25_000.0, 2045) < 15_000.0);
    }

    #[test]
    fn taxes_capital_gains_realized_in_a_working_year() {
        let policy = ContributionPolicy {
            hsa_eligible: false,
            use_backdoor_roth: false,
        };
        let household = Household::single(FilingStatus::Single, 45);
        let wages_only = calculate_working_cash_flow(
            200_000.0,
            60_000.0,
            &household,
            &State::CA,
            2026,
            &policy,
            OtherIncome {
                ordinary: 0.0,
                qualified: 0.0,
            },
        );
        let with_gains = calculate_working_cash_flow(
            200_000.0,
            60_000.0,
            &household,
            &State::CA,
            2026,
            &policy,
            OtherIncome {
                ordinary: 0.0,
                qualified: 100_000.0,
            },
        );
        assert!(with_gains.tax.total_tax > wages_only.tax.total_tax);
    }

    #[test]
    fn working_cash_flow_invests_the_entire_residual() {
        let result = calculate_working_cash_flow(
            100_000.0,
            50_000.0,
            &Household::single(FilingStatus::Single, 40),
            &State::TX,
            2026,
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
            &Household::single(FilingStatus::Single, 40),
            &State::TX,
            2026,
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
            &Household::single(FilingStatus::Single, 40),
            &State::TX,
            2026,
            &ContributionPolicy {
                hsa_eligible: true,
                use_backdoor_roth: true,
            },
            OtherIncome::default(),
        );
        let ineligible = calculate_working_cash_flow(
            200_000.0,
            40_000.0,
            &Household::single(FilingStatus::Single, 40),
            &State::TX,
            2026,
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
    fn working_cash_flow_reports_a_shortfall() {
        let underfunded = calculate_working_cash_flow(
            50_000.0,
            60_000.0,
            &Household::single(FilingStatus::Single, 40),
            &State::TX,
            2026,
            &ContributionPolicy {
                hsa_eligible: false,
                use_backdoor_roth: false,
            },
            OtherIncome::default(),
        );
        assert!(underfunded.net_cash_flow < -10_000.0);
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
            &Household::single(FilingStatus::Single, 75),
            &State::TX,
            2026,
            &policy,
            OtherIncome::default(),
        );
        let with_rmd = calculate_working_cash_flow(
            100_000.0,
            60_000.0,
            &Household::single(FilingStatus::Single, 75),
            &State::TX,
            2026,
            &policy,
            OtherIncome {
                ordinary: 40_000.0,
                qualified: 0.0,
            },
        );
        let rmd_misclassified_as_wages = calculate_working_cash_flow(
            140_000.0,
            60_000.0,
            &Household::single(FilingStatus::Single, 75),
            &State::TX,
            2026,
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
            calculate_taxable_social_security(20_000.0, 20_000.0, 0.0, &FilingStatus::Single, 2025);
        assert_eq!(taxable, 2_500.0);
    }

    #[test]
    fn applies_net_investment_income_tax_above_threshold() {
        let at_law_year = calculate_retirement_tax(
            0.0,
            0.0,
            250_000.0,
            &Household::single(FilingStatus::Single, 64),
            &State::TX,
            TAX_LAW_YEAR,
        );
        assert!((at_law_year.total_tax - 29_770.0).abs() < 0.01);

        // The $200,000 threshold is fixed in nominal dollars, so in real terms
        // it shrinks and catches more of the same income every year.
        let twenty_years_on = calculate_retirement_tax(
            0.0,
            0.0,
            250_000.0,
            &Household::single(FilingStatus::Single, 64),
            &State::TX,
            TAX_LAW_YEAR + 20,
        );
        assert!(twenty_years_on.total_tax > at_law_year.total_tax);
    }

    #[test]
    fn uses_final_2025_california_brackets_and_standard_deduction() {
        let tax = state_tax_of(
            &State::CA,
            &FilingStatus::Single,
            &StateTaxInput {
                wages: 0.0,
                other_ordinary: 100_000.0,
                qualified: 0.0,
                social_security: 0.0,
                pretax_hsa: 0.0,
                pretax_traditional: 0.0,
            },
        );

        assert_close(tax, 5_207.98);
    }

    #[test]
    fn long_term_gains_stack_on_top_of_ordinary_income() {
        let ordinary_only = federal_tax_on(40_000.0, 0.0, 0.0, &FilingStatus::Single, TAX_LAW_YEAR);
        let with_gains =
            federal_tax_on(40_000.0, 20_000.0, 0.0, &FilingStatus::Single, TAX_LAW_YEAR);

        // $8,450 fills the remaining 0% band and $11,550 is taxed at 15%.
        assert_close(with_gains - ordinary_only, 1_732.50);
    }

    #[test]
    fn unused_standard_deduction_offsets_qualified_income() {
        let tax = federal_tax_on(0.0, 10_000.0, 15_750.0, &FilingStatus::Single, TAX_LAW_YEAR);

        assert_eq!(tax, 0.0);
    }

    #[test]
    fn social_security_taxable_amount_is_capped_at_eighty_five_percent() {
        let taxable = calculate_taxable_social_security(
            40_000.0,
            20_000.0,
            0.0,
            &FilingStatus::Single,
            TAX_LAW_YEAR,
        );

        assert_eq!(taxable, 17_000.0);
    }

    #[test]
    fn california_excludes_social_security_from_taxable_income() {
        let input = |social_security| StateTaxInput {
            wages: 0.0,
            other_ordinary: 20_000.0,
            qualified: 0.0,
            social_security,
            pretax_hsa: 0.0,
            pretax_traditional: 0.0,
        };

        let without_benefits = state_tax_of(&State::CA, &FilingStatus::Single, &input(0.0));
        let with_benefits = state_tax_of(&State::CA, &FilingStatus::Single, &input(50_000.0));

        assert_eq!(with_benefits, without_benefits);
    }

    #[test]
    fn social_security_thresholds_erode_and_joint_thresholds_remain_distinct() {
        let single_at_law_year = calculate_taxable_social_security(
            25_000.0,
            20_000.0,
            0.0,
            &FilingStatus::Single,
            TAX_LAW_YEAR,
        );
        let joint_at_law_year = calculate_taxable_social_security(
            25_000.0,
            20_000.0,
            0.0,
            &FilingStatus::MarriedFilingJointly,
            TAX_LAW_YEAR,
        );
        let joint_twenty_years_on = calculate_taxable_social_security(
            25_000.0,
            20_000.0,
            0.0,
            &FilingStatus::MarriedFilingJointly,
            TAX_LAW_YEAR + 20,
        );

        assert_close(single_at_law_year, 5_350.0);
        assert_close(joint_at_law_year, 1_500.0);
        assert!(joint_twenty_years_on > joint_at_law_year);
    }

    #[test]
    fn gains_and_rmds_do_not_increase_payroll_tax() {
        let household = Household::single(FilingStatus::Single, 45);
        let requested = PretaxContributionTargets {
            hsa: 0.0,
            traditional: 0.0,
        };
        let baseline = calculate_tax(
            100_000.0,
            0.0,
            &household,
            &State::TX,
            TAX_LAW_YEAR,
            &requested,
            0.0,
        );
        let with_gains = calculate_tax(
            100_000.0,
            50_000.0,
            &household,
            &State::TX,
            TAX_LAW_YEAR,
            &requested,
            0.0,
        );
        let with_rmd = calculate_tax(
            100_000.0,
            0.0,
            &household,
            &State::TX,
            TAX_LAW_YEAR,
            &requested,
            50_000.0,
        );
        let deduction = deduction_for(&household, TAX_LAW_YEAR, 100_000.0);
        let gains_deduction = deduction_for(&household, TAX_LAW_YEAR, 150_000.0);
        let expected_gain_tax_increase = federal_tax_on(
            100_000.0,
            50_000.0,
            gains_deduction,
            &FilingStatus::Single,
            TAX_LAW_YEAR,
        ) - federal_tax_on(
            100_000.0,
            0.0,
            deduction,
            &FilingStatus::Single,
            TAX_LAW_YEAR,
        );
        let expected_rmd_tax_increase = federal_tax_on(
            150_000.0,
            0.0,
            gains_deduction,
            &FilingStatus::Single,
            TAX_LAW_YEAR,
        ) - federal_tax_on(
            100_000.0,
            0.0,
            deduction,
            &FilingStatus::Single,
            TAX_LAW_YEAR,
        );

        assert_close(
            with_gains.total_tax - baseline.total_tax,
            expected_gain_tax_increase,
        );
        assert_close(
            with_rmd.total_tax - baseline.total_tax,
            expected_rmd_tax_increase,
        );
    }
}
