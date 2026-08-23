//! Required Minimum Distribution calculations shared by native and Wasm builds.

use once_cell::sync::Lazy;
use std::collections::HashMap;

/// SECURE/SECURE 2.0 applicable age by birth cohort.
///
/// The published Uniform Lifetime Table starts at 72, so the pre-2020 age-70½
/// cohort is floored there rather than modeled at 70. Everyone in that cohort is
/// well past both ages, so no reachable plan is affected — and the floor keeps
/// this function from returning an age `calculate_rmd` has no factor for.
pub fn get_rmd_start_age(birth_year: i32) -> u32 {
    match birth_year {
        ..=1950 => 72,
        1951..=1959 => 73,
        _ => 75,
    }
}

/// IRS Uniform Lifetime Table for owners whose spouse is not more than 10 years younger.
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

/// Returns the required distribution from a prior year-end balance, or zero
/// before the applicable starting age.
pub fn calculate_rmd(previous_year_end_balance: f64, age: u32, applicable_age: u32) -> f64 {
    if age < applicable_age {
        return 0.0;
    }

    // Ages past the table's end keep its final factor; ages below its start have
    // no factor at all, and inventing one would distribute a plausible-looking
    // wrong amount instead of failing.
    let distribution_factor = RMD_UNIFORM_LIFETIME_TABLE
        .get(&age.min(120))
        .copied()
        .unwrap_or_else(|| panic!("No RMD distribution factor for age {age}"));

    previous_year_end_balance / distribution_factor
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_zero_before_start_age() {
        assert_eq!(calculate_rmd(100000.0, 72, 73), 0.0);
        assert_eq!(calculate_rmd(100000.0, 50, 73), 0.0);
    }

    #[test]
    fn uses_the_factor_at_start_age() {
        let rmd = calculate_rmd(100000.0, 73, 73);
        let expected = 100000.0 / 26.5;
        assert!((rmd - expected).abs() < 0.01);
    }

    #[test]
    fn uses_uniform_lifetime_factors_at_later_ages() {
        let rmd75 = calculate_rmd(100000.0, 75, 73);
        assert!((rmd75 - 100000.0 / 24.6).abs() < 0.01);

        let rmd80 = calculate_rmd(500000.0, 80, 73);
        assert!((rmd80 - 500000.0 / 20.2).abs() < 0.01);

        let rmd85 = calculate_rmd(100000.0, 85, 73);
        assert!((rmd85 - 100000.0 / 16.0).abs() < 0.01);

        let rmd95 = calculate_rmd(100000.0, 95, 73);
        assert!((rmd95 - 100000.0 / 8.9).abs() < 0.01);
    }

    #[test]
    fn ages_past_the_table_keep_its_final_factor() {
        let rmd = calculate_rmd(100000.0, 121, 73);
        assert_eq!(rmd, 50000.0);
    }

    #[test]
    #[should_panic(expected = "No RMD distribution factor for age 70")]
    fn applicable_age_below_the_table_is_rejected() {
        calculate_rmd(100000.0, 70, 70);
    }

    #[test]
    fn start_age_never_precedes_the_table() {
        for birth_year in [1900, 1948, 1950, 1951, 1959, 1960, 2000] {
            let start = get_rmd_start_age(birth_year);
            assert!(
                RMD_UNIFORM_LIFETIME_TABLE.contains_key(&start),
                "no factor for applicable age {start} (birth year {birth_year})"
            );
        }
    }

    #[test]
    fn secure_2_cohort_uses_age_75_for_people_born_in_1960_or_later() {
        assert_eq!(get_rmd_start_age(1959), 73);
        assert_eq!(get_rmd_start_age(1960), 75);
    }
}
