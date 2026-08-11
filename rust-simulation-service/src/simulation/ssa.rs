use once_cell::sync::Lazy;
/// Social Security Administration benefit calculations
/// Ports TypeScript ssa.ts logic to Rust
/// Implements AIME/PIA calculation using bend points and claiming age adjustments
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct SSABendPoint {
    pub threshold: Option<f64>,
    pub rate: f64,
}

#[derive(Debug, Clone)]
pub struct SSABenefitResult {
    pub annual_benefit: f64,
}

/// 2025 estimated bend points
static BEND_POINTS: Lazy<Vec<SSABendPoint>> = Lazy::new(|| {
    vec![
        SSABendPoint {
            threshold: Some(1226.0),
            rate: 0.90,
        },
        SSABendPoint {
            threshold: Some(7391.0),
            rate: 0.32,
        },
        SSABendPoint {
            threshold: None,
            rate: 0.15,
        },
    ]
});

/// Claiming age adjustment factors
static CLAIM_AGE_ADJUSTMENTS: Lazy<HashMap<u32, f64>> = Lazy::new(|| {
    let mut m = HashMap::new();
    m.insert(62, 0.70);
    m.insert(63, 0.75);
    m.insert(64, 0.80);
    m.insert(65, 0.8667);
    m.insert(66, 0.9333);
    m.insert(67, 1.0); // Full retirement age
    m.insert(68, 1.08);
    m.insert(69, 1.16);
    m.insert(70, 1.24);
    m
});

const MAX_TAXABLE_WAGE: f64 = 176_100.0;

/// Estimate Social Security benefits based on salary history and claim age
///
/// @param salary_history - Array of annual salaries (ideally 35 years)
/// @param claim_age - Age when benefits are claimed (62-70)
/// @returns Detailed benefit calculation
pub fn calculate_ssa_benefit(salary_history: &[f64], claim_age: u32) -> SSABenefitResult {
    let aime = calculate_aime(salary_history);
    let pia = calculate_pia(aime, &BEND_POINTS);
    let claim_adjustment = get_claim_age_adjustment(claim_age);

    let annual_benefit = pia * claim_adjustment * 12.0;

    SSABenefitResult { annual_benefit }
}

/// Calculate Average Indexed Monthly Earnings (AIME) from salary history
/// Uses the highest 35 years of indexed earnings
///
/// @param salary_history - Array of annual salaries
/// @returns Monthly average of top 35 indexed years
pub fn calculate_aime(salary_history: &[f64]) -> f64 {
    // TODO: Implement proper wage indexing using SSA historical data
    // For now, use nominal values and top years available
    let mut sorted_salaries = salary_history.to_vec();
    sorted_salaries.sort_by(|a, b| b.partial_cmp(a).unwrap());

    let top_35_years: Vec<f64> = sorted_salaries
        .into_iter()
        .take(35.min(salary_history.len()))
        .collect();

    let total_earnings: f64 = top_35_years
        .iter()
        .map(|salary| salary.clamp(0.0, MAX_TAXABLE_WAGE))
        .sum();
    (total_earnings / 420.0).floor()
}

/// Calculate Primary Insurance Amount (PIA) using bend points
///
/// @param aime - Average Indexed Monthly Earnings
/// @param bend_points - SSA bend points for the calculation year
/// @returns Primary Insurance Amount (monthly)
pub fn calculate_pia(aime: f64, bend_points: &[SSABendPoint]) -> f64 {
    let mut pia = 0.0;
    let mut remaining_aime = aime;
    let mut previous_threshold = 0.0;

    for bend_point in bend_points {
        let current_threshold = bend_point.threshold.unwrap_or(f64::INFINITY);
        let bracket_width = current_threshold - previous_threshold;
        let applicable_amount = remaining_aime.min(bracket_width);

        if applicable_amount > 0.0 {
            pia += applicable_amount * bend_point.rate;
            remaining_aime -= applicable_amount;
        }

        if remaining_aime <= 0.0 {
            break;
        }
        previous_threshold = current_threshold;
    }

    (pia * 10.0).floor() / 10.0
}

