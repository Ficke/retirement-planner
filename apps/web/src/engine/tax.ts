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

/**
 * Income reaching the household from somewhere other than wages — RMDs and
 * portfolio withdrawals. Ordinary is taxed at bracket rates; qualified is the
 * realized-gain share of a taxable withdrawal.
 */
export interface OtherIncome {
  ordinary: number;
  qualified: number;
}

/** Household facts that decide which tax-advantaged space is actually available. */
export interface ContributionPolicy {
  /** HDHP coverage. Without it there is no HSA contribution to deduct. */
  hsaEligible: boolean;
  /** Without a backdoor conversion, a Roth IRA contribution is not modeled. */
  useBackdoorRoth: boolean;
}

export interface WorkingCashFlowResult {
  tax: TaxResult;
  contributions: AnnualContributions;
  totalContributions: number;
  /** Spending above after-tax income. The portfolio covers it; it is not a failure. */
  fundingGap: number;
}

/**
 * Savings is the residual: whatever gross income does not lose to taxes and
 * spending gets invested. Contributions fill statutory limits in the order
 * HSA → Traditional → Roth, and taxable absorbs the remainder — so no cash is
 * ever left over, and none of it disappears.
 */
export function calculateWorkingCashFlow(
  grossIncome: number,
  annualSpending: number,
  age: number,
  filingStatus: FilingStatus,
  state: string,
  policy: ContributionPolicy,
  other: OtherIncome = { ordinary: 0, qualified: 0 },
): WorkingCashFlowResult {
  const hsaMax = policy.hsaEligible ? getHSAContributionLimit(age) : 0;
  const k401Max = getK401ContributionLimit(age);

  let tax = calculateTax(
    grossIncome, other.qualified, age, filingStatus, state, undefined, other.ordinary,
  );
  for (let iteration = 0; iteration < 4; iteration++) {
    const availableBeforeContributions = Math.max(
      0,
      grossIncome + other.ordinary - tax.totalTax - annualSpending,
    );
    const hsa = Math.min(hsaMax, availableBeforeContributions);
    const traditional = Math.min(
      k401Max,
      Math.max(0, availableBeforeContributions - hsa),
    );
    tax = calculateTax(
      grossIncome,
      other.qualified,
      age,
      filingStatus,
      state,
      { hsa, traditional },
      other.ordinary,
    );
  }

  const cashAfterPretaxAndSpending = grossIncome
    + other.ordinary
    - tax.totalTax
    - annualSpending
    - tax.hsaContribution
    - tax.k401Contribution;
  const fundingGap = Math.max(0, -cashAfterPretaxAndSpending);
  const afterTaxBudget = Math.max(0, cashAfterPretaxAndSpending);
  const roth = policy.useBackdoorRoth
    ? Math.min(getIRAContributionLimit(age), afterTaxBudget)
    : 0;
  const taxable = afterTaxBudget - roth;

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
    fundingGap,
  };
}

/**
 * Federal, state, and FICA tax on a working year. Qualified dividends and
 * long-term gains stack on top of ordinary income for rate determination, so
 * they are taxed at the rate ordinary income has already reached.
 *
 * Contribution targets are clamped to statutory limits and to what the income
 * can actually fund, so a caller may pass its own desired amounts.
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
  const hsaMax = getHSAContributionLimit(age);
  const k401Max = getK401ContributionLimit(age);
  const hsaContribution = Math.min(Math.max(0, contributionTargets.hsa), hsaMax, grossIncome);
  const k401Contribution = Math.min(
    Math.max(0, contributionTargets.traditional),
    k401Max,
    Math.max(0, grossIncome - hsaContribution),
  );

  const afterHSAIncome = grossIncome - hsaContribution;
  const afterK401Income = afterHSAIncome - k401Contribution;
  const standardDeduction = getStandardDeduction(
    filingStatus,
    age,
    afterK401Income + otherOrdinaryIncome + qualifiedIncome,
  );

  const federalTaxableIncome = Math.max(
    0,
    afterK401Income + otherOrdinaryIncome - standardDeduction,
  );
  const federalTax = calculateProgressiveTax(federalTaxableIncome, FEDERAL_TAX_BRACKETS_2025[filingStatus]);
  
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
  
  const socialSecurityTax = Math.min(grossIncome, PAYROLL_LIMITS_2025.fica_wage_base) * PAYROLL_LIMITS_2025.social_security_rate;
  const medicareTax = grossIncome * PAYROLL_LIMITS_2025.medicare_rate;
  const additionalMedicareThreshold = getAdditionalMedicareThreshold(filingStatus);
  const additionalMedicareTax = grossIncome > additionalMedicareThreshold
    ? (grossIncome - additionalMedicareThreshold) * PAYROLL_LIMITS_2025.medicare_additional_rate
    : 0;
  const ficaTax = socialSecurityTax + medicareTax + additionalMedicareTax;
  
  const totalTax = federalTax + stateTax + ficaTax;
  const totalIncome = grossIncome + otherOrdinaryIncome;
  
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

/** SECURE 2.0 raises the catch-up between 60 and 63, then drops it back. */
function getK401ContributionLimit(age: number): number {
  if (age >= 60 && age <= 63) {
    return RETIREMENT_LIMITS_2025.k401_base + RETIREMENT_LIMITS_2025.k401_catchup_enhanced;
  } else if (age >= 50) {
    return RETIREMENT_LIMITS_2025.k401_base + RETIREMENT_LIMITS_2025.k401_catchup_standard;
  }
  return RETIREMENT_LIMITS_2025.k401_base;
}

