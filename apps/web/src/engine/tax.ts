import type { AnnualContributions, FilingStatus, State, TaxBracket } from '@/domain/types';
import {
  FEDERAL_TAX_BRACKETS_2025,
  STANDARD_DEDUCTIONS_2025,
  SENIOR_ADDITIONAL_DEDUCTION_2025,
  RETIREMENT_LIMITS_2025,
  PAYROLL_LIMITS_2025,
  TAX_LAW_YEAR,
  OBBBA_SENIOR_DEDUCTION,
} from '@/data/tax-brackets-2025';
import { stateTaxProfileOf, type StateTaxProfile } from '@/data/state-tax';
import { US_INFLATION } from '@/data/market-history';

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

/**
 * The people a plan models. Ages drive per-person deductions and Medicare
 * timing; filing status is a separate fact, because a married couple with one
 * earner is still filing jointly.
 */
export interface Household {
  filingStatus: FilingStatus;
  /** One age, or two when the plan models a spouse. */
  ages: number[];
}

export function householdOf(filingStatus: FilingStatus, ...ages: number[]): Household {
  return { filingStatus, ages };
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
  /**
   * Cash left once taxes, spending, and pretax contributions are paid.
   * Negative means the portfolio has to cover the difference; that is a
   * drawdown, not a failure.
   */
  netCashFlow: number;
}

interface PretaxContributionTargets {
  hsa: number;
  traditional: number;
}

/**
 * A threshold Congress wrote in nominal dollars and never indexed, expressed in
 * the real dollars the engines work in. Regular brackets and the standard
 * deduction are inflation-indexed, so they stay fixed in real terms; these do
 * the opposite and shrink every year. The Social Security pair has been frozen
 * since 1984 and is what makes an ever-larger share of every benefit taxable.
 */
function frozenThreshold(nominal2025: number, taxYear: number): number {
  const years = taxYear - TAX_LAW_YEAR;
  if (years <= 0) return nominal2025;
  return nominal2025 / Math.pow(1 + US_INFLATION.mean, years);
}

/**
 * The standard deduction the household actually gets. The additional senior
 * amount and the OBBBA enhanced deduction are both per qualifying individual,
 * so a couple where both are 65 or older receives two of each.
 */
export function deductionFor(
  household: Household,
  taxYear: number,
  modifiedAdjustedGrossIncome: number,
): number {
  const { filingStatus, ages } = household;
  const seniors = ages.filter((age) => age >= 65).length;
  let deduction = STANDARD_DEDUCTIONS_2025[filingStatus];
  if (seniors === 0) return deduction;

  deduction += seniors * SENIOR_ADDITIONAL_DEDUCTION_2025[filingStatus];

  // Married filing separately is not eligible, and the enhanced deduction is
  // scheduled to lapse after 2028. Its phaseout applies to the household total
  // rather than to each person's share.
  if (filingStatus === 'MarriedFilingSeparately') return deduction;
  if (taxYear > OBBBA_SENIOR_DEDUCTION.lastYear) return deduction;

  const phaseoutStart = filingStatus === 'MarriedFilingJointly'
    ? OBBBA_SENIOR_DEDUCTION.phaseoutStartJoint
    : OBBBA_SENIOR_DEDUCTION.phaseoutStartOther;
  const reduction = Math.max(0, modifiedAdjustedGrossIncome - phaseoutStart)
    * OBBBA_SENIOR_DEDUCTION.phaseoutRate;
  return deduction + Math.max(0, seniors * OBBBA_SENIOR_DEDUCTION.perPerson - reduction);
}

interface FederalTaxInput {
  ordinary: number;
  qualified: number;
  deduction: number;
  filingStatus: FilingStatus;
  taxYear: number;
}

/**
 * Federal income tax on one year, whether or not wages are still coming in.
 *
 * Qualified dividends and long-term gains stack on top of ordinary income for
 * rate determination, and any standard deduction ordinary income did not use is
 * applied to them first. Working and retirement years differ only in what they
 * put into `ordinary` — which is why they share this and not two copies of it.
 */
