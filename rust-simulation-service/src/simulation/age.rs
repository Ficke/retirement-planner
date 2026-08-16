//! Age derivation. The plan carries a birth date and nothing else, so every
//! consumer computes age the same way and no field can contradict another.
//! Mirrors `ageOn` / `birthYearOf` in apps/web/src/domain/age.ts.

use anyhow::{anyhow, Result};
use chrono::{Datelike, NaiveDate};

fn parse(date: &str) -> Result<NaiveDate> {
    NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|_| anyhow!("date must use YYYY-MM-DD"))
}

/// Completed years of life at the as-of date.
pub fn age_on(birth_date: &str, as_of_date: &str) -> Result<u32> {
    let birth = parse(birth_date)?;
    let as_of = parse(as_of_date)?;
    let had_birthday = (as_of.month(), as_of.day()) >= (birth.month(), birth.day());
    let years = as_of.year() - birth.year() - if had_birthday { 0 } else { 1 };
    u32::try_from(years).map_err(|_| anyhow!("birthDate must be on or before asOfDate"))
}

/// Calendar birth year, which is what RMD and Social Security cohorts key on.
pub fn birth_year_of(birth_date: &str) -> Result<i32> {
    Ok(parse(birth_date)?.year())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_only_completed_years() {
        assert_eq!(age_on("1986-08-20", "2026-08-15").unwrap(), 39);
        assert_eq!(age_on("1986-08-15", "2026-08-15").unwrap(), 40);
        assert_eq!(age_on("1986-01-01", "2026-08-15").unwrap(), 40);
    }

    #[test]
    fn cohort_uses_the_calendar_year() {
        assert_eq!(birth_year_of("1959-12-31").unwrap(), 1959);
    }
}
