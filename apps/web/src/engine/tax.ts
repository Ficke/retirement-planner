import type { AnnualContributions, FilingStatus, TaxBracket } from '@/domain/types';
import { 
  FEDERAL_TAX_BRACKETS_2025, 
  STANDARD_DEDUCTIONS_2025, 
  SENIOR_ADDITIONAL_DEDUCTION_2025,
  CA_TAX_BRACKETS_2025,
  CA_STANDARD_DEDUCTIONS_2025,
  RETIREMENT_LIMITS_2025,
  PAYROLL_LIMITS_2025
} from '@/data/tax-brackets-2025';

export interface TaxResult {
  federalTax: number;
  stateTax: number;
  ficaTax: number;
  totalTax: number;
  effectiveRate: number;
  marginalRate: number;
  taxableIncome: number;
  hsaContribution: number;
  k401Contribution: number;
}

export interface PretaxContributionTargets {
  hsa: number;
  traditional: number;
}

export interface WorkingCashFlowResult {
  tax: TaxResult;
  contributions: AnnualContributions;
  totalContributions: number;
  unallocatedCash: number;
  fundingGap: number;
}

/**
 * Resolve annual contribution targets against taxes, statutory limits, and
 * available cash. The priority is explicit and identical in both engines:
 * HSA → Traditional → Roth → Taxable.
 */
export function calculateWorkingCashFlow(
  grossIncome: number,
  annualSpending: number,
  age: number,
  filingStatus: FilingStatus,
  state: string,
  targets: AnnualContributions,
  otherOrdinaryIncome = 0,
): WorkingCashFlowResult {
  let tax = calculateTax(grossIncome, 0, age, filingStatus, state, undefined, otherOrdinaryIncome);
  for (let iteration = 0; iteration < 4; iteration++) {
    const availableBeforeContributions = Math.max(
      0,
      grossIncome + otherOrdinaryIncome - tax.totalTax - annualSpending,
    );
    const hsa = Math.min(targets.hsa, availableBeforeContributions);
    const traditional = Math.min(
      targets.traditional,
      Math.max(0, availableBeforeContributions - hsa),
    );
    tax = calculateTax(
      grossIncome,
      0,
      age,
      filingStatus,
      state,
      { hsa, traditional },
      otherOrdinaryIncome,
    );
  }

  const cashAfterPretaxAndSpending = grossIncome
    + otherOrdinaryIncome
    - tax.totalTax
    - annualSpending
    - tax.hsaContribution
    - tax.k401Contribution;
  const fundingGap = Math.max(0, -cashAfterPretaxAndSpending);
  let afterTaxBudget = Math.max(0, cashAfterPretaxAndSpending);
  const roth = Math.min(targets.roth, getIRAContributionLimit(age), afterTaxBudget);
  afterTaxBudget -= roth;
  const taxable = Math.min(targets.taxable, afterTaxBudget);
  afterTaxBudget -= taxable;

  const contributions = {
    hsa: tax.hsaContribution,
    traditional: tax.k401Contribution,
    roth,
    taxable,
  };
  return {
    tax,
    contributions,
    totalContributions: Object.values(contributions).reduce((sum, value) => sum + value, 0),
    unallocatedCash: afterTaxBudget,
    fundingGap,
  };
}

/**
 * Calculate federal and state income taxes for explicit pre-tax contributions.
 * Implements LTCG stacking per CLAUDE.md: qualified dividends and LTCG
 * are taxed after ordinary income for rate determination.
 *
 * @param grossIncome - Total salary/wages before any deductions
 * @param qualifiedIncome - Qualified dividends + long-term capital gains
 * @param age - Current age for catch-up contribution eligibility
 * @param filingStatus - Tax filing status
 * @param state - State for tax calculation (currently only CA implemented)
 * @returns Detailed tax breakdown including retirement contributions
 */