export function federalTaxOn(input: FederalTaxInput): {
  tax: number;
  taxableIncome: number;
  marginalRate: number;
} {
  const { ordinary, qualified, deduction, filingStatus, taxYear } = input;
  const brackets = FEDERAL_TAX_BRACKETS_2025[filingStatus];

  const taxableIncome = Math.max(0, ordinary - deduction);
  const ordinaryTax = calculateProgressiveTax(taxableIncome, brackets);

  const unusedDeduction = Math.max(0, deduction - ordinary);
  const taxableQualified = Math.max(0, qualified - unusedDeduction);
  const ltcgTax = calculateLTCGTax(taxableIncome, taxableQualified, filingStatus);

  const netInvestmentIncomeTax = 0.038 * Math.min(
    Math.max(0, qualified),
    Math.max(
      0,
      ordinary + qualified - frozenThreshold(
        getNetInvestmentIncomeThreshold(filingStatus),
        taxYear,
      ),
    ),
  );

  return {
    tax: ordinaryTax + ltcgTax + netInvestmentIncomeTax,
    taxableIncome,
    marginalRate: getMarginalTaxRate(taxableIncome, brackets),
  };
}

export interface StateTaxInput {
  wages: number;
  otherOrdinary: number;
  qualified: number;
  socialSecurity: number;
  pretax: { hsa: number; traditional: number };
  filingStatus: FilingStatus;
}

/**
 * State income tax from the state's own profile. A state with no income tax and
 * a state nobody has modeled yet both produce zero here; the difference between
 * them lives in `status`, which the UI reads so it can say which one it is.
 */
export function stateTaxOf(
  profile: StateTaxProfile,
  input: StateTaxInput,
): { tax: number; marginalRate: number } {
  const { brackets, standardDeduction } = profile;
  if (!brackets || !standardDeduction) return { tax: 0, marginalRate: 0 };

  const deductiblePretax = profile.conformsToFederalHSA
    ? input.pretax.hsa + input.pretax.traditional
    : input.pretax.traditional;
  const socialSecurity = profile.socialSecurity === 'exempt' ? 0 : input.socialSecurity;

  const taxableIncome = Math.max(
    0,
    input.wages
      + input.otherOrdinary
      + input.qualified
      + socialSecurity
      - deductiblePretax
      - standardDeduction[input.filingStatus],
  );

  return {
    tax: calculateProgressiveTax(taxableIncome, brackets[input.filingStatus]),
    marginalRate: getMarginalTaxRate(taxableIncome, brackets[input.filingStatus]),
  };
}

/** Payroll tax, which only wages attract — RMDs and withdrawals do not. */
function ficaOn(wages: number, filingStatus: FilingStatus, taxYear: number): number {
  const socialSecurityTax = Math.min(wages, PAYROLL_LIMITS_2025.fica_wage_base)
    * PAYROLL_LIMITS_2025.social_security_rate;
  const medicareTax = wages * PAYROLL_LIMITS_2025.medicare_rate;
  const additionalThreshold = frozenThreshold(
    getAdditionalMedicareThreshold(filingStatus),
    taxYear,
  );
  const additionalMedicareTax = wages > additionalThreshold
    ? (wages - additionalThreshold) * PAYROLL_LIMITS_2025.medicare_additional_rate
    : 0;
  return socialSecurityTax + medicareTax + additionalMedicareTax;
}

export interface WorkingTaxInput {
  grossIncome: number;
  qualifiedIncome: number;
  household: Household;
  state: State;
  taxYear: number;
  contributionTargets?: PretaxContributionTargets;
  otherOrdinaryIncome?: number;
}

/**
 * Federal, state, and FICA tax on a working year. Contribution targets are
 * clamped to statutory limits and to what the income can actually fund, so a
 * caller may pass its own desired amounts.
 */
