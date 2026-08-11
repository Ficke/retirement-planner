import type { RetirementPlan, PathResult, PathProjection, Account, FilingStatus } from '@/domain/types';
import { calculateWorkingCashFlow, calculateRetirementTax } from './tax';
import { calculateSSABenefit } from './ssa';
import { calculateRmd } from './rmd';
import { getRmdStartAge } from '@/data/rmd-tables';
import { HISTORICAL_RETURNS } from '@/data/market-history-annual';
import { MONTE_CARLO_DEFAULTS, generateCorrelatedReturns } from '@/data/market-history';
import seedrandom from 'seedrandom';

const SIMULATION_SURPLUS_CASH_ID = '__simulation_surplus_cash__';

export interface ProjectionConfig {
  paths: number;
  seed: number;
}

/**
 * Market returns generator interface for both single and block bootstrapping.
 */
export interface MarketReturnsGenerator {
  next(): { stockReturn: number; bondReturn: number };
}

/**
 * Core retirement projection engine.
 * Implements deterministic single-path projection with proper withdrawal ordering:
 * Taxable → Traditional → Roth (per CLAUDE.md).
 *
 * @param plan - Complete retirement plan configuration
 * @param config - Simulation configuration (paths, seed, real vs nominal)
 * @returns Single path result with yearly projections (no percentiles)
 */