export function calculateTax(
  grossIncome: number,
  qualifiedIncome: number,
  age: number,
  filingStatus: FilingStatus,
  state: string = 'CA',
  contributionTargets: PretaxContributionTargets = { hsa: 0, traditional: 0 },
  otherOrdinaryIncome = 0,
): TaxResult {
  // These are user targets, not an inferred optimizer. The projection layer
  // separately reduces them when the household's cash flow cannot fund them.
  const hsaMax = getHSAContributionLimit(age);
  const k401Max = getK401ContributionLimit(age);
  const hsaContribution = Math.min(Math.max(0, contributionTargets.hsa), hsaMax, grossIncome);
  const k401Contribution = Math.min(
    Math.max(0, contributionTargets.traditional),
    k401Max,
    Math.max(0, grossIncome - hsaContribution),
  );

  // Now calculate actual taxes with these contribution amounts
  const afterHSAIncome = grossIncome - hsaContribution;
  const afterK401Income = afterHSAIncome - k401Contribution;
  const standardDeduction = getStandardDeduction(
    filingStatus,
    age,
    afterK401Income + otherOrdinaryIncome + qualifiedIncome,
  );

  // Calculate federal tax using progressive brackets (HSA + 401k both reduce taxable income)
  const federalTaxableIncome = Math.max(
    0,
    afterK401Income + otherOrdinaryIncome - standardDeduction,
  );
  const federalTax = calculateProgressiveTax(federalTaxableIncome, FEDERAL_TAX_BRACKETS_2025[filingStatus]);
  
  // Calculate state tax (CA only for now)
  let stateTax = 0;
  if (state === 'CA') {
    const caStandardDeduction = CA_STANDARD_DEDUCTIONS_2025[filingStatus];
    // California does not conform to the federal HSA deduction.
    const caTaxableIncome = Math.max(
      0,
      grossIncome + otherOrdinaryIncome - k401Contribution - caStandardDeduction,
    );
    stateTax = calculateProgressiveTax(caTaxableIncome, CA_TAX_BRACKETS_2025[filingStatus]);
  }
  
  // Calculate FICA taxes on gross wages (before 401k deduction)
  const socialSecurityTax = Math.min(grossIncome, PAYROLL_LIMITS_2025.fica_wage_base) * PAYROLL_LIMITS_2025.social_security_rate;
  const medicareTax = grossIncome * PAYROLL_LIMITS_2025.medicare_rate;
  const additionalMedicareThreshold = getAdditionalMedicareThreshold(filingStatus);
  const additionalMedicareTax = grossIncome > additionalMedicareThreshold
    ? (grossIncome - additionalMedicareThreshold) * PAYROLL_LIMITS_2025.medicare_additional_rate
    : 0;
  const ficaTax = socialSecurityTax + medicareTax + additionalMedicareTax;
  
  const totalTax = federalTax + stateTax + ficaTax;
  const totalIncome = grossIncome + otherOrdinaryIncome;
  
  // Calculate marginal rates
  const federalMarginalRate = getMarginalTaxRate(federalTaxableIncome, FEDERAL_TAX_BRACKETS_2025[filingStatus]);
  const stateMarginalRate = state === 'CA' ? 
    getMarginalTaxRate(
      Math.max(
        0,
        grossIncome
          + otherOrdinaryIncome
          - k401Contribution
          - CA_STANDARD_DEDUCTIONS_2025[filingStatus],
      ),
      CA_TAX_BRACKETS_2025[filingStatus],
    ) : 0;
  
  return {
    federalTax,
    stateTax,
    ficaTax,
    totalTax,
    effectiveRate: totalIncome > 0 ? totalTax / totalIncome : 0,
    marginalRate: federalMarginalRate + stateMarginalRate,
    taxableIncome: federalTaxableIncome,
    hsaContribution,
    k401Contribution,
  };
}

/**
 * Get 401k contribution limit based on age and SECURE 2.0 rules
 */
function getK401ContributionLimit(age: number): number {
  if (age >= 60 && age <= 63) {
    // Enhanced catch-up for ages 60-63 (SECURE 2.0)
    return RETIREMENT_LIMITS_2025.k401_base + RETIREMENT_LIMITS_2025.k401_catchup_enhanced;
  } else if (age >= 50) {
    // Standard catch-up for 50+
    return RETIREMENT_LIMITS_2025.k401_base + RETIREMENT_LIMITS_2025.k401_catchup_standard;
  }
  return RETIREMENT_LIMITS_2025.k401_base;
}

