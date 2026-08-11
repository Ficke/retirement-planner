/**
 * 2025 Federal and State Tax Brackets
 * Source: IRS Publication 15 and state tax authorities
 * Updated: Tax year 2025 (filed in 2026)
 */

import type { FilingStatus, TaxBracket } from '@/domain/types';

// 2025 Federal Tax Brackets
export const FEDERAL_TAX_BRACKETS_2025: Record<FilingStatus, TaxBracket[]> = {
  Single: [
    { min: 0, max: 11925, rate: 0.10 },
    { min: 11925, max: 48475, rate: 0.12 },
    { min: 48475, max: 103350, rate: 0.22 },
    { min: 103350, max: 197300, rate: 0.24 },
    { min: 197300, max: 250525, rate: 0.32 },
    { min: 250525, max: 626350, rate: 0.35 },
    { min: 626350, max: null, rate: 0.37 },
  ],
  MarriedFilingJointly: [
    { min: 0, max: 23850, rate: 0.10 },
    { min: 23850, max: 96950, rate: 0.12 },
    { min: 96950, max: 206700, rate: 0.22 },
    { min: 206700, max: 394600, rate: 0.24 },
    { min: 394600, max: 501050, rate: 0.32 },
    { min: 501050, max: 751600, rate: 0.35 },
    { min: 751600, max: null, rate: 0.37 },
  ],
  MarriedFilingSeparately: [
    { min: 0, max: 11925, rate: 0.10 },
    { min: 11925, max: 48475, rate: 0.12 },
    { min: 48475, max: 103350, rate: 0.22 },
    { min: 103350, max: 197300, rate: 0.24 },
    { min: 197300, max: 250525, rate: 0.32 },
    { min: 250525, max: 375800, rate: 0.35 },
    { min: 375800, max: null, rate: 0.37 },
  ],
  HeadOfHousehold: [
    { min: 0, max: 17000, rate: 0.10 },
    { min: 17000, max: 64850, rate: 0.12 },
    { min: 64850, max: 103350, rate: 0.22 },
    { min: 103350, max: 197300, rate: 0.24 },
    { min: 197300, max: 250525, rate: 0.32 },
    { min: 250525, max: 626350, rate: 0.35 },
    { min: 626350, max: null, rate: 0.37 },
  ],
};

// 2025 Standard Deductions
export const STANDARD_DEDUCTIONS_2025: Record<FilingStatus, number> = {
  Single: 15750,
  MarriedFilingJointly: 31500,
  MarriedFilingSeparately: 15750,
  HeadOfHousehold: 23625,
};

// Additional standard deduction for seniors (65+)
export const SENIOR_ADDITIONAL_DEDUCTION_2025: Record<FilingStatus, number> = {
  Single: 2000,
  MarriedFilingJointly: 1600, // Per person, so $3200 if both over 65
  MarriedFilingSeparately: 1600,
  HeadOfHousehold: 2000,
};