export function projectScenario(
  plan: RetirementPlan,
  config: ProjectionConfig
): PathResult {
  const { profile, accounts, socialSecurity } = plan;

  // DEBUG logging disabled - too verbose

  // Calculate the inclusive fraction of the current year remaining. Use UTC
  // calendar arithmetic so daylight-saving transitions cannot add or remove a
  // day from the first simulation period.
  const [currentYear, asOfMonth, asOfDay] = profile.asOfDate.split('-').map(Number);
  const birthYear = profile.birthYear ?? currentYear - profile.age;
  const rmdStartAge = getRmdStartAge(birthYear);
  const daysInYear = (currentYear % 4 === 0 && currentYear % 100 !== 0) || (currentYear % 400 === 0) ? 366 : 365;
  const dayOfYear = Math.floor(
    (Date.UTC(currentYear, asOfMonth - 1, asOfDay) - Date.UTC(currentYear, 0, 1))
      / (1000 * 60 * 60 * 24),
  ) + 1;
  const remainingYearFraction = Math.max(0, Math.min(1, (daysInYear - dayOfYear + 1) / daysInYear));
  
  // Life expectancy is inclusive: simulate from current age through that age.
  // Deriving this directly also supports people who are already retired.
  const totalYears = profile.lifeExpectancy - profile.age + 1;

  const yearlyProjections: PathProjection[] = [];

  // Use single source of truth for account balances (deep copy to avoid mutation)
  const accountBalances = accounts.map(acc => ({ ...acc }));
  let currentPortfolioValue = accountBalances.reduce((sum, acc) => sum + acc.balance, 0);
  
  // Track previous year's traditional account balance for RMD calculations
  let previousYearTraditionalBalance = 0;
  
  // Initialize seeded RNG for reproducible results
  const rng = createRNG(config.seed);
  
  // Create market returns generator for block or single bootstrapping
  const returnsGenerator = createMarketReturnsGenerator(plan, rng);
  
  for (let year = 0; year < totalYears; year++) {
    const currentAge = profile.age + year;
    const isRetired = currentAge >= profile.retirementAge;

    
    // Calculate RMD amount for this year based on previous year's traditional balance
    // For the first year, use current balance if we don't have a previous year balance
    let rmdAmount = 0;
    if (currentAge >= rmdStartAge) {
      const balanceForRmd = previousYearTraditionalBalance > 0 
        ? previousYearTraditionalBalance
        : accountBalances
            .filter(acc => acc.type === 'Traditional')
            .reduce((sum, acc) => sum + acc.balance, 0);
      rmdAmount = calculateRmd(balanceForRmd, currentAge, rmdStartAge);
    }
    
    // For first year, prorate salary based on remaining year fraction
    const annualSalary = profile.currentSalary * Math.pow(1 + profile.salaryGrowthRate, year);
    let income = 0;
    let spending = 0;
    let taxes = 0;
    let savings = 0;
    let socialSecurityBenefit = 0;
    
    // Initialize cash flow tracking variables
    let withdrawalTaxableYear = 0;
    let withdrawalTraditionalYear = 0;
    let withdrawalRothYear = 0;
    let withdrawalHSAYear = 0;
    let depositTaxableYear = 0;
    let depositTraditionalYear = 0;
    let depositRothYear = 0;
    let depositHSAYear = 0;
    let insufficientFundsYear = false;
    
    if (!isRetired) {
      // Working phase uses explicit contribution targets. Targets are only
      // eligible when a matching account exists, and are reduced in the clear
      // priority HSA → Traditional → Roth → Taxable when cash is insufficient.
      const annualWorkingSpending = profile.currentSpending;
      // Keep direct engine callers resilient to plans saved before explicit
      // contribution targets existed. Persistence migrates these plans, while
      // the projection boundary treats missing targets as an intentional zero.
      const targets = plan.assumptions.contributions ?? {
        hsa: 0,
        traditional: 0,
        roth: 0,
        taxable: 0,
      };
      const hasHSA = accountBalances.some((account) => account.type === 'HSA');
      const hasTraditional = accountBalances.some((account) => account.type === 'Traditional');
      const hasRoth = accountBalances.some((account) => account.type === 'Roth');
      const hasTaxable = accountBalances.some((account) => account.type === 'Taxable');
      const eligibleTargets = {
        hsa: hasHSA ? targets.hsa : 0,
        traditional: hasTraditional ? targets.traditional : 0,
        roth: hasRoth ? targets.roth : 0,
        taxable: hasTaxable ? targets.taxable : 0,
      };
      const periodFraction = year === 0 ? remainingYearFraction : 1;

      // Generate market returns for this year using the configured generator
      const yearlyReturns = returnsGenerator.next();


      // Apply account-specific returns based on each account's individual asset weights
      for (const account of accountBalances) {
        const accountReturn =
          account.assetWeights.stocks * yearlyReturns.stockReturn +
          account.assetWeights.bonds * yearlyReturns.bondReturn;

        // Apply market returns to this account's balance (prorated for first year)
        const effectiveReturn = year === 0 ? accountReturn * remainingYearFraction : accountReturn;
        account.balance *= (1 + effectiveReturn);
        // Clamp to 0 to prevent negative balances from extreme market downturns
        account.balance = Math.max(0, account.balance);

      }

      // RMDs still apply when the primary person works past the applicable
      // age. Current-year annual flows are prorated uniformly because the plan
      // does not collect year-to-date distributions.
      let rmdRemaining = rmdAmount * periodFraction;
      for (const account of accountBalances) {
        if (account.type === 'Traditional' && account.balance > 0 && rmdRemaining > 0) {
          const withdrawal = Math.min(rmdRemaining, account.balance);
          account.balance -= withdrawal;
          withdrawalTraditionalYear += withdrawal;
          rmdRemaining -= withdrawal;
        }
      }
      rmdAmount = withdrawalTraditionalYear;
      const annualizedRmdIncome = withdrawalTraditionalYear / periodFraction;
      const baselineWorkingCashFlow = calculateWorkingCashFlow(
        annualSalary,
        annualWorkingSpending,
        currentAge,
        profile.filingStatus,
        profile.state,
        eligibleTargets,
      );
      const workingCashFlow = annualizedRmdIncome > 0
        ? calculateWorkingCashFlow(
            annualSalary,
            annualWorkingSpending,
            currentAge,
            profile.filingStatus,
            profile.state,
            eligibleTargets,
            annualizedRmdIncome,
          )
        : baselineWorkingCashFlow;
      const taxResult = workingCashFlow.tax;
      const rothContribution = workingCashFlow.contributions.roth;
      const taxableContribution = workingCashFlow.contributions.taxable;
      insufficientFundsYear = workingCashFlow.fundingGap > 1;
      income = annualSalary * periodFraction;
      spending = annualWorkingSpending * periodFraction;
      taxes = taxResult.totalTax * periodFraction;

      // Add new savings to appropriate accounts based on contribution rules
      // For first year, prorate contributions based on remaining year fraction
      const contributionProration = periodFraction;


      // HSA contributions go to HSA accounts first (highest tax advantage)
      if (taxResult.hsaContribution > 0) {
        const hsaAccount = accountBalances.find(acc => acc.type === 'HSA');
        if (hsaAccount) {
          const deposit = taxResult.hsaContribution * contributionProration;
          hsaAccount.balance += deposit;
          depositHSAYear = deposit;

        }
      }
      
      // 401k contributions go to Traditional accounts
      if (taxResult.k401Contribution > 0) {
        const traditionalAccount = accountBalances.find(acc => acc.type === 'Traditional');
        if (traditionalAccount) {
          const deposit = taxResult.k401Contribution * contributionProration;
          traditionalAccount.balance += deposit;
          depositTraditionalYear = deposit;

        }
      }

      // Roth contributions go to Roth accounts
      if (rothContribution > 0) {
        const rothAccount = accountBalances.find(acc => acc.type === 'Roth');
        if (rothAccount) {
          const deposit = rothContribution * contributionProration;
          rothAccount.balance += deposit;
          depositRothYear = deposit;

        }
      }

      // Explicit after-tax savings go to taxable accounts
      if (taxableContribution > 0) {
        const taxableAccount = accountBalances.find(acc => acc.type === 'Taxable');
        if (taxableAccount) {
          const deposit = taxableContribution * contributionProration;
          taxableAccount.balance += deposit;
          depositTaxableYear = deposit;

        }
      }

      // Preserve only cash forced into the working-year budget by the RMD.
      // Ordinary wage surplus remains governed by the user's explicit savings
      // targets rather than being silently optimized by the simulator.
      const forcedSurplusDeposit = Math.max(
        0,
        workingCashFlow.unallocatedCash - baselineWorkingCashFlow.unallocatedCash,
      ) * periodFraction;
      if (forcedSurplusDeposit > 0) {
        depositTaxableCash(accountBalances, forcedSurplusDeposit);
        depositTaxableYear += forcedSurplusDeposit;
      }

      savings = depositTaxableYear
        + depositTraditionalYear
        + depositRothYear
        + depositHSAYear
        - withdrawalTraditionalYear;
      
      // Update total portfolio value
      currentPortfolioValue = accountBalances.reduce((sum, acc) => sum + acc.balance, 0);

    } else {
      // Retirement phase: withdrawals, SS benefits, taxes on withdrawals
      const retirementPeriodFraction = year === 0 ? remainingYearFraction : 1;
      const targetSpending = profile.desiredSpending
        * Math.pow(1 + profile.spendingGrowthRate, year)
        * retirementPeriodFraction;

      if (socialSecurity.enabled && currentAge >= socialSecurity.claimAge) {
        const annualSocialSecurityBenefit = socialSecurity.manualOverride
          ? Math.max(0, socialSecurity.estimatedBenefit ?? 0)
          : calculateSSABenefit(
              estimateSalaryHistory(
                profile.currentSalary,
                profile.salaryGrowthRate,
                profile.age,
                profile.retirementAge,
              ),
              socialSecurity.claimAge,
              birthYear,
            ).annualBenefit;
        socialSecurityBenefit = annualSocialSecurityBenefit * retirementPeriodFraction;
      }

      // Generate market returns for this year using the configured generator
      const yearlyReturns = returnsGenerator.next();

      // Apply account-specific returns based on each account's individual asset weights
      for (const account of accountBalances) {
        const accountReturn =
          account.assetWeights.stocks * yearlyReturns.stockReturn +
          account.assetWeights.bonds * yearlyReturns.bondReturn;

        // Apply market returns to this account's balance (prorated for first year)
        const effectiveReturn = year === 0 ? accountReturn * remainingYearFraction : accountReturn;
        account.balance *= (1 + effectiveReturn);
        // Clamp to 0 to prevent negative balances from extreme market downturns
        account.balance = Math.max(0, account.balance);
      }

      // Execute the explicit Taxable → Traditional → Roth → HSA policy.
      rmdAmount *= retirementPeriodFraction;
      const { withdrawalTaxable, withdrawalTraditional, withdrawalRoth, withdrawalHSA, totalWithdrawn, totalTaxes, insufficientFunds, depositTaxable } =
        executeOrderedWithdrawals(
          targetSpending,
          accountBalances,
          { age: currentAge, filingStatus: profile.filingStatus, state: profile.state },
          socialSecurityBenefit,
          rmdAmount,
          plan.assumptions.taxableGainRatio ?? 0.5,
        );

      // RMD excess gets reinvested in taxable account
      if (depositTaxable > 0) {
        depositTaxableCash(accountBalances, depositTaxable);
        depositTaxableYear = depositTaxable;
      }

      // Store withdrawals for this year's projection
      withdrawalTaxableYear = withdrawalTaxable;
      withdrawalTraditionalYear = withdrawalTraditional;
      withdrawalRothYear = withdrawalRoth;
      withdrawalHSAYear = withdrawalHSA;
      insufficientFundsYear = insufficientFunds;
      taxes = totalTaxes;

      // Calculate actual spending based on available funds
      spending = insufficientFunds
        ? Math.max(0, totalWithdrawn - totalTaxes - depositTaxable + socialSecurityBenefit)
        : targetSpending;

      income = socialSecurityBenefit;
      savings = depositTaxable - totalWithdrawn;

      // Update portfolio value to match account balances
      currentPortfolioValue = accountBalances.reduce((sum, acc) => sum + acc.balance, 0);
    }
    
    // Update previous year traditional balance for next iteration's RMD calculation
    previousYearTraditionalBalance = accountBalances
      .filter(acc => acc.type === 'Traditional')
      .reduce((sum, acc) => sum + acc.balance, 0);
    
    yearlyProjections.push({
      year: currentYear + year,
      age: currentAge,
      portfolioValue: currentPortfolioValue,
      income,
      spending,
      taxes,
      savings,
      socialSecurityBenefit,
      isRetired,
      withdrawalTaxable: withdrawalTaxableYear,
      withdrawalTraditional: withdrawalTraditionalYear,
      withdrawalRoth: withdrawalRothYear,
      withdrawalHSA: withdrawalHSAYear,
      rmdAmount,
      depositTaxable: depositTaxableYear,
      depositTraditional: depositTraditionalYear,
      depositRoth: depositRothYear,
      depositHSA: depositHSAYear,
      insufficientFunds: insufficientFundsYear,
    });
  }
  
  // Single-path projection result - no percentiles or aggregation
  // Monte Carlo worker aggregates multiple paths to create SimulationResult
  const finalWealth = currentPortfolioValue;
  const everHadInsufficientFunds = yearlyProjections.some(p => p.insufficientFunds);
  const success = !everHadInsufficientFunds;

  return {
    terminalWealth: finalWealth,
    projections: yearlyProjections,
    success,
  };
}

