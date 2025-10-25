/**
 * Social Security Administration benefit calculations.
 * Implements AIME/PIA calculation using bend points and claiming age adjustments.
 */

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

/**
 * Estimate Social Security benefits based on salary history and claim age.
 * Uses bend points from SSA data to calculate Primary Insurance Amount (PIA).
 * 
 * @param salaryHistory - Array of annual salaries (ideally 35 years)
 * @param claimAge - Age when benefits are claimed (62-70)
 * @returns Detailed benefit calculation
 */
export function calculateSSABenefit(
  salaryHistory: number[],
  claimAge: number
): SSABenefitResult {
  // TODO: Load actual bend points from JSON data
  // For now, use 2025 estimated bend points
  const bendPoints: SSABendPoint[] = [
    { threshold: 1174, rate: 0.90 },
    { threshold: 7078, rate: 0.32 },
    { threshold: null, rate: 0.15 },
  ];
  
  const aime = calculateAIME(salaryHistory);
  const pia = calculatePIA(aime, bendPoints);
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
 * Uses the highest 35 years of indexed earnings.
 * 
 * @param salaryHistory - Array of annual salaries
 * @returns Monthly average of top 35 indexed years
 */
export function calculateAIME(salaryHistory: number[]): number {
  // TODO: Implement proper wage indexing using SSA historical data
  // For now, use nominal values and top years available
  const sortedSalaries = [...salaryHistory].sort((a, b) => b - a);
  const top35Years = sortedSalaries.slice(0, Math.min(35, sortedSalaries.length));
  
  const totalEarnings = top35Years.reduce((sum, salary) => sum + salary, 0);
  const monthsOfEarnings = top35Years.length * 12;
  
  return monthsOfEarnings > 0 ? totalEarnings / monthsOfEarnings : 0;
}

/**
 * Calculate Primary Insurance Amount (PIA) using bend points.
 * 
 * @param aime - Average Indexed Monthly Earnings
 * @param bendPoints - SSA bend points for the calculation year
 * @returns Primary Insurance Amount (monthly)
 */
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
  
  return pia;
}

/**
 * Get claiming age adjustment factor.
 * Early claiming reduces benefits; delayed claiming increases them.
 * 
 * @param claimAge - Age when benefits are claimed (62-70)
 * @returns Adjustment factor to apply to PIA
 */
export function getClaimAgeAdjustment(claimAge: number): number {
  // TODO: Load from bend_points.json
  const adjustments: Record<number, number> = {
    62: 0.75,
    63: 0.80,
    64: 0.8667,
    65: 0.9333,
    66: 0.9667,
    67: 1.0, // Full retirement age
    68: 1.08,
    69: 1.16,
    70: 1.24,
  };
  
  return adjustments[claimAge] ?? 1.0;
}