// Final 2025 California Tax Rate Schedules (FTB Form 540).
export const CA_TAX_BRACKETS_2025: Record<FilingStatus, TaxBracket[]> = {
  Single: [
    { min: 0, max: 11079, rate: 0.01 },
    { min: 11079, max: 26264, rate: 0.02 },
    { min: 26264, max: 41452, rate: 0.04 },
    { min: 41452, max: 57542, rate: 0.06 },
    { min: 57542, max: 72724, rate: 0.08 },
    { min: 72724, max: 371479, rate: 0.093 },
    { min: 371479, max: 445771, rate: 0.103 },
    { min: 445771, max: 742953, rate: 0.113 },
    { min: 742953, max: 1000000, rate: 0.123 },
    { min: 1000000, max: null, rate: 0.133 }, // Mental Health Services Tax
  ],
  MarriedFilingJointly: [
    { min: 0, max: 22158, rate: 0.01 },
    { min: 22158, max: 52528, rate: 0.02 },
    { min: 52528, max: 82904, rate: 0.04 },
    { min: 82904, max: 115084, rate: 0.06 },
    { min: 115084, max: 145448, rate: 0.08 },
    { min: 145448, max: 742958, rate: 0.093 },
    { min: 742958, max: 891542, rate: 0.103 },
    // The 1% Mental Health Services Tax starts at $1,000,000, inside
    // Schedule Y's 11.3% bracket, so that bracket is split here.
    { min: 891542, max: 1000000, rate: 0.113 },
    { min: 1000000, max: 1485906, rate: 0.123 },
    { min: 1485906, max: null, rate: 0.133 },
  ],
  MarriedFilingSeparately: [
    { min: 0, max: 11079, rate: 0.01 },
    { min: 11079, max: 26264, rate: 0.02 },
    { min: 26264, max: 41452, rate: 0.04 },
    { min: 41452, max: 57542, rate: 0.06 },
    { min: 57542, max: 72724, rate: 0.08 },
    { min: 72724, max: 371479, rate: 0.093 },
    { min: 371479, max: 445771, rate: 0.103 },
    { min: 445771, max: 742953, rate: 0.113 },
    { min: 742953, max: 1000000, rate: 0.123 },
    { min: 1000000, max: null, rate: 0.133 },
  ],
  HeadOfHousehold: [
    { min: 0, max: 22173, rate: 0.01 },
    { min: 22173, max: 52530, rate: 0.02 },
    { min: 52530, max: 67716, rate: 0.04 },
    { min: 67716, max: 83805, rate: 0.06 },
    { min: 83805, max: 98990, rate: 0.08 },
    { min: 98990, max: 505208, rate: 0.093 },
    { min: 505208, max: 606251, rate: 0.103 },
    { min: 606251, max: 1000000, rate: 0.113 },
    { min: 1000000, max: 1010417, rate: 0.123 },
    { min: 1010417, max: null, rate: 0.133 },
  ],
};

// Final 2025 CA standard deductions.
export const CA_STANDARD_DEDUCTIONS_2025: Record<FilingStatus, number> = {
  Single: 5706,
  MarriedFilingJointly: 11412,
  MarriedFilingSeparately: 5706,
  HeadOfHousehold: 11412,
};

// 2025 Retirement Account Contribution Limits
export const RETIREMENT_LIMITS_2025 = {
  // 401(k) / 403(b) / 457(b) plans
  k401_base: 23500,
  k401_catchup_standard: 7500, // Ages 50-59, 64+
  k401_catchup_enhanced: 11250, // Ages 60-63 (SECURE 2.0)
  
  // Traditional and Roth IRA
  ira_base: 7000,
  ira_catchup: 1000, // Age 50+
  
  // SEP-IRA
  sep_ira_limit: 70000,
  
  // SIMPLE IRA
  simple_ira_base: 16500,
  simple_ira_catchup: 3500, // Age 50+
  
  // HSA (High Deductible Health Plan)
  hsa_individual: 4300,
  hsa_family: 8550,
  hsa_catchup: 1000, // Age 55+
} as const;

// 2025 FICA and Payroll Tax Limits
export const PAYROLL_LIMITS_2025 = {
  // Social Security
  fica_wage_base: 176100, // Maximum wages subject to Social Security tax
  social_security_rate: 0.062, // Employee portion
  social_security_rate_total: 0.124, // Employee + Employer
  
  // Medicare
  medicare_rate: 0.0145, // Employee portion
  medicare_rate_total: 0.029, // Employee + Employer
  medicare_additional_threshold: 200000, // Additional 0.9% on wages over this amount
  medicare_additional_rate: 0.009,
  
  // Combined FICA rate (before additional Medicare)
  fica_combined_rate: 0.0765, // 6.2% + 1.45%
} as const;

// Roth IRA Income Limits for 2025 (phase-out ranges)
export const ROTH_IRA_INCOME_LIMITS_2025: Record<FilingStatus, { phaseout_start: number; phaseout_end: number }> = {
  Single: { phaseout_start: 146000, phaseout_end: 161000 },
  MarriedFilingJointly: { phaseout_start: 230000, phaseout_end: 240000 },
  MarriedFilingSeparately: { phaseout_start: 0, phaseout_end: 10000 },
  HeadOfHousehold: { phaseout_start: 146000, phaseout_end: 161000 },
};