/**
 * Seeded random number generator using seedrandom library.
 * Provides reproducible random numbers for Monte Carlo simulation.
 * Compatible with Rust seedrandom port for exact cross-platform results.
 */
export class SeededRNG {
  private prng: seedrandom.PRNG;

  constructor(seed: number) {
    // seedrandom expects a string seed, convert number to string
    this.prng = seedrandom(seed.toString());
  }

  next(): number {
    return this.prng();
  }

  normal(mean = 0, std = 1): number {
    // Box-Muller transformation for normal distribution
    if (this.spare !== undefined) {
      const val = this.spare * std + mean;
      this.spare = undefined;
      return val;
    }

    const u1 = this.next();
    const u2 = this.next();
    const mag = std * Math.sqrt(-2 * Math.log(u1));
    this.spare = mag * Math.cos(2 * Math.PI * u2);
    return mag * Math.sin(2 * Math.PI * u2) + mean;
  }

  studentT(df: number, mean = 0, scale = 1): number {
    // Robust Student's t-distribution implementation
    // For df <= 2, use Cauchy-like heavy tails but bounded
    // For df > 2, use normal approximation with heavier tails

    if (df <= 0) {
      throw new Error(`Invalid degrees of freedom: ${df}`);
    }

    // For very high df (>30), Student's t converges to normal
    if (df > 30) {
      return this.normal(mean, scale);
    }

    // Use more stable algorithm: ratio of normal to chi-square
    // t = Z / sqrt(V/df) where Z ~ N(0,1) and V ~ chi^2(df)
    const z = this.normal();

    // Generate chi-square using sum of squared normals (stable for small df)
    let chiSquare = 0;
    const n = Math.floor(df);
    for (let i = 0; i < n; i++) {
      const u = this.normal();
      chiSquare += u * u;
    }

    // Add fractional part if df is not integer
    if (df !== n) {
      const u = this.normal();
      chiSquare += (df - n) * u * u;
    }

    // Prevent division by zero
    if (chiSquare <= 0) {
      chiSquare = 1e-10;
    }

    const t = z / Math.sqrt(chiSquare / df);

    // Bound extreme values to prevent numerical issues
    const maxValue = 10; // 10 standard deviations
    const bounded = Math.max(-maxValue, Math.min(maxValue, t));

    return mean + scale * bounded;
  }

