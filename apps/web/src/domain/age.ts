/**
 * Age derivation. The plan stores a birth date and nothing else, so every
 * consumer computes age the same way and no stored field can contradict
 * another. Mirrored by `age_on` / `birth_year_of` in the Rust engine.
 */

/** Completed years of life at the as-of date. */
export function ageOn(birthDate: string, asOfDate: string): number {
  const [birthYear, birthMonth, birthDay] = birthDate.split('-').map(Number);
  const [asOfYear, asOfMonth, asOfDay] = asOfDate.split('-').map(Number);
  const hadBirthday =
    asOfMonth > birthMonth || (asOfMonth === birthMonth && asOfDay >= birthDay);
  return asOfYear - birthYear - (hadBirthday ? 0 : 1);
}

/** Calendar birth year, which is what RMD and Social Security cohorts key on. */
export function birthYearOf(birthDate: string): number {
  return Number(birthDate.slice(0, 4));
}

/** The birth date reproducing a legacy plan's stored age, so results don't shift. */
export function birthDateFromLegacyAge(
  age: number,
  birthYear: number | undefined,
  asOfDate: string,
): string {
  const asOfYear = Number(asOfDate.slice(0, 4));
  const year = birthYear ?? asOfYear - age;
  // A stored age one below the calendar difference means the birthday has not
  // happened yet at the as-of date; Dec 31 reproduces that, Jan 1 the other case.
  return asOfYear - year === age ? `${year}-01-01` : `${year}-12-31`;
}

/**
 * The first modeled retirement year's spending, in real dollars.
 *
 * The multiplier applies to spending as it stands at retirement, not as it
 * stands today, so this exponent has to match the one the working branch of
 * the projection compounds `currentSpending` by.
 */
export function retirementSpendingOf(profile: {
  currentSpending: number;
  retirementSpendingMultiplier: number;
  workingSpendingGrowthRate: number;
  retirementAge: number;
  birthDate: string;
  asOfDate: string;
}): number {
  const workingYears = Math.max(
    0,
    profile.retirementAge - ageOn(profile.birthDate, profile.asOfDate),
  );
  const spendingAtRetirement = profile.currentSpending
    * Math.pow(1 + profile.workingSpendingGrowthRate, workingYears);
  return spendingAtRetirement * profile.retirementSpendingMultiplier;
}
