/**
 * Required Minimum Distribution (RMD) calculations
 * Pure calculation logic for IRS-mandated retirement account withdrawals
 */

import { RMD_UNIFORM_LIFETIME_TABLE } from '@/data/rmd-tables';

/**
 * Calculate Required Minimum Distribution for a given account balance and age
 * @param previousYearEndBalance - Account balance at end of previous year
 * @param age - Current age of account owner
 * @returns Required minimum distribution amount (0 if under RMD age)
 */
export function calculateRmd(
  previousYearEndBalance: number,
  age: number,
  applicableAge = 73,
): number {
  if (age < applicableAge) {
    return 0;
  }

  // Ages past the table's end keep its final factor; ages below its start have
  // no factor at all, and inventing one would distribute a plausible-looking
  // wrong amount instead of failing.
  const distributionFactor = RMD_UNIFORM_LIFETIME_TABLE[Math.min(age, 120)];
  if (!distributionFactor) {
    throw new RangeError(`No RMD distribution factor for age ${age}`);
  }

  return previousYearEndBalance / distributionFactor;
}