  private gamma(shape: number, scale: number): number {
    // Marsaglia and Tsang's Method for gamma distribution
    if (shape < 1) {
      return this.gamma(shape + 1, scale) * Math.pow(this.next(), 1 / shape);
    }

    const d = shape - 1/3;
    const c = 1 / Math.sqrt(9 * d);

    // Add iteration limit to prevent infinite loops
    let iterations = 0;
    const maxIterations = 1000;

    while (iterations < maxIterations) {
      iterations++;
      const x = this.normal();
      let v = 1 + c * x;

      if (v <= 0) continue;

      v = v * v * v;
      const u = this.next();

      if (u < 1 - 0.0331 * x * x * x * x) {
        return scale * d * v;
      }

      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
        return scale * d * v;
      }
    }

    // Fallback if convergence fails
    console.warn(`Gamma distribution failed to converge after ${maxIterations} iterations, using fallback`);
    return scale * shape; // Return expected value as fallback
  }

  private spare: number | undefined;
}

/**
 * Generate market returns using historical bootstrapping method.
 * Randomly selects a year from historical data to get actual market performance.
 * Converts nominal returns to real returns by adjusting for inflation.
 * This approach captures real correlation patterns and fat-tail distributions.
 * 
 * @param rng - Seeded random number generator for reproducible results
 * @returns Annual real returns for stocks and bonds from historical data
 */
