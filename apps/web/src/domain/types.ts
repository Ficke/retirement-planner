export type AccountType = 'Taxable' | 'Traditional' | 'Roth' | 'HSA';

export type FilingStatus = 'Single' | 'MarriedFilingJointly' | 'MarriedFilingSeparately' | 'HeadOfHousehold';

export type State = 'CA' | 'TX' | 'FL' | 'NY' | 'WA' | 'Other';

export interface AssetWeights {
  stocks: number;
  bonds: number;
}

// Unified Account type - clean architecture without legacy compatibility
export interface Account {
  id: string;
  name: string;
  institution: string;
  type: AccountType; // HSA | Traditional | Roth | Taxable
  user_id?: string | null; // Owner of this account (for multi-user support)

  balance: number;
  assetWeights: AssetWeights;
  balanceAsOf?: string; // ISO date string
  taxable: boolean; // computed from type

  // Metadata
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string
}

export interface CreateAccountData {
  name: string;
  institution: string;
  type: AccountType;
  balance?: number;
  stocksPct?: number;
  bondsPct?: number;
  userId?: string;
}

export interface UserProfile {
  age: number;
  /** Calendar birth year for cohort-specific RMD rules. */
  birthYear?: number;
  state: State;
  filingStatus: FilingStatus;
  retirementAge: number;
  currentSalary: number;
  salaryGrowthRate: number;
  /** Current annual spending in real dollars during working years. */
  currentSpending: number;
  /** Target annual retirement spending in real dollars. */
  desiredSpending: number;
  spendingGrowthRate: number;
  lifeExpectancy: number;
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

export interface ProjectionSettings {
  simulationModel: SimulationModel;
  randomSeed?: number;
  /** Portion of taxable-account withdrawals treated as long-term capital gain. */
  taxableGainRatio: number;
  /** Annual contribution targets, reduced when statutory limits or cash flow require it. */
  contributions: AnnualContributions;
}

/** @deprecated Use ProjectionSettings instead */
export type AssumptionSettings = ProjectionSettings;

export interface RetirementPlan {
  profile: UserProfile;
  accounts: Account[];
  socialSecurity: SocialSecuritySettings;
  assumptions: ProjectionSettings;
}

export interface SimulationResult {
  /** Fraction of paths that fully fund every modeled working and retirement year. */
  successProbability: number;
  medianTerminalWealth: number;
  percentile5TerminalWealth: number;
  percentile10TerminalWealth: number;
  percentile90TerminalWealth: number;
  yearlyProjections: YearlyProjection[];
  /**
   * Cash flows from the median-terminal-wealth path. A single representative
   * path keeps income, taxes, spending, deposits, and withdrawals coherent.
   */
  incomeSourcesPath?: IncomeSourcesRow[];
  /** 1 - successProbability. A path fails when any modeled year is underfunded. */
  riskOfRuin: number;
  /** Which engine produced this result. Set by the simulation service, not the engine. */
  source?: 'server' | 'client';
}

export interface SSAnalysisResult {
  claimAge: number;
  result: SimulationResult;
}

export interface SpendingAnalysisResult {
  annualSpending: number;
  result: SimulationResult;
}

export interface RetirementAgeAnalysisResult {
  retirementAge: number;
  result: SimulationResult;
}

/**
 * Single-path deterministic projection result.
 * Returned by projectScenario() for one simulation path.
 * Does NOT include percentiles - those only exist after Monte Carlo aggregation.
 */
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
  // Retirement income sources
  withdrawalTaxable: number;
  withdrawalTraditional: number;
  withdrawalRoth: number;
  rmdAmount: number;
  // Detailed cash flows per account type
  depositTaxable: number;
  depositTraditional: number;
  depositRoth: number;
  depositHSA: number;
  withdrawalHSA: number;
  insufficientFunds: boolean;
}

/**
 * Result from a single simulation path.
 * Returned by projectScenario() - contains yearly projections without percentiles.
 * The worker aggregates multiple PathResults to create a SimulationResult.
 */
export interface PathResult {
  terminalWealth: number;
  projections: PathProjection[];
  success: boolean; // Whether every modeled year was fully funded
}

/**
 * Monte Carlo aggregated projection with percentiles.
 * Created by mc.worker.ts after running 5000+ paths and calculating percentiles.
 * This is what the UI displays.
 */
export interface IncomeSourcesRow {
  age: number;
  isRetired: boolean;
  socialSecurityBenefit: number;
  withdrawalTaxable: number;
  withdrawalTraditional: number;
  withdrawalRoth: number;
  withdrawalHSA: number;
}

export interface YearlyProjection extends PathProjection {
  p5: number;
  p10: number;
  p15: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

// Loading states
export type LoadingState = 'idle' | 'loading' | 'success' | 'error';

export interface AccountLoadingState {
  state: LoadingState;
  error?: string;
  lastUpdated?: string;
}

// Type-safe account validation
export interface AccountValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}
