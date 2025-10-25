/**
 * Required Minimum Distribution (RMD) calculations
 * Pure calculation logic for IRS-mandated retirement account withdrawals
 */

import { RMD_UNIFORM_LIFETIME_TABLE, RMD_START_AGE } from '@/data/rmd-tables';

/**
 * Calculate Required Minimum Distribution for a given account balance and age
 * @param previousYearEndBalance - Account balance at end of previous year
 * @param age - Current age of account owner
 * @returns Required minimum distribution amount (0 if under RMD age)
 */
export function calculateRmd(previousYearEndBalance: number, age: number): number {
  if (age < RMD_START_AGE) {
    return 0;
  }

  const distributionFactor = RMD_UNIFORM_LIFETIME_TABLE[Math.min(age, 120)];
  if (!distributionFactor) {
    // Fallback for ages beyond table
    return previousYearEndBalance / 2.0;
  }

  return previousYearEndBalance / distributionFactor;
}