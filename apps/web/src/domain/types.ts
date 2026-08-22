import { PLAN_SCHEMA_VERSION } from '@/domain/constants';

export type AccountType = 'Taxable' | 'Traditional' | 'Roth' | 'HSA';

export type FilingStatus = 'Single' | 'MarriedFilingJointly' | 'MarriedFilingSeparately' | 'HeadOfHousehold';

export type State = 'CA' | 'TX' | 'FL' | 'NY' | 'WA' | 'Other';

export interface AssetWeights {
  stocks: number;
  bonds: number;
}

/** Account state owned by the plan and edited by the user. */
export interface Account {
  id: string;
  name: string;
  institution: string;
  type: AccountType; // HSA | Traditional | Roth | Taxable
  balance: number;
  assetWeights: AssetWeights;
}

export interface CreateAccountData {
  name: string;
  institution: string;
  type: AccountType;
  balance?: number;
  stocksPct?: number;
  bondsPct?: number;
}

export type UpdateAccountData = Partial<Pick<
  Account,
  'name' | 'institution' | 'type' | 'balance' | 'assetWeights'
>>;

/**
 * Retirement healthcare, which is a step at Medicare eligibility rather than a
 * share of spending. Premiums and out-of-pocket costs are separate because
 * Medicare, and later any subsidy or surcharge, moves only the premium.
 *
 * All figures are household totals in real dollars as of the plan's as-of
 * date, which is what `realGrowthRate` compounds from.
 */
export interface RetirementHealthcare {
  /** Marketplace premiums before 65. */
  preMedicarePremium: number;
  /** Part B, Part D, and supplemental premiums from 65. */
  medicarePremium: number;
  /** Deductibles, coinsurance, and what no plan covers, on both sides of 65. */
  outOfPocket: number;
  /** Medical inflation above CPI. */
  realGrowthRate: number;
}

export interface UserProfile {
  /**
   * Date of birth, ISO. Age and the RMD/Social-Security birth-year cohort are
   * both derived from it, so they can never disagree.
   */
  birthDate: string;
  state: State;
  filingStatus: FilingStatus;
  retirementAge: number;
  currentSalary: number;
  salaryGrowthRate: number;
  /** Current annual spending in real dollars during working years. */
  currentSpending: number;
  /** Annual real change in working-year spending. */
  workingSpendingGrowthRate: number;
  /**
   * Retirement spending as a share of working-year spending. Today's spending
   * is the lever; the retirement target follows from it.
   */
  retirementSpendingMultiplier: number;
  /** Annual real change after the first modeled retirement year. */
  retirementSpendingGrowthRate: number;
  lifeExpectancy: number;
  /**
   * Healthcare in retirement, carried separately from `currentSpending` because
   * it steps down at Medicare and grows faster than everything else.
   */
  retirementHealthcare: RetirementHealthcare;
  asOfDate: string; // ISO date string for when salary/projections are calculated from
}

export interface SocialSecuritySettings {
  enabled: boolean;
  estimatedBenefit?: number;
  claimAge: number;
  manualOverride: boolean;
}

export interface SocialSecurityUpdate {
  enabled?: boolean;
  estimatedBenefit?: number;
  claimAge?: number;
  manualOverride?: boolean;
}

export interface TaxBracket {
  min: number;
  max: number | null;
  rate: number;
}

export type SimulationModel = 'historical' | 'parametric';

export interface AnnualContributions {
  hsa: number;
  traditional: number;
  roth: number;
  taxable: number;
}

/**
 * How much ordinary income a conversion year is allowed to reach. Bracket
 * ceilings cap taxable income at the named bracket's top; `irmaaTier` caps
 * MAGI below the first Medicare surcharge tier instead, which binds earlier
 * than any of the bracket tops a conversion would otherwise aim for.
 */
export type RothConversionCeiling =
  | 'bracket12'
  | 'bracket22'
  | 'bracket24'
  | 'bracket32'
  | 'irmaaTier';

/**
 * Conversions run from retirement through the year before RMDs begin — the
 * window where ordinary income is at its lowest and the pre-tax balance can
 * still be moved before it is forced out. Both ends are derived, so the plan
 * stores only whether to convert and how far to fill.
 */
export interface RothConversionPolicy {
  enabled: boolean;
  ceiling: RothConversionCeiling;
}

export interface ProjectionSettings {
  simulationModel: SimulationModel;
  /** The main simulation and every sensitivity scenario share this root seed. */
  randomSeed: number;
  /** Portion of taxable-account withdrawals treated as long-term capital gain. */
  taxableGainRatio: number;
  /** HDHP coverage. Without it there is no HSA contribution to deduct. */
  hsaEligible: boolean;
  /** Without a backdoor conversion, a Roth IRA contribution is not modeled. */
  useBackdoorRoth: boolean;
  rothConversion: RothConversionPolicy;
  /**
   * Rate applied to the Traditional and HSA balances left at the horizon, to
   * report terminal wealth after the tax nobody has paid yet. Taxable and Roth
   * pass through whole: a bequeathed taxable account steps up its basis, and a
   * Roth is already settled.
   */
  terminalTaxRate: number;
}