export function getBootstrapMarketReturns(rng: SeededRNG): { stockReturn: number; bondReturn: number } {
  const index = Math.floor(rng.next() * HISTORICAL_RETURNS.length);
  const yearData = HISTORICAL_RETURNS[index];
  
  // Convert nominal returns to real returns: real = (1 + nominal) / (1 + inflation) - 1
  const realStockReturn = (1 + yearData.stock_return) / (1 + yearData.inflation_rate) - 1;
  const realBondReturn = (1 + yearData.bond_return) / (1 + yearData.inflation_rate) - 1;
  
  return {
    stockReturn: realStockReturn,
    bondReturn: realBondReturn
  };
}

/**
 * Block bootstrap market returns generator.
 * Samples blocks of consecutive years to preserve serial correlation in returns.
 */
export class BlockBootstrapGenerator implements MarketReturnsGenerator {
  private rng: SeededRNG;
  private blockSize: number;
  private currentBlock: { stockReturn: number; bondReturn: number }[];
  private blockIndex: number;

  constructor(rng: SeededRNG, blockSize: number = MONTE_CARLO_DEFAULTS.block_size) {
    this.rng = rng;
    this.blockSize = blockSize;
    this.currentBlock = [];
    this.blockIndex = 0;
    this.generateNewBlock();
  }