/**
 * Get HSA contribution limit based on age and coverage type
 * For simplicity, assuming individual coverage. Could be enhanced to include family coverage.
 */
function getHSAContributionLimit(age: number): number {
  const baseLimit = RETIREMENT_LIMITS_2025.hsa_individual;
  const catchupLimit = age >= 55 ? RETIREMENT_LIMITS_2025.hsa_catchup : 0;
  return baseLimit + catchupLimit;
}

function getIRAContributionLimit(age: number): number {
  return age >= 50
    ? RETIREMENT_LIMITS_2025.ira_base + RETIREMENT_LIMITS_2025.ira_catchup
    : RETIREMENT_LIMITS_2025.ira_base;
}

/**
 * Get standard deduction including senior additional amount
 */
function getStandardDeduction(
  filingStatus: FilingStatus,
  age: number,
  modifiedAdjustedGrossIncome: number,
): number {
  let deduction = STANDARD_DEDUCTIONS_2025[filingStatus];
  if (age >= 65) {
    deduction += SENIOR_ADDITIONAL_DEDUCTION_2025[filingStatus];

    // The 2025 enhanced senior deduction is modeled for the primary person in
    // the plan. Married filing separately is not eligible; a second spouse's
    // age is not part of the current household model.
    if (filingStatus !== 'MarriedFilingSeparately') {
      const phaseoutStart = filingStatus === 'MarriedFilingJointly' ? 150_000 : 75_000;
      deduction += Math.max(
        0,
        6_000 - Math.max(0, modifiedAdjustedGrossIncome - phaseoutStart) * 0.06,
      );
    }
  }
  return deduction;
}


/**
 * Get marginal tax rate at specific income level
 */
function getMarginalTaxRate(income: number, brackets: TaxBracket[]): number {
  for (let i = brackets.length - 1; i >= 0; i--) {
    const bracket = brackets[i];
    if (income > bracket.min) {
      return bracket.rate;
    }
  }
  return brackets[0]?.rate || 0;
}

/**
 * Calculate tax on retirement income (no FICA, no retirement contributions).
 * Used specifically for retirement years where income comes from withdrawals and SS.
 * 
 * @param traditionalWithdrawals - Traditional 401k/IRA withdrawals (fully taxable as ordinary income)
 * @param socialSecurityBenefit - Annual SS benefits (special taxation rules apply)
 * @param qualifiedIncome - LTCG and qualified dividends from taxable accounts
 * @param age - Current age for standard deduction calculation
 * @param filingStatus - Tax filing status
 * @param state - State for tax calculation
 * @returns Tax result without FICA or retirement contributions
 */