/** Individual coverage only — family HDHP coverage is not modeled. */
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
 * Tax on a retirement year. Wages have stopped, so there is no FICA and no
 * contribution to deduct; Social Security is taxed under its own rules.
 */
export function calculateRetirementTax(
  traditionalWithdrawals: number,
  socialSecurityBenefit: number,
  qualifiedIncome: number,
  age: number,
  filingStatus: FilingStatus,
  state: string = 'CA'
): TaxResult {
  const taxableSS = calculateTaxableSocialSecurity(
    traditionalWithdrawals, 
    socialSecurityBenefit, 
    qualifiedIncome, 
    filingStatus
  );
  
  const totalOrdinaryIncome = traditionalWithdrawals + taxableSS;
  
  const standardDeduction = getStandardDeduction(
    filingStatus,
    age,
    totalOrdinaryIncome + qualifiedIncome,
  );
  const federalTaxableIncome = Math.max(0, totalOrdinaryIncome - standardDeduction);
  const federalTax = calculateProgressiveTax(federalTaxableIncome, FEDERAL_TAX_BRACKETS_2025[filingStatus]);
  
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
  
  let stateTax = 0;
  if (state === 'CA') {
    const caStandardDeduction = CA_STANDARD_DEDUCTIONS_2025[filingStatus];
    // California excludes Social Security benefits and taxes capital gains as ordinary income.
    const caTotalIncome = traditionalWithdrawals + qualifiedIncome;
    const caTaxableIncome = Math.max(0, caTotalIncome - caStandardDeduction);
    stateTax = calculateProgressiveTax(caTaxableIncome, CA_TAX_BRACKETS_2025[filingStatus]);
  }
  
  const ficaTax = 0;
  
  const totalTax = totalFederalTax + stateTax + ficaTax;
  
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
    hsaContribution: 0,
    k401Contribution: 0,
  };
}

/**
 * The taxable portion of Social Security, which the IRS keys off "combined
 * income" — other income plus half the benefit — against two thresholds.
 */
export function calculateTaxableSocialSecurity(
  otherIncome: number,
  socialSecurityBenefit: number,
  qualifiedIncome: number,
  filingStatus: FilingStatus
): number {
  if (socialSecurityBenefit === 0) return 0;
  
  const combinedIncome = otherIncome + qualifiedIncome + (socialSecurityBenefit * 0.5);
  
  const thresholds = {
    Single: { tier1: 25000, tier2: 34000 },
    MarriedFilingJointly: { tier1: 32000, tier2: 44000 },
    MarriedFilingSeparately: { tier1: 0, tier2: 0 }, // Special rules - generally all taxable
    HeadOfHousehold: { tier1: 25000, tier2: 34000 }, // Same as Single
  };
  
  const threshold = thresholds[filingStatus];
  
  if (combinedIncome <= threshold.tier1) {
    return 0;
  } else if (combinedIncome <= threshold.tier2) {
    const excess = combinedIncome - threshold.tier1;
    return Math.min(socialSecurityBenefit * 0.5, excess * 0.5);
  } else {
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
 * Long-term gains get their own preferential brackets, but the bracket is
 * chosen by where the gains land once stacked on top of ordinary income.
 */
function calculateLTCGTax(
  ordinaryTaxableIncome: number,
  ltcgIncome: number,
  filingStatus: FilingStatus
): number {
  if (ltcgIncome <= 0) return 0;
  
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
  
  const stackedIncome = ordinaryTaxableIncome;
  const brackets = ltcgBrackets[filingStatus];
  
  let tax = 0;
  let remainingLTCG = ltcgIncome;
  let currentThreshold = stackedIncome;
  
  for (const bracket of brackets) {
    if (remainingLTCG <= 0) break;
    
    const bracketMax = bracket.max ?? Infinity;
    
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