  private generateNewBlock(): void {
    // Circular blocks give every historical year equal probability of appearing.
    const startIndex = Math.floor(this.rng.next() * HISTORICAL_RETURNS.length);
    
    // Extract consecutive block of returns and convert to real returns
    this.currentBlock = [];
    for (let i = 0; i < this.blockSize; i++) {
      const yearData = HISTORICAL_RETURNS[(startIndex + i) % HISTORICAL_RETURNS.length];
      // Convert nominal returns to real returns: real = (1 + nominal) / (1 + inflation) - 1
      const realStockReturn = (1 + yearData.stock_return) / (1 + yearData.inflation_rate) - 1;
      const realBondReturn = (1 + yearData.bond_return) / (1 + yearData.inflation_rate) - 1;
      
      this.currentBlock.push({
        stockReturn: realStockReturn,
        bondReturn: realBondReturn
      });
    }
    this.blockIndex = 0;
  }

  next(): { stockReturn: number; bondReturn: number } {
    // If we've used all years in current block, generate a new block
    if (this.blockIndex >= this.currentBlock.length) {
      this.generateNewBlock();
    }
    
    const returns = this.currentBlock[this.blockIndex];
    this.blockIndex++;
    return returns;
  }
}

/**
 * Single year bootstrap generator (existing behavior).
 */
export class SingleBootstrapGenerator implements MarketReturnsGenerator {
  private rng: SeededRNG;

  constructor(rng: SeededRNG) {
    this.rng = rng;
  }

  next(): { stockReturn: number; bondReturn: number } {
    return getBootstrapMarketReturns(this.rng);
  }
}

/**
 * Parametric returns generator using normal distribution assumptions.
 * Generates correlated stock and bond returns based on statistical parameters.
 */
export class ParametricReturnsGenerator implements MarketReturnsGenerator {
  private rng: SeededRNG;

  constructor(rng: SeededRNG) {
    this.rng = rng;
  }

  next(): { stockReturn: number; bondReturn: number } {
    return generateCorrelatedReturns(this.rng);
  }
}

/**
 * Create market returns generator based on configuration.
 */
export function createMarketReturnsGenerator(plan: RetirementPlan, rng: SeededRNG): MarketReturnsGenerator {
  if (plan.assumptions.simulationModel === 'parametric') {
    return new ParametricReturnsGenerator(rng);
  } else if (MONTE_CARLO_DEFAULTS.use_historical_bootstrap) {
    return new BlockBootstrapGenerator(rng, MONTE_CARLO_DEFAULTS.block_size);
  } else {
    return new SingleBootstrapGenerator(rng);
  }
}

/**
 * Create a seeded RNG instance for consistent random number generation.
 * @param seed - Random seed for reproducibility
 * @returns SeededRNG instance
 */
export function createRNG(seed: number): SeededRNG {
  return new SeededRNG(seed);
}

/**
 * Estimate salary history for Social Security calculation.
 * Anchors earnings at current age, projecting backward for prior years and
 * forward through the final working year. Wage indexing is handled separately.
 * 
 * @param currentSalary - Current annual salary
 * @param salaryGrowthRate - Real annual salary growth rate
 * @param currentAge - Current age
 * @param retirementAge - Planned retirement age
 * @returns Array of estimated annual salaries for SS calculation
 */
export function estimateSalaryHistory(
  currentSalary: number,
  salaryGrowthRate: number,
  currentAge: number,
  retirementAge: number
): number[] {
  const salaryHistory: number[] = [];
  
  // Use age 22 as the estimated career start, unless the user is already
  // earning a salary at a younger current age.
  const careerStartAge = Math.min(22, currentAge);
  for (let age = careerStartAge; age < retirementAge; age++) {
    const yearsFromCurrentAge = age - currentAge;
    salaryHistory.push(currentSalary * Math.pow(1 + salaryGrowthRate, yearsFromCurrentAge));
  }
  
  return salaryHistory;
}