export function calculateRetirementTax(
  traditionalWithdrawals: number,
  socialSecurityBenefit: number,
  qualifiedIncome: number,
  age: number,
  filingStatus: FilingStatus,
  state: string = 'CA'
): TaxResult {
  // Calculate how much of Social Security is taxable based on combined income
  const taxableSS = calculateTaxableSocialSecurity(
    traditionalWithdrawals, 
    socialSecurityBenefit, 
    qualifiedIncome, 
    filingStatus
  );
  
  // Total ordinary income for tax purposes
  const totalOrdinaryIncome = traditionalWithdrawals + taxableSS;
  
  // Calculate federal tax using progressive brackets (no 401k deductions in retirement)
  const standardDeduction = getStandardDeduction(
    filingStatus,
    age,
    totalOrdinaryIncome + qualifiedIncome,
  );
  const federalTaxableIncome = Math.max(0, totalOrdinaryIncome - standardDeduction);
  const federalTax = calculateProgressiveTax(federalTaxableIncome, FEDERAL_TAX_BRACKETS_2025[filingStatus]);
  
  // Calculate LTCG tax on qualified income (stacked after ordinary income)
  const unusedStandardDeduction = Math.max(0, standardDeduction - totalOrdinaryIncome);
  const taxableQualifiedIncome = Math.max(0, qualifiedIncome - unusedStandardDeduction);
  const ltcgTax = calculateLTCGTax(federalTaxableIncome, taxableQualifiedIncome, filingStatus);
  const netInvestmentIncomeTax = 0.038 * Math.min(
    qualifiedIncome,
    Math.max(
      0,
      totalOrdinaryIncome + qualifiedIncome - getNetInvestmentIncomeThreshold(filingStatus),
    ),
  );
  const totalFederalTax = federalTax + ltcgTax + netInvestmentIncomeTax;
  
  // Calculate state tax (CA only for now)
  let stateTax = 0;
  if (state === 'CA') {
    const caStandardDeduction = CA_STANDARD_DEDUCTIONS_2025[filingStatus];
    // California excludes Social Security benefits and taxes capital gains as ordinary income.
    const caTotalIncome = traditionalWithdrawals + qualifiedIncome;
    const caTaxableIncome = Math.max(0, caTotalIncome - caStandardDeduction);
    stateTax = calculateProgressiveTax(caTaxableIncome, CA_TAX_BRACKETS_2025[filingStatus]);
  }
  
  // No FICA taxes in retirement
  const ficaTax = 0;
  
  const totalTax = totalFederalTax + stateTax + ficaTax;
  
  // Calculate marginal rates based on total ordinary income
  const federalMarginalRate = getMarginalTaxRate(federalTaxableIncome, FEDERAL_TAX_BRACKETS_2025[filingStatus]);
  const stateMarginalRate = state === 'CA' ? 
    getMarginalTaxRate(
      Math.max(0, traditionalWithdrawals + qualifiedIncome - CA_STANDARD_DEDUCTIONS_2025[filingStatus]),
      CA_TAX_BRACKETS_2025[filingStatus],
    ) : 0;
  
  return {
    federalTax: totalFederalTax,
    stateTax,
    ficaTax,
    totalTax,
    effectiveRate: (traditionalWithdrawals + socialSecurityBenefit + qualifiedIncome) > 0 ? 
      totalTax / (traditionalWithdrawals + socialSecurityBenefit + qualifiedIncome) : 0,
    marginalRate: federalMarginalRate + stateMarginalRate,
    taxableIncome: federalTaxableIncome,
    hsaContribution: 0, // No contributions in retirement
    k401Contribution: 0, // No contributions in retirement
  };
}

/**
 * Calculate taxable portion of Social Security benefits.
 * Uses IRS combined income thresholds and taxation percentages.
 * 
 * @param otherIncome - Traditional withdrawals and other ordinary income
 * @param socialSecurityBenefit - Annual SS benefits
 * @param qualifiedIncome - LTCG and qualified dividends
 * @param filingStatus - Filing status for threshold determination
 * @returns Taxable portion of Social Security benefits
 */
export function calculateTaxableSocialSecurity(
  otherIncome: number,
  socialSecurityBenefit: number,
  qualifiedIncome: number,
  filingStatus: FilingStatus
): number {
  if (socialSecurityBenefit === 0) return 0;
  
  // Combined income = AGI + nontaxable interest + 50% of SS benefits
  // For retirement, AGI includes traditional withdrawals + qualified income
  const combinedIncome = otherIncome + qualifiedIncome + (socialSecurityBenefit * 0.5);
  
  // IRS thresholds for SS taxation
  const thresholds = {
    Single: { tier1: 25000, tier2: 34000 },
    MarriedFilingJointly: { tier1: 32000, tier2: 44000 },
    MarriedFilingSeparately: { tier1: 0, tier2: 0 }, // Special rules - generally all taxable
    HeadOfHousehold: { tier1: 25000, tier2: 34000 }, // Same as Single
  };
  
  const threshold = thresholds[filingStatus];
  
  if (combinedIncome <= threshold.tier1) {
    // No SS benefits taxable
    return 0;
  } else if (combinedIncome <= threshold.tier2) {
    // Up to 50% of SS benefits taxable
    const excess = combinedIncome - threshold.tier1;
    return Math.min(socialSecurityBenefit * 0.5, excess * 0.5);
  } else {
    // Up to 85% of SS benefits taxable
    const lowerTierTaxable = Math.min(
      socialSecurityBenefit * 0.5,
      (threshold.tier2 - threshold.tier1) * 0.5,
    );
    return Math.min(
      socialSecurityBenefit * 0.85,
      (combinedIncome - threshold.tier2) * 0.85 + lowerTierTaxable,
    );
  }
}

