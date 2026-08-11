/**
 * Social Security Administration benefit calculations.
 * Implements AIME/PIA calculation using bend points and claiming age adjustments.
 * Data sourced from apps/web/src/data/ssa/bend_points.json.
 */

import bendPointsData from '@/data/ssa/bend_points.json';

export interface SSABendPoint {
  threshold: number | null;
  rate: number;
}

export interface SSABenefitResult {
  monthlyBenefit: number;
  annualBenefit: number;
  pia: number;
  aime: number;
  claimAdjustment: number;
}

const BEND_POINTS: SSABendPoint[] = bendPointsData.bendPoints;
const MAX_TAXABLE_WAGE = bendPointsData.maxTaxableWage;

export function calculateSSABenefit(
  salaryHistory: number[],
  claimAge: number,
  birthYear = 1960,
): SSABenefitResult {
  const aime = calculateAIME(salaryHistory);
  const pia = calculatePIA(aime, BEND_POINTS);
  const claimAdjustment = getClaimAgeAdjustment(claimAge, birthYear);

  const monthlyBenefit = pia * claimAdjustment;
  const annualBenefit = monthlyBenefit * 12;

  return {
    monthlyBenefit,
    annualBenefit,
    pia,
    aime,
    claimAdjustment,
  };
}

/**
 * Calculate Average Indexed Monthly Earnings (AIME) from salary history.
 * Uses the highest 35 years of earnings (nominal — wage indexing is not applied).
 * SSA always divides by 420 months; missing years are zero-earning years.
 */
export function calculateAIME(salaryHistory: number[]): number {
  const sortedSalaries = [...salaryHistory].sort((a, b) => b - a);
  const top35Years = sortedSalaries.slice(0, 35);

  const totalEarnings = top35Years.reduce(
    (sum, salary) => sum + Math.min(Math.max(0, salary), MAX_TAXABLE_WAGE),
    0,
  );
  return Math.floor(totalEarnings / 420);
}

export function calculatePIA(aime: number, bendPoints: SSABendPoint[]): number {
  let pia = 0;
  let remainingAime = aime;
  let previousThreshold = 0;

  for (const bendPoint of bendPoints) {
    const currentThreshold = bendPoint.threshold ?? Infinity;
    const bracketWidth = currentThreshold - previousThreshold;
    const applicableAmount = Math.min(remainingAime, bracketWidth);

    if (applicableAmount > 0) {
      pia += applicableAmount * bendPoint.rate;
      remainingAime -= applicableAmount;
    }

    if (remainingAime <= 0) break;
    previousThreshold = currentThreshold;
  }

  return Math.floor(pia * 10) / 10;
}

/**
 * Full retirement age in months, including SSA's phased transition from 65
 * to 67. The plan only stores a birth year and integer claim age, so this is a
 * birthday-month estimate rather than a benefit-start-month calculation.
 */
export function getFullRetirementAgeMonths(birthYear: number): number {
  if (birthYear <= 1937) return 65 * 12;
  if (birthYear <= 1942) return 65 * 12 + (birthYear - 1937) * 2;
  if (birthYear <= 1954) return 66 * 12;
  if (birthYear <= 1959) return 66 * 12 + (birthYear - 1954) * 2;
  return 67 * 12;
}

function delayedRetirementCreditPerMonth(birthYear: number): number {
  if (birthYear <= 1934) return 11 / 2400;
  if (birthYear <= 1936) return 1 / 200;
  if (birthYear <= 1938) return 13 / 2400;
  if (birthYear <= 1940) return 7 / 1200;
  if (birthYear <= 1942) return 1 / 160;
  return 1 / 150;
}

/** Apply SSA's monthly early-claim reductions and delayed credits. */
export function getClaimAgeAdjustment(claimAge: number, birthYear = 1960): number {
  const claimMonths = Math.max(62, Math.min(70, claimAge)) * 12;
  const fullRetirementAgeMonths = getFullRetirementAgeMonths(birthYear);
  if (claimMonths < fullRetirementAgeMonths) {
    const monthsEarly = fullRetirementAgeMonths - claimMonths;
    const first36Months = Math.min(36, monthsEarly);
    const additionalMonths = Math.max(0, monthsEarly - 36);
    return 1 - first36Months / 180 - additionalMonths / 240;
  }

  const monthsDelayed = Math.min(70 * 12, claimMonths) - fullRetirementAgeMonths;
  return 1 + monthsDelayed * delayedRetirementCreditPerMonth(birthYear);
}
