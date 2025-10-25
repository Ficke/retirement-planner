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
  Single: 15000,
  MarriedFilingJointly: 30000,
  MarriedFilingSeparately: 15000,
  HeadOfHousehold: 22500,
};

// Additional standard deduction for seniors (65+)
export const SENIOR_ADDITIONAL_DEDUCTION_2025: Record<FilingStatus, number> = {
  Single: 2000,
  MarriedFilingJointly: 1600, // Per person, so $3200 if both over 65
  MarriedFilingSeparately: 1600,
  HeadOfHousehold: 2000,
};

// 2025 California Tax Brackets (approximate - CA hasn't released final 2025 yet)
export const CA_TAX_BRACKETS_2025: Record<FilingStatus, TaxBracket[]> = {
  Single: [
    { min: 0, max: 10099, rate: 0.01 },
    { min: 10099, max: 23942, rate: 0.02 },
    { min: 23942, max: 37788, rate: 0.04 },
    { min: 37788, max: 52455, rate: 0.06 },
    { min: 52455, max: 66295, rate: 0.08 },
    { min: 66295, max: 338639, rate: 0.093 },
    { min: 338639, max: 406364, rate: 0.103 },
    { min: 406364, max: 677278, rate: 0.113 },
    { min: 677278, max: 1000000, rate: 0.123 },
    { min: 1000000, max: null, rate: 0.133 }, // Mental Health Services Tax
  ],
  MarriedFilingJointly: [
    { min: 0, max: 20198, rate: 0.01 },
    { min: 20198, max: 47884, rate: 0.02 },
    { min: 47884, max: 75576, rate: 0.04 },
    { min: 75576, max: 104910, rate: 0.06 },
    { min: 104910, max: 132590, rate: 0.08 },
    { min: 132590, max: 677278, rate: 0.093 },
    { min: 677278, max: 812728, rate: 0.103 },
    { min: 812728, max: 1354556, rate: 0.113 },
    { min: 1354556, max: 1000000, rate: 0.123 },
    { min: 1000000, max: null, rate: 0.133 }, // Mental Health Services Tax
  ],
  MarriedFilingSeparately: [
    { min: 0, max: 10099, rate: 0.01 },
    { min: 10099, max: 23942, rate: 0.02 },
    { min: 23942, max: 37788, rate: 0.04 },
    { min: 37788, max: 52455, rate: 0.06 },
    { min: 52455, max: 66295, rate: 0.08 },
    { min: 66295, max: 338639, rate: 0.093 },
    { min: 338639, max: 406364, rate: 0.103 },
    { min: 406364, max: 677278, rate: 0.113 },
    { min: 677278, max: 1000000, rate: 0.123 },
    { min: 1000000, max: null, rate: 0.133 },
  ],
  HeadOfHousehold: [
    { min: 0, max: 20198, rate: 0.01 },
    { min: 20198, max: 47884, rate: 0.02 },
    { min: 47884, max: 61917, rate: 0.04 },
    { min: 61917, max: 76138, rate: 0.06 },
    { min: 76138, max: 90302, rate: 0.08 },
    { min: 90302, max: 460547, rate: 0.093 },
    { min: 460547, max: 552658, rate: 0.103 },
    { min: 552658, max: 921095, rate: 0.113 },
    { min: 921095, max: 1000000, rate: 0.123 },
    { min: 1000000, max: null, rate: 0.133 },
  ],
};

// CA Standard Deductions (2024, used as base for 2025)
export const CA_STANDARD_DEDUCTIONS_2025: Record<FilingStatus, number> = {
  Single: 5540,
  MarriedFilingJointly: 11080,
  MarriedFilingSeparately: 5540,
  HeadOfHousehold: 11080,
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