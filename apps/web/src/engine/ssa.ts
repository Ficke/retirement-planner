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
const CLAIM_AGE_ADJUSTMENTS = bendPointsData.claimAgeAdjustments as Record<string, number | string>;
const MAX_TAXABLE_WAGE = bendPointsData.maxTaxableWage;

export function calculateSSABenefit(
  salaryHistory: number[],
  claimAge: number
): SSABenefitResult {
  const aime = calculateAIME(salaryHistory);
  const pia = calculatePIA(aime, BEND_POINTS);
  const claimAdjustment = getClaimAgeAdjustment(claimAge);

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
 * Reduction/credit factor for claim age (FRA = 67, birth year 1960+).
 */
export function getClaimAgeAdjustment(claimAge: number): number {
  const raw = CLAIM_AGE_ADJUSTMENTS[String(claimAge)];
  return typeof raw === 'number' ? raw : 1.0;
}
