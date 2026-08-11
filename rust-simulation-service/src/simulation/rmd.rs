use once_cell::sync::Lazy;
/// Required Minimum Distribution (RMD) calculations
/// Ports TypeScript rmd.ts logic to Rust
use std::collections::HashMap;

/// SECURE/SECURE 2.0 applicable age by birth cohort.
/// The annual model represents the pre-2020 age-70½ cohort as age 70.
pub fn get_rmd_start_age(birth_year: i32) -> u32 {
    match birth_year {
        ..=1948 => 70,
        1949..=1950 => 72,
        1951..=1959 => 73,
        _ => 75,
    }
}

/// IRS Uniform Lifetime Table (for account owners with spouses not more than 10 years younger)
static RMD_UNIFORM_LIFETIME_TABLE: Lazy<HashMap<u32, f64>> = Lazy::new(|| {
    let mut m = HashMap::new();
    m.insert(72, 27.4);
    m.insert(73, 26.5);
    m.insert(74, 25.5);
    m.insert(75, 24.6);
    m.insert(76, 23.7);
    m.insert(77, 22.9);
    m.insert(78, 22.0);
    m.insert(79, 21.1);
    m.insert(80, 20.2);
    m.insert(81, 19.4);
    m.insert(82, 18.5);
    m.insert(83, 17.7);
    m.insert(84, 16.8);
    m.insert(85, 16.0);
    m.insert(86, 15.2);
    m.insert(87, 14.4);
    m.insert(88, 13.7);
    m.insert(89, 12.9);
    m.insert(90, 12.2);
    m.insert(91, 11.5);
    m.insert(92, 10.8);
    m.insert(93, 10.1);
    m.insert(94, 9.5);
    m.insert(95, 8.9);
    m.insert(96, 8.4);
    m.insert(97, 7.8);
    m.insert(98, 7.3);
    m.insert(99, 6.8);
    m.insert(100, 6.4);
    m.insert(101, 6.0);
    m.insert(102, 5.6);
    m.insert(103, 5.2);
    m.insert(104, 4.9);
    m.insert(105, 4.6);
    m.insert(106, 4.3);
    m.insert(107, 4.1);
    m.insert(108, 3.9);
    m.insert(109, 3.7);
    m.insert(110, 3.5);
    m.insert(111, 3.4);
    m.insert(112, 3.3);
    m.insert(113, 3.1);
    m.insert(114, 3.0);
    m.insert(115, 2.9);
    m.insert(116, 2.8);
    m.insert(117, 2.7);
    m.insert(118, 2.5);
    m.insert(119, 2.3);
    m.insert(120, 2.0);
    m
});

/// Calculate Required Minimum Distribution for a given account balance and age
///
/// @param previous_year_end_balance - Account balance at end of previous year
/// @param age - Current age of account owner
/// @returns Required minimum distribution amount (0 if under RMD age)
pub fn calculate_rmd(previous_year_end_balance: f64, age: u32, applicable_age: u32) -> f64 {
    if age < applicable_age {
        return 0.0;
    }

    let distribution_factor = RMD_UNIFORM_LIFETIME_TABLE
        .get(&age.min(120))
        .copied()
        .unwrap_or(2.0); // Fallback for ages beyond table

    previous_year_end_balance / distribution_factor
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rmd_before_start_age() {
        assert_eq!(calculate_rmd(100000.0, 72, 73), 0.0);
        assert_eq!(calculate_rmd(100000.0, 50, 73), 0.0);
    }

    #[test]
    fn test_rmd_at_start_age() {
        // At age 73, distribution factor is 26.5
        let rmd = calculate_rmd(100000.0, 73, 73);
        let expected = 100000.0 / 26.5;
        assert!((rmd - expected).abs() < 0.01);
    }

    #[test]
    fn test_rmd_at_various_ages() {
        // Age 75: factor 24.6
        let rmd75 = calculate_rmd(100000.0, 75, 73);
        assert!((rmd75 - 100000.0 / 24.6).abs() < 0.01);

        // Age 85: factor 16.0
        let rmd85 = calculate_rmd(100000.0, 85, 73);
        assert!((rmd85 - 100000.0 / 16.0).abs() < 0.01);

        // Age 95: factor 8.9
        let rmd95 = calculate_rmd(100000.0, 95, 73);
        assert!((rmd95 - 100000.0 / 8.9).abs() < 0.01);
    }

    #[test]
    fn test_rmd_beyond_table() {
        // Age 121 should use fallback factor of 2.0
        let rmd = calculate_rmd(100000.0, 121, 73);
        assert_eq!(rmd, 50000.0);
    }

    #[test]
    fn secure_2_cohort_uses_age_75_for_people_born_in_1960_or_later() {
        assert_eq!(get_rmd_start_age(1959), 73);
        assert_eq!(get_rmd_start_age(1960), 75);
    }
}