export function calculateTax(input: WorkingTaxInput): TaxResult {
  const {
    grossIncome,
    qualifiedIncome,
    household,
    state,
    taxYear,
    contributionTargets = { hsa: 0, traditional: 0 },
    otherOrdinaryIncome = 0,
  } = input;
  const { filingStatus } = household;
  const primaryAge = household.ages[0] ?? 0;

  const hsaContribution = Math.min(
    Math.max(0, contributionTargets.hsa),
    getHSAContributionLimit(primaryAge),
    grossIncome,
  );
  const k401Contribution = Math.min(
    Math.max(0, contributionTargets.traditional),
    getK401ContributionLimit(primaryAge),
    Math.max(0, grossIncome - hsaContribution),
  );

  const afterPretaxWages = grossIncome - hsaContribution - k401Contribution;
  const ordinary = afterPretaxWages + otherOrdinaryIncome;
  const deduction = deductionFor(household, taxYear, ordinary + qualifiedIncome);

  const federal = federalTaxOn({
    ordinary,
    qualified: qualifiedIncome,
    deduction,
    filingStatus,
    taxYear,
  });

  const stateProfile = stateTaxProfileOf(state);
  const stateResult = stateTaxOf(stateProfile, {
    wages: grossIncome,
    otherOrdinary: otherOrdinaryIncome,
    qualified: qualifiedIncome,
    socialSecurity: 0,
    pretax: { hsa: hsaContribution, traditional: k401Contribution },
    filingStatus,
  });

  const ficaTax = ficaOn(grossIncome, filingStatus, taxYear);
  const totalTax = federal.tax + stateResult.tax + ficaTax;
  const totalIncome = grossIncome + otherOrdinaryIncome + qualifiedIncome;

  return {
    federalTax: federal.tax,
    stateTax: stateResult.tax,
    ficaTax,
    totalTax,
    effectiveRate: totalIncome > 0 ? totalTax / totalIncome : 0,
    marginalRate: federal.marginalRate + stateResult.marginalRate,
    taxableIncome: federal.taxableIncome,
    hsaContribution,
    k401Contribution,
  };
}

export interface WorkingCashFlowInput {
  grossIncome: number;
  annualSpending: number;
  household: Household;
  state: State;
  taxYear: number;
  policy: ContributionPolicy;
  other?: OtherIncome;
}

/**
 * Savings is the residual: whatever gross income does not lose to taxes and
 * spending gets invested. Contributions fill statutory limits in the order
 * HSA → Traditional → Roth, and taxable absorbs the remainder — so no cash is
 * ever left over, and none of it disappears.
 */
export function calculateWorkingCashFlow(
  input: WorkingCashFlowInput,
): WorkingCashFlowResult {
  const {
    grossIncome,
    annualSpending,
    household,
    state,
    taxYear,
    policy,
    other = { ordinary: 0, qualified: 0 },
  } = input;
  const primaryAge = household.ages[0] ?? 0;
  const hsaMax = policy.hsaEligible ? getHSAContributionLimit(primaryAge) : 0;
  const k401Max = getK401ContributionLimit(primaryAge);

  const taxWith = (contributionTargets?: PretaxContributionTargets) => calculateTax({
    grossIncome,
    qualifiedIncome: other.qualified,
    household,
    state,
    taxYear,
    contributionTargets,
    otherOrdinaryIncome: other.ordinary,
  });

  let tax = taxWith();
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
    tax = taxWith({ hsa, traditional });
  }

  const cashAfterPretaxAndSpending = grossIncome
    + other.ordinary
    - tax.totalTax
    - annualSpending
    - tax.hsaContribution
    - tax.k401Contribution;
  const afterTaxBudget = Math.max(0, cashAfterPretaxAndSpending);
  const roth = policy.useBackdoorRoth
    ? Math.min(getIRAContributionLimit(primaryAge), afterTaxBudget)
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
    netCashFlow: cashAfterPretaxAndSpending,
  };
}

