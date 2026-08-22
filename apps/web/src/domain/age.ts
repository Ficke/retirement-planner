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

/** Fraction of the as-of calendar year modeled, including the as-of date. */
export function remainingYearFractionOf(asOfDate: string): number {
  const [year, month, day] = asOfDate.split('-').map(Number);
  const daysInYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
  const dayOfYear = Math.floor(
    (Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / (1000 * 60 * 60 * 24),
  ) + 1;
  return Math.max(0, Math.min(1, (daysInYear - dayOfYear + 1) / daysInYear));
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
 * The multiplier is a share of the last working year's spending, not of
 * today's, so the exponent is one short of the working years: it lands on the
 * final year the working branch of the projection compounds, not on the year
 * after it. A household keeping 100% of its spending then sees no step at
 * retirement, whatever its working drift.
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
  const finalWorkingSpending = profile.currentSpending
    * Math.pow(1 + profile.workingSpendingGrowthRate, Math.max(0, workingYears - 1));
  return finalWorkingSpending * profile.retirementSpendingMultiplier;
}
