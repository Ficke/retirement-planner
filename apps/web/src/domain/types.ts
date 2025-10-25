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

  // Computed properties (from account_transactions)
  balance: number; // Total portfolio value from holdings
  assetWeights: AssetWeights; // Computed from security allocations
  taxable: boolean; // computed from type

  // Metadata
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string
}

// Helper types for account creation and updates
export interface CreateAccountData {
  name: string;
  institution: string;
  type: AccountType;
}

export interface AccountWithHoldings {
  account: Account;
  currentBalance: number | null;
}

export interface UserProfile {
  age: number;
  state: State;
  filingStatus: FilingStatus;
  retirementAge: number;
  currentSalary: number;
  salaryGrowthRate: number;
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

export type Preset = 'Conservative' | 'Moderate' | 'Aggressive';

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

export interface ProjectionSettings {
  preset: Preset;
  customReturns?: MarketAssumptions;
  rebalanceAnnually: boolean;
  realDollarDisplay: boolean;
  longevityOverride?: number;
  simulationModel: SimulationModel;
  randomSeed?: number;
  useBackdoorRoth: boolean;
}

/** @deprecated Use ProjectionSettings instead */
export type AssumptionSettings = ProjectionSettings;

export interface MarketAssumptions {
  stocks: { mean: number; vol: number };
  bonds: { mean: number; vol: number };
  inflation: { mean: number; vol: number };
  correlation: number[][];
}

export interface RetirementPlan {
  profile: UserProfile;
  accounts: Account[];
  socialSecurity: SocialSecuritySettings;
  assumptions: ProjectionSettings;
}

export interface SimulationResult {
  successProbability: number;
  medianTerminalWealth: number;
  percentile5TerminalWealth: number;
  percentile10TerminalWealth: number;
  percentile90TerminalWealth: number;
  yearlyProjections: YearlyProjection[];
  terminalWealthDistribution: number[];
  riskOfRuin: number;
  wealthThresholds: {
    below1m: number;
    below500k: number;
  };
  wealthAtAge: Record<number, {
    p25: number;
    p50: number;
    p75: number;
  }>;
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
  success: boolean; // Whether portfolio lasted until life expectancy
}

/**
 * Monte Carlo aggregated projection with percentiles.
 * Created by mc.worker.ts after running 5000+ paths and calculating percentiles.
 * This is what the UI displays.
 */
export interface YearlyProjection extends PathProjection {
  p5: number;
  p10: number;
  p15: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

// Transaction types for account management
export interface AccountTransaction {
  id: string;
  accountId: string;
  symbol: string;
  transactionType: TransactionType; // Keep existing field name for compatibility
  shares: number;
  pricePerShare?: number;
  transactionDate: string; // ISO date string
  description?: string;
  createdAt: string; // ISO date string
}

export interface AccountSnapshot {
  id: string;
  accountId: string;
  balance: number;
  snapshotDate: string; // ISO date string
  stocksWeight: number;
  bondsWeight: number;
  createdAt: string; // ISO date string
}

export interface CatchUpCalculation {
  snapshotId: string;
  targetDate: string; // ISO date string (usually today)
  finalBalance: number;
  returnsApplied: {
    stocksReturn: number;
    bondsReturn: number;
    totalReturn: number;
  };
  methodology: string; // e.g., "historical-returns"
  calculatedAt: string; // ISO date string
}

// Transaction creation types
export interface CreateAccountTransactionData {
  accountId: string;
  symbol: string;
  transactionType: TransactionType;
  shares: number;
  pricePerShare?: number;
  transactionDate: string;
  description?: string;
}

// Enhanced loading states with fail-fast design
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

export interface CreateSnapshotData {
  accountId: string;
  balance: number;
  snapshotDate: string;
  stocksWeight: number;
  bondsWeight: number;
}

export interface HoldingsSnapshot {
  id: string;
  accountId: string;
  symbol: string;
  shares: number;
  averageCostBasis: number;
  asOfDate: string; // ISO date string
  lastTransactionId?: string;
  calculationMethod: 'full_calc' | 'incremental';
  createdAt: string; // ISO date string
}

export interface CreateHoldingsSnapshotData {
  accountId: string;
  symbol: string;
  shares: number;
  averageCostBasis: number;
  asOfDate: string;
  lastTransactionId?: string;
  calculationMethod?: 'full_calc' | 'incremental';
}

// Securities-based holdings types
export type SecurityType = 'ETF' | 'MUTUAL_FUND' | 'STOCK' | 'BOND' | 'OTHER';
export type AssetClass = 'STOCK' | 'BOND' | 'CASH' | 'COMMODITY' | 'REIT' | 'OTHER';

export interface SecurityAllocations {
  stocks: number;
  bonds: number;
  cash?: number;
  commodity?: number;
  reit?: number;
  other?: number;
}

export interface Security {
  symbol: string;
  name: string;
  type: SecurityType;
  assetClass: AssetClass;
  // Risk multiplier for leveraged funds (1.0 = no leverage, 1.5 = 150% exposure)
  riskMultiplier: number;
  // Underlying asset allocations (should sum to riskMultiplier for leveraged funds)
  underlyingAllocations: SecurityAllocations;
  // Optional: expense ratio, provider, etc.
  expenseRatio?: number;
  provider?: string;
  // Mutual fund pricing metadata (for securities that need ETF equivalents)
  pricingSymbol?: string; // ETF symbol to use for pricing (if different from symbol)
  priceMultiplier?: number; // Multiplier to convert ETF price to mutual fund price
  priceAdjustmentFactor?: number; // HACK: Temporary factor to adjust price for specific securities
}

export type TransactionType = 'BUY' | 'SELL' | 'SPLIT' | 'DIVIDEND_REINVEST';

export interface SecurityHolding {
  accountId: string;
  symbol: string;
  totalShares: number;
  averageCostBasis?: number;
  currentValue: number;
  currentPrice?: number;
  asOfDate: string; // ISO date string
  security: Security;
}

export interface SecurityPosition {
  symbol: string;
  shares: number;
  currentValue: number;
  allocation: SecurityAllocations;
  security: Security;
}

// Aggregation result type
export interface AccountAggregation {
  accountType: AccountType;
  totalBalance: number;
  weightedAssetWeights: AssetWeights;
  accountCount: number;
  lastSnapshotDate: string | null;
}