/// Get claiming age adjustment factor
/// Early claiming reduces benefits; delayed claiming increases them
///
/// @param claim_age - Age when benefits are claimed (62-70)
/// @returns Adjustment factor to apply to PIA
pub fn get_claim_age_adjustment(claim_age: u32) -> f64 {
    CLAIM_AGE_ADJUSTMENTS
        .get(&claim_age)
        .copied()
        .unwrap_or(1.0)
}

/// Estimate salary history for Social Security calculation
/// Projects backwards from current salary and growth rate
///
/// @param current_salary - Current annual salary
/// @param salary_growth_rate - Real annual salary growth rate
/// @param current_age - Current age
/// @param retirement_age - Planned retirement age
/// @returns Array of estimated annual salaries for SS calculation
pub fn estimate_salary_history(
    current_salary: f64,
    salary_growth_rate: f64,
    current_age: u32,
    retirement_age: u32,
) -> Vec<f64> {
    let mut salary_history = Vec::new();

    // Use age 22 as the estimated career start, unless the user is already
    // earning a salary at a younger current age.
    let career_start_age = 22.min(current_age);
    for age in career_start_age..retirement_age {
        let years_from_current_age = age as i32 - current_age as i32;
        salary_history
            .push(current_salary * (1.0 + salary_growth_rate).powi(years_from_current_age));
    }

    salary_history
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_aime_calculation() {
        // Test with simple uniform salary
        let salary_history: Vec<f64> = vec![50000.0; 35];
        let aime = calculate_aime(&salary_history);
        assert_eq!(aime, 4_166.0);
    }

    #[test]
    fn test_aime_with_less_than_35_years() {
        let salary_history: Vec<f64> = vec![60000.0; 20];
        let aime = calculate_aime(&salary_history);
        assert_eq!(aime, (60000.0_f64 * 20.0 / 420.0).floor());

        let capped = calculate_aime(&vec![1_000_000.0; 35]);
        assert_eq!(capped, 14_675.0);
    }

    #[test]
    fn test_pia_calculation() {
        // Test with AIME of $5000/month
        let aime = 5000.0;
        let bend_points = vec![
            SSABendPoint {
                threshold: Some(1174.0),
                rate: 0.90,
            },
            SSABendPoint {
                threshold: Some(7078.0),
                rate: 0.32,
            },
            SSABendPoint {
                threshold: None,
                rate: 0.15,
            },
        ];

        let pia = calculate_pia(aime, &bend_points);

        // Expected: 1174*0.9 + (5000-1174)*0.32
        let expected = 1174.0 * 0.90 + (5000.0 - 1174.0) * 0.32;
        assert_eq!(pia, (expected * 10.0_f64).floor() / 10.0);
    }

    #[test]
    fn test_claim_age_adjustments() {
        assert_eq!(get_claim_age_adjustment(62), 0.70); // FRA 67: 30% early-claim reduction
        assert_eq!(get_claim_age_adjustment(67), 1.0); // Full retirement age
        assert_eq!(get_claim_age_adjustment(70), 1.24); // Delayed claiming
    }

    #[test]
    fn test_full_benefit_calculation() {
        let salary_history: Vec<f64> = vec![75000.0; 35];
        let result = calculate_ssa_benefit(&salary_history, 67);

        // At FRA (67), claim adjustment is 1.0, so annual_benefit = PIA * 12.
        let aime = (75000.0_f64 / 12.0).floor();
        let expected_pia = 1226.0 * 0.90 + (aime - 1226.0) * 0.32;
        let expected_annual = (expected_pia * 10.0_f64).floor() / 10.0 * 12.0;
        assert!((result.annual_benefit - expected_annual).abs() < 0.01);
    }

    #[test]
    fn test_estimate_salary_history() {
        let history = estimate_salary_history(100000.0, 0.03, 45, 65);

        // Should have entries
        assert!(!history.is_empty());

        // Preserve the full estimated record; AIME selects its highest 35 years.
        assert_eq!(history.len(), 43);
        assert!((history[23] - 100000.0).abs() < 0.01); // age 45

        // All salaries should be positive
        assert!(history.iter().all(|&s| s > 0.0));
    }
}