/** @deprecated Use ProjectionSettings instead */
export type AssumptionSettings = ProjectionSettings;

export interface RetirementPlan {
  profile: UserProfile;
  accounts: Account[];
  socialSecurity: SocialSecuritySettings;
  assumptions: ProjectionSettings;
}

/** Minimal transient contract shared by the browser and Rust engines. */
export interface SimulationAccount {
  type: AccountType;
  balance: number;
  assetWeights: AssetWeights;
}

/** The profile as the engines see it, with the retirement target resolved. */
export interface SimulationProfile
  extends Omit<UserProfile, 'retirementSpendingMultiplier'> {
  /** First modeled retirement year's spending in real dollars. */
  retirementSpending: number;
}

export interface SimulationPlan extends Omit<RetirementPlan, 'accounts' | 'profile'> {
  schemaVersion: typeof PLAN_SCHEMA_VERSION;
  profile: SimulationProfile;
  accounts: SimulationAccount[];
}

export interface SimulationResult {
  /** Fraction of paths that fully fund every modeled working and retirement year. */
  successProbability: number;
  medianTerminalWealth: number;
  /**
   * The median path's terminal wealth net of the tax owed on its Traditional
   * and HSA balances, at the plan's `terminalTaxRate`. Reported beside the
   * gross figure rather than in place of it: the gross number is what every
   * other chart plots, and this one is what those balances would settle for.
   */
  medianAfterTaxTerminalWealth: number;
  percentile5TerminalWealth: number;
  percentile10TerminalWealth: number;
  percentile90TerminalWealth: number;
  yearlyProjections: YearlyProjection[];
  /** Mean cash flows for 10%-wide outcome cohorts centered on deciles 10–90. */
  outcomeBuckets: OutcomeBucket[];
  /** 1 - successProbability. A path fails when any modeled year is underfunded. */
  riskOfRuin: number;
  /** Which engine produced this result. Set by the simulation service, not the engine. */
  source?: 'server' | 'client';
}

/** Sensitivity sweeps use this minimal result. */
export interface SimulationSummary {
  successProbability: number;
  source?: 'server' | 'client';
}

export interface SSAnalysisResult {
  claimAge: number;
  result: SimulationSummary;
}

export interface SpendingAnalysisResult {
  annualSpending: number;
  result: SimulationSummary;
}

export interface RetirementAgeAnalysisResult {
  retirementAge: number;
  result: SimulationSummary;
}

/** One modeled year on one path: every cash flow, in real dollars. */
export interface PathProjection {
  year: number;
  age: number;
  portfolioValue: number;
  income: number;
  spending: number;
  taxes: number;
  savings: number;
  socialSecurityBenefit: number;
  isRetired: boolean;
  withdrawalTaxable: number;
  withdrawalTraditional: number;
  withdrawalRoth: number;
  rmdAmount: number;
  /**
   * Dollars that reached the Roth this year. An internal transfer, so it is no
   * part of `spending`; only the tax it adds reaches `taxes`. Tax withheld out
   * of a conversion is counted in `withdrawalTraditional` instead, since those
   * dollars left the pre-tax account without arriving anywhere else.
   */
  rothConversion: number;
  depositTaxable: number;
  depositTraditional: number;
  depositRoth: number;
  depositHSA: number;
  withdrawalHSA: number;
  /**
   * Funded retirement healthcare for the year, part of the same `spending`
   * total. Zero while working, where healthcare sits inside `currentSpending`.
   */
  healthcareCost: number;
  insufficientFunds: boolean;
}

/** One complete path. Monte Carlo aggregates many of these into percentiles. */
export interface PathResult {
  terminalWealth: number;
  /** Terminal wealth net of the tax still owed on Traditional and HSA. */
  afterTaxTerminalWealth: number;
  projections: PathProjection[];
  success: boolean; // Whether every modeled year was fully funded
}

/** One year of a cohort's mean cash flows, including mean funded healthcare. */
export interface OutcomeCashFlowRow {
  age: number;
  isRetired: boolean;
  income: number;
  spending: number;
  taxes: number;
  savings: number;
  socialSecurityBenefit: number;
  withdrawalTaxable: number;
  withdrawalTraditional: number;
  withdrawalRoth: number;
  withdrawalHSA: number;
  healthcareCost: number;
}

export interface OutcomeBucket {
  centerPercentile: number;
  lowerPercentile: number;
  upperPercentile: number;
  successProbability: number;
  projections: OutcomeCashFlowRow[];
}

/** A year of the representative path, widened with the percentile fan. */
export interface YearlyProjection extends PathProjection {
  p5: number;
  p10: number;
  p15: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export type LoadingState = 'idle' | 'loading' | 'success' | 'error';

export interface AccountLoadingState {
  state: LoadingState;
  error?: string;
  lastUpdated?: string;
}

export interface AccountValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}