/** Preserve forced cash surpluses even when no brokerage account exists. */
function depositTaxableCash(accounts: Account[], amount: number): void {
  if (amount <= 0) return;
  const taxableAccount = accounts.find((account) => account.type === 'Taxable');
  if (taxableAccount) {
    taxableAccount.balance += amount;
    return;
  }

  // Internal zero-real-return cash account. It is never persisted or returned
  // to the user; it prevents after-tax RMD or income surpluses from disappearing.
  accounts.push({
    id: SIMULATION_SURPLUS_CASH_ID,
    name: 'Surplus cash',
    institution: '',
    type: 'Taxable',
    user_id: null,
    balance: amount,
    assetWeights: { stocks: 0, bonds: 0 },
    taxable: true,
    createdAt: '1970-01-01T00:00:00.000Z',
    updatedAt: '1970-01-01T00:00:00.000Z',
  });
}

/**
 * Execute the configured deterministic withdrawal order with iterative taxes.
 * Finds the smallest withdrawal that funds spending and taxes after Social
 * Security, subject to the full RMD. Any cash that remains when only mandatory
 * withdrawals are left is reinvested instead of disappearing.
 * 
 * @param targetSpending - Total spending for the modeled period
 * @param accountBalances - Account balances to withdraw from  
 * @param profile - User profile for tax calculations
 * @param socialSecurityBenefit - SS income that affects tax brackets
 * @returns Withdrawal amounts and tax implications
 */
