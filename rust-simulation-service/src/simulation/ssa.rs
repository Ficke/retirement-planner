//! Social Security benefit calculations using AIME, PIA, bend points, and
//! claiming-age adjustments.

use once_cell::sync::Lazy;

#[derive(Debug, Clone)]
pub struct SSABendPoint {
    pub threshold: Option<f64>,
    pub rate: f64,
}

#[derive(Debug, Clone)]
pub struct SSABenefitResult {
    pub annual_benefit: f64,
}

/// 2025 estimated bend points.
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

const MAX_TAXABLE_WAGE: f64 = 176_100.0;

/// Estimates an annual benefit from earnings history and claiming age.
pub fn calculate_ssa_benefit(
    salary_history: &[f64],
    claim_age: u32,
    birth_year: i32,
) -> SSABenefitResult {
    let aime = calculate_aime(salary_history);
    let pia = calculate_pia(aime, &BEND_POINTS);
    let claim_adjustment = get_claim_age_adjustment(claim_age, birth_year);

    let annual_benefit = pia * claim_adjustment * 12.0;

    SSABenefitResult { annual_benefit }
}

/// Calculates average monthly earnings from the highest 35 annual values.
///
/// The current model does not wage-index historical earnings. Missing years in
/// a shorter history remain zero because the divisor is always 420 months.
pub fn calculate_aime(salary_history: &[f64]) -> f64 {
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

/// Calculates the monthly primary insurance amount from AIME and bend points.
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

/// Returns full retirement age in months for a birth-year cohort.
pub fn get_full_retirement_age_months(birth_year: i32) -> i32 {
    if birth_year <= 1937 {
        65 * 12
    } else if birth_year <= 1942 {
        65 * 12 + (birth_year - 1937) * 2
    } else if birth_year <= 1954 {
        66 * 12
    } else if birth_year <= 1959 {
        66 * 12 + (birth_year - 1954) * 2
    } else {
        67 * 12
    }
}

fn delayed_retirement_credit_per_month(birth_year: i32) -> f64 {
    match birth_year {
        ..=1934 => 11.0 / 2400.0,
        1935..=1936 => 1.0 / 200.0,
        1937..=1938 => 13.0 / 2400.0,
        1939..=1940 => 7.0 / 1200.0,
        1941..=1942 => 1.0 / 160.0,
        _ => 1.0 / 150.0,
    }
}

/// Returns the PIA multiplier for claiming at an integer age from 62 through 70.
pub fn get_claim_age_adjustment(claim_age: u32, birth_year: i32) -> f64 {
    let claim_months = claim_age.clamp(62, 70) as i32 * 12;
    let full_retirement_age_months = get_full_retirement_age_months(birth_year);
    if claim_months < full_retirement_age_months {
        let months_early = full_retirement_age_months - claim_months;
        let first_36_months = months_early.min(36);
        let additional_months = (months_early - 36).max(0);
        return 1.0 - first_36_months as f64 / 180.0 - additional_months as f64 / 240.0;
    }

    let months_delayed = claim_months.min(70 * 12) - full_retirement_age_months;
    1.0 + months_delayed as f64 * delayed_retirement_credit_per_month(birth_year)
}

/// Estimates annual earnings from career start through the year before retirement.
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

        let expected = 1174.0 * 0.90 + (5000.0 - 1174.0) * 0.32;
        assert_eq!(pia, (expected * 10.0_f64).floor() / 10.0);
    }

    #[test]
    fn test_2025_bend_point_spot_values() {
        assert_eq!(calculate_pia(1_226.0, &BEND_POINTS), 1_103.4);
        assert_eq!(calculate_pia(5_000.0, &BEND_POINTS), 2_311.0);
    }

    #[test]
    fn test_claim_age_adjustments() {
        assert!((get_claim_age_adjustment(62, 1960) - 0.70).abs() < 1e-12); // FRA 67: 30% early
        assert_eq!(get_claim_age_adjustment(67, 1960), 1.0);
        assert_eq!(get_claim_age_adjustment(70, 1960), 1.24);

        assert_eq!(get_full_retirement_age_months(1956), 66 * 12 + 4);
        assert!((get_claim_age_adjustment(67, 1956) - 1.0533333333).abs() < 1e-9);
        assert!((get_claim_age_adjustment(62, 1959) - 0.7083333333).abs() < 1e-9);
    }

    #[test]
    fn test_full_benefit_calculation() {
        let salary_history: Vec<f64> = vec![75000.0; 35];
        let result = calculate_ssa_benefit(&salary_history, 67, 1960);

        // At FRA (67), claim adjustment is 1.0, so annual_benefit = PIA * 12.
        let aime = (75000.0_f64 / 12.0).floor();
        let expected_pia = 1226.0 * 0.90 + (aime - 1226.0) * 0.32;
        let expected_annual = (expected_pia * 10.0_f64).floor() / 10.0 * 12.0;
        assert!((result.annual_benefit - expected_annual).abs() < 0.01);
    }

    #[test]
    fn test_estimate_salary_history() {
        let history = estimate_salary_history(100000.0, 0.03, 45, 65);

        assert!(!history.is_empty());

        // Preserve the full estimated record; AIME selects its highest 35 years.
        assert_eq!(history.len(), 43);
        assert!((history[23] - 100000.0).abs() < 0.01); // age 45

        assert!(history.iter().all(|&s| s > 0.0));
    }

    #[test]
    fn estimated_salary_history_anchors_and_grows_from_current_age() {
        let history = estimate_salary_history(100_000.0, 0.02, 40, 42);

        assert_eq!(history.len(), 20);
        assert!((history[18] - 100_000.0).abs() < 1e-6);
        assert!((history[19] - 102_000.0).abs() < 1e-6);
        assert!(history.windows(2).all(|years| years[0] < years[1]));
    }
}