function getAdditionalMedicareThreshold(filingStatus: FilingStatus): number {
  if (filingStatus === 'MarriedFilingJointly') return 250_000;
  if (filingStatus === 'MarriedFilingSeparately') return 125_000;
  return PAYROLL_LIMITS_2025.medicare_additional_threshold;
}

function getNetInvestmentIncomeThreshold(filingStatus: FilingStatus): number {
  if (filingStatus === 'MarriedFilingJointly') return 250_000;
  if (filingStatus === 'MarriedFilingSeparately') return 125_000;
  return 200_000;
}

/**
 * Calculate Long-Term Capital Gains tax using preferential rates.
 * LTCG rates are based on taxable income level after ordinary income.
 * 
 * @param ordinaryTaxableIncome - Taxable ordinary income (after standard deduction)
 * @param ltcgIncome - Long-term capital gains and qualified dividends
 * @param filingStatus - Filing status for bracket determination
 * @returns LTCG tax owed
 */
function calculateLTCGTax(
  ordinaryTaxableIncome: number,
  ltcgIncome: number,
  filingStatus: FilingStatus
): number {
  if (ltcgIncome <= 0) return 0;
  
  // 2025 LTCG brackets
  const ltcgBrackets = {
    Single: [
      { min: 0, max: 48450, rate: 0.00 },
      { min: 48450, max: 533400, rate: 0.15 },
      { min: 533400, max: null, rate: 0.20 },
    ],
    MarriedFilingJointly: [
      { min: 0, max: 96900, rate: 0.00 },
      { min: 96900, max: 600050, rate: 0.15 },
      { min: 600050, max: null, rate: 0.20 },
    ],
    MarriedFilingSeparately: [
      { min: 0, max: 48450, rate: 0.00 },
      { min: 48450, max: 300025, rate: 0.15 },
      { min: 300025, max: null, rate: 0.20 },
    ],
    HeadOfHousehold: [
      { min: 0, max: 65250, rate: 0.00 },
      { min: 65250, max: 566700, rate: 0.15 },
      { min: 566700, max: null, rate: 0.20 },
    ],
  };
  
  // LTCG income is "stacked" on top of ordinary income for rate determination
  const stackedIncome = ordinaryTaxableIncome;
  const brackets = ltcgBrackets[filingStatus];
  
  let tax = 0;
  let remainingLTCG = ltcgIncome;
  let currentThreshold = stackedIncome;
  
  for (const bracket of brackets) {
    if (remainingLTCG <= 0) break;
    
    const bracketMax = bracket.max ?? Infinity;
    
    // Only apply this bracket if our stacked income reaches this level
    if (currentThreshold < bracketMax) {
      const applicableInThisBracket = Math.min(
        remainingLTCG,
        bracketMax - Math.max(currentThreshold, bracket.min)
      );
      
      if (applicableInThisBracket > 0) {
        tax += applicableInThisBracket * bracket.rate;
        remainingLTCG -= applicableInThisBracket;
        currentThreshold += applicableInThisBracket;
      }
    }
  }
  
  return tax;
}

/**
 * Calculate tax on a specific bracket using progressive rates.
 * 
 * @param income - Taxable income amount
 * @param brackets - Array of tax brackets
 * @returns Total tax owed
 */
export function calculateProgressiveTax(income: number, brackets: TaxBracket[]): number {
  let tax = 0;
  let remainingIncome = income;
  
  for (const bracket of brackets) {
    if (remainingIncome <= 0) break;
    
    const bracketMax = bracket.max ?? Infinity;
    const bracketWidth = bracketMax - bracket.min;
    const taxableInBracket = Math.min(remainingIncome, bracketWidth);
    
    if (taxableInBracket > 0) {
      tax += taxableInBracket * bracket.rate;
      remainingIncome -= taxableInBracket;
    }
  }
  
  return tax;
}