function executeOrderedWithdrawals(
  targetSpending: number,
  accountBalances: Account[],
  profile: { age: number; filingStatus: FilingStatus; state: string },
  socialSecurityBenefit: number,
  rmdAmount: number,
  taxableGainRatio: number,
): {
  withdrawalTaxable: number;
  withdrawalTraditional: number;
  withdrawalRoth: number;
  withdrawalHSA: number;
  totalWithdrawn: number;
  totalTaxes: number;
  insufficientFunds: boolean;
  depositTaxable: number;
} {
  // Validate accounts have required fields
  for (const account of accountBalances) {
    if (!account.type) {
      throw new Error(`Account "${account.name}" (${account.id}) is missing required 'type' field. Cannot perform withdrawals without knowing account type.`);
    }
    if (account.taxable === undefined) {
      throw new Error(`Account "${account.name}" (${account.id}) is missing required 'taxable' field. Cannot determine withdrawal tax treatment.`);
    }
    if (account.balance === undefined || isNaN(account.balance) || !isFinite(account.balance)) {
      throw new Error(`Account "${account.name}" (${account.id}) has invalid balance: ${account.balance}`);
    }
    // Clamp negative balances to 0 (can happen from extreme market downturns)
    if (account.balance < 0) {
      account.balance = 0;
    }
  }

  const tolerance = 1;

  type Evaluation = {
    balances: Account[];
    withdrawalTaxable: number;
    withdrawalTraditional: number;
    withdrawalRoth: number;
    withdrawalHSA: number;
    totalWithdrawn: number;
    totalTaxes: number;
    cashAvailableAfterTax: number;
  };

  const evaluate = (voluntaryBudget: number): Evaluation => {
    const balances = accountBalances.map((account) => ({ ...account }));
    let withdrawalTaxable = 0;
    let withdrawalTraditional = 0;
    let withdrawalRoth = 0;
    let withdrawalHSA = 0;
    let qualifiedIncome = 0;

    // Mandatory distributions happen before the voluntary ordering and never
    // get replaced by another account type if Traditional assets are depleted.
    let rmdRemaining = rmdAmount;
    for (const account of balances) {
      if (account.type === 'Traditional' && account.balance > 0 && rmdRemaining > 0) {
        const withdrawal = Math.min(rmdRemaining, account.balance);
        account.balance -= withdrawal;
        withdrawalTraditional += withdrawal;
        rmdRemaining -= withdrawal;
      }
    }

    let remaining = Math.max(0, voluntaryBudget);
    for (const account of balances) {
      if (account.type === 'Taxable' && account.balance > 0 && remaining > 0) {
        const withdrawal = Math.min(remaining, account.balance);
        account.balance -= withdrawal;
        withdrawalTaxable += withdrawal;
        if (account.id !== SIMULATION_SURPLUS_CASH_ID) {
          qualifiedIncome += withdrawal * taxableGainRatio;
        }
        remaining -= withdrawal;
      }
    }
    for (const account of balances) {
      if (account.type === 'Traditional' && account.balance > 0 && remaining > 0) {
        const withdrawal = Math.min(remaining, account.balance);
        account.balance -= withdrawal;
        withdrawalTraditional += withdrawal;
        remaining -= withdrawal;
      }
    }
    for (const account of balances) {
      if (account.type === 'Roth' && account.balance > 0 && remaining > 0) {
        const withdrawal = Math.min(remaining, account.balance);
        account.balance -= withdrawal;
        withdrawalRoth += withdrawal;
        remaining -= withdrawal;
      }
    }
    for (const account of balances) {
      if (account.type === 'HSA' && account.balance > 0 && remaining > 0) {
        const withdrawal = Math.min(remaining, account.balance);
        account.balance -= withdrawal;
        withdrawalHSA += withdrawal;
        remaining -= withdrawal;
      }
    }

    const totalTaxes = calculateRetirementTax(
      withdrawalTraditional,
      socialSecurityBenefit,
      qualifiedIncome,
      profile.age,
      profile.filingStatus,
      profile.state,
    ).totalTax;
    const totalWithdrawn = withdrawalTaxable
      + withdrawalTraditional
      + withdrawalRoth
      + withdrawalHSA;
    return {
      balances,
      withdrawalTaxable,
      withdrawalTraditional,
      withdrawalRoth,
      withdrawalHSA,
      totalWithdrawn,
      totalTaxes,
      cashAvailableAfterTax: socialSecurityBenefit + totalWithdrawn - totalTaxes,
    };
  };

  const finish = (evaluation: Evaluation) => {
    for (let index = 0; index < accountBalances.length; index++) {
      accountBalances[index].balance = evaluation.balances[index].balance;
    }
    const difference = evaluation.cashAvailableAfterTax - targetSpending;
    return {
      withdrawalTaxable: evaluation.withdrawalTaxable,
      withdrawalTraditional: evaluation.withdrawalTraditional,
      withdrawalRoth: evaluation.withdrawalRoth,
      withdrawalHSA: evaluation.withdrawalHSA,
      totalWithdrawn: evaluation.totalWithdrawn,
      totalTaxes: evaluation.totalTaxes,
      insufficientFunds: difference < -tolerance,
      depositTaxable: difference > tolerance ? difference : 0,
    };
  };

  const forced = evaluate(0);
  if (forced.cashAvailableAfterTax + tolerance >= targetSpending) {
    return finish(forced);
  }

  const maxVoluntaryBudget = forced.balances.reduce(
    (sum, account) => sum + account.balance,
    0,
  );
  if (maxVoluntaryBudget <= 0) return finish(forced);

  // Find a funded upper bracket without starting at the entire portfolio;
  // this keeps the bisection fast even for very large balances.
  let low = 0;
  let high = Math.min(
    maxVoluntaryBudget,
    Math.max(1, (targetSpending - forced.cashAvailableAfterTax) * 2),
  );
  let best = evaluate(high);
  while (
    best.cashAvailableAfterTax + tolerance < targetSpending
    && high < maxVoluntaryBudget
  ) {
    low = high;
    high = Math.min(maxVoluntaryBudget, high * 2);
    best = evaluate(high);
  }
  if (best.cashAvailableAfterTax + tolerance < targetSpending) {
    return finish(best);
  }

  // After-tax cash is monotone in the voluntary withdrawal budget. Bisect to
  // the smallest funded withdrawal instead of relying on marginal-tax guesses.
  for (let iteration = 0; iteration < 48; iteration++) {
    if (Math.abs(best.cashAvailableAfterTax - targetSpending) <= tolerance) break;
    const midpoint = (low + high) / 2;
    const candidate = evaluate(midpoint);
    if (candidate.cashAvailableAfterTax + tolerance >= targetSpending) {
      high = midpoint;
      best = candidate;
    } else {
      low = midpoint;
    }
  }

  return finish(best);
}