export interface RetirementTaxInput {
  traditionalWithdrawals: number;
  socialSecurityBenefit: number;
  qualifiedIncome: number;
  household: Household;
  state: State;
  taxYear: number;
}

/**
 * Tax on a retirement year. Wages have stopped, so there is no FICA and no
 * contribution to deduct; Social Security is taxed under its own rules.
 */
export function calculateRetirementTax(input: RetirementTaxInput): TaxResult {
  const {
    traditionalWithdrawals,
    socialSecurityBenefit,
    qualifiedIncome,
    household,
    state,
    taxYear,
  } = input;
  const { filingStatus } = household;

  const taxableSocialSecurity = calculateTaxableSocialSecurity(
    traditionalWithdrawals,
    socialSecurityBenefit,
    qualifiedIncome,
    filingStatus,
    taxYear,
  );
  const ordinary = traditionalWithdrawals + taxableSocialSecurity;
  const deduction = deductionFor(household, taxYear, ordinary + qualifiedIncome);

  const federal = federalTaxOn({
    ordinary,
    qualified: qualifiedIncome,
    deduction,
    filingStatus,
    taxYear,
  });

  const stateProfile = stateTaxProfileOf(state);
  const stateResult = stateTaxOf(stateProfile, {
    wages: 0,
    otherOrdinary: traditionalWithdrawals,
    qualified: qualifiedIncome,
    socialSecurity: socialSecurityBenefit,
    pretax: { hsa: 0, traditional: 0 },
    filingStatus,
  });

  const totalTax = federal.tax + stateResult.tax;
  const totalIncome = traditionalWithdrawals + socialSecurityBenefit + qualifiedIncome;

  return {
    federalTax: federal.tax,
    stateTax: stateResult.tax,
    ficaTax: 0,
    totalTax,
    effectiveRate: totalIncome > 0 ? totalTax / totalIncome : 0,
    marginalRate: federal.marginalRate + stateResult.marginalRate,
    taxableIncome: federal.taxableIncome,
    hsaContribution: 0,
    k401Contribution: 0,
  };
}

/**
 * The taxable portion of Social Security, which the IRS keys off "combined
 * income" — other income plus half the benefit — against two thresholds that
 * have been fixed in nominal dollars since 1984.
 */
export function calculateTaxableSocialSecurity(
  otherIncome: number,
  socialSecurityBenefit: number,
  qualifiedIncome: number,
  filingStatus: FilingStatus,
  taxYear: number = TAX_LAW_YEAR,
): number {
  if (socialSecurityBenefit === 0) return 0;

  const combinedIncome = otherIncome + qualifiedIncome + (socialSecurityBenefit * 0.5);

  const nominalThresholds = {
    Single: { tier1: 25000, tier2: 34000 },
    MarriedFilingJointly: { tier1: 32000, tier2: 44000 },
    MarriedFilingSeparately: { tier1: 0, tier2: 0 }, // Special rules - generally all taxable
    HeadOfHousehold: { tier1: 25000, tier2: 34000 }, // Same as Single
  };

  const nominal = nominalThresholds[filingStatus];
  const threshold = {
    tier1: frozenThreshold(nominal.tier1, taxYear),
    tier2: frozenThreshold(nominal.tier2, taxYear),
  };

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

function getMarginalTaxRate(income: number, brackets: TaxBracket[]): number {
  for (let i = brackets.length - 1; i >= 0; i--) {
    const bracket = brackets[i];
    if (income > bracket.min) {
      return bracket.rate;
    }
  }
  return brackets[0]?.rate || 0;
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

  const brackets = ltcgBrackets[filingStatus];

  let tax = 0;
  let remainingLTCG = ltcgIncome;
  let currentThreshold = ordinaryTaxableIncome;

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
