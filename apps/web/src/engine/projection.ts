import type {
  SimulationPlan,
  SimulationAccount,
  AccountType,
  PathResult,
  PathProjection,
  State,
} from '@/domain/types';
import {
  calculateWorkingCashFlow,
  calculateRetirementTax,
  householdOf,
  type ContributionPolicy,
  type Household,
} from './tax';
import { calculateSSABenefit } from './ssa';
import { calculateRmd } from './rmd';
import { rothConversionFor } from './roth-conversion';
import { getRmdStartAge } from '@/data/rmd-tables';
import { ageOn, birthYearOf, remainingYearFractionOf } from '@/domain/age';
import { MEDICARE_AGE } from '@/domain/constants';
import { healthcareCostFor } from '@/domain/healthcare';
import { HISTORICAL_RETURNS } from '@/data/market-history-annual';
import {
  ANNUAL_PORTFOLIO_FEE,
  MONTE_CARLO_DEFAULTS,
  generateCorrelatedReturns,
} from '@/data/market-history';
import seedrandom from 'seedrandom';

type ProjectionAccount = SimulationAccount & { isSurplusCash: boolean };

interface RothConversionLot {
  conversionYear: number;
  remainingPrincipal: number;
}

interface RothBasisState {
  /** False when conversions are off or the household cannot owe this penalty. */
  enabled: boolean;
  /** Existing Roth money and direct contributions retain the model's penalty-free assumption. */
  regularPrincipal: number;
  /** Conversion principal is consumed oldest-first under the statutory ordering rules. */
  conversionLots: RothConversionLot[];
  /** Sum of the still-unseasoned lots, cached so candidate penalties are O(1). */
  unseasonedPrincipal: number;
}

const BUCKET_ORDER: AccountType[] = ['Taxable', 'Traditional', 'Roth', 'HSA'];

/** Cash tolerance, in dollars, below which a shortfall is considered funded. */
const SHORTFALL_TOLERANCE = 1;

/**
 * Each pass of the shortfall loop leaves roughly the marginal tax rate plus the
 * penalty rate of the step before it, so the worst case a household can reach —
 * top federal plus NIIT plus California plus a 20% HSA penalty, near 0.74 — needs
 * this many passes to land inside the tolerance. Every pass but the last is
 * skipped in the common case, since the loop exits as soon as the year is funded.
 */
const SHORTFALL_PASSES = 50;

/**
 * Traditional money taken before 59½ owes this on top of ordinary income. Ages
 * here are whole years, which 59½ falls between, so the penalty is charged
 * through 59 and dropped at 60 — the side that overstates the cost rather than
 * the one that hands a household a year of free withdrawals.
 */
const DEFAULT_TERMINAL_TAX_RATE = 0.30;

const EARLY_TRADITIONAL_PENALTY_RATE = 0.10;
const TRADITIONAL_PENALTY_AGE = 60;

/** An HSA distribution that is not for medical care, taken before 65. */
const NON_QUALIFIED_HSA_PENALTY_RATE = 0.20;

/** Drain buckets in the withdrawal order until `amount` is raised or nothing is left. */
function withdrawInOrder(accounts: ProjectionAccount[], amount: number) {
  const drawn = { taxable: 0, traditional: 0, roth: 0, hsa: 0, gains: 0, total: 0 };
  let remaining = Math.max(0, amount);
  for (const type of BUCKET_ORDER) {
    if (remaining <= 0) break;
    const bucket = accounts.find((account) => account.type === type && account.balance > 0);
    if (!bucket) continue;
    const withdrawal = Math.min(remaining, bucket.balance);
    bucket.balance -= withdrawal;
    remaining -= withdrawal;
    drawn.total += withdrawal;
    if (type === 'Taxable') drawn.taxable += withdrawal;
    else if (type === 'Traditional') drawn.traditional += withdrawal;
    else if (type === 'Roth') drawn.roth += withdrawal;
    else drawn.hsa += withdrawal;
  }
  return drawn;
}

/**
 * Collapse accounts into one bucket per type. Splitting a balance across two
 * accounts of the same type must not change the projection, so weights blend by
 * balance; an empty bucket keeps the plain average so later deposits still land
 * at the intended allocation.
 */
function toBuckets(accounts: SimulationAccount[]): ProjectionAccount[] {
  const buckets: ProjectionAccount[] = [];
  for (const type of BUCKET_ORDER) {
    const members = accounts.filter((account) => account.type === type);
    if (members.length === 0) continue;
    const balance = members.reduce((sum, account) => sum + account.balance, 0);
    const stocks = balance > 0
      ? members.reduce((sum, a) => sum + a.balance * a.assetWeights.stocks, 0) / balance
      : members.reduce((sum, a) => sum + a.assetWeights.stocks, 0) / members.length;
    buckets.push({
      type,
      balance,
      assetWeights: { stocks, bonds: 1 - stocks },
      isSurplusCash: false,
    });
  }
  return buckets;
}

export interface ProjectionConfig {
  paths: number;
  seed: number;
}

export interface PathSummary {
  terminalWealth: number;
  success: boolean;
}

interface SweepProjectionScenario {
  plan: SimulationPlan;
}

/** Count successful paths for one path-index shard without retaining yearly rows. */
export function countSweepSuccesses(
  scenarios: readonly SweepProjectionScenario[],
  rootSeed: number,
  startPath: number,
  endPath: number,
): number[] {
  if (
    !Number.isSafeInteger(startPath)
    || !Number.isSafeInteger(endPath)
    || startPath < 0
    || endPath < startPath
  ) {
    throw new RangeError('Sweep shard bounds must be safe integers with 0 <= startPath <= endPath');
  }
  const successCounts = new Array<number>(scenarios.length).fill(0);
  for (let pathIndex = startPath; pathIndex < endPath; pathIndex++) {
    const pathSeed = rootSeed + pathIndex;
    for (let scenarioIndex = 0; scenarioIndex < scenarios.length; scenarioIndex++) {
      const result = projectScenarioSummary(
        scenarios[scenarioIndex].plan,
        { paths: 1, seed: pathSeed },
      );
      if (result.success) successCounts[scenarioIndex]++;
    }
  }
  return successCounts;
}

/** Generates market returns for single-year and block bootstrapping. */
export interface MarketReturnsGenerator {
  next(): { stockReturn: number; bondReturn: number };
}

/**
 * One deterministic path from the as-of date through life expectancy. Seeded
 * from the config, so the same seed reproduces the same path exactly.
 */
export function projectScenario(
  plan: SimulationPlan,
  config: ProjectionConfig
): PathResult {
  return projectScenarioInternal(plan, config, true);
}

/** Run the exact projection loop without retaining yearly cash-flow rows. */
export function projectScenarioSummary(
  plan: SimulationPlan,
  config: ProjectionConfig,
): PathSummary {
  const result = projectScenarioInternal(plan, config, false);
  return { terminalWealth: result.terminalWealth, success: result.success };
}

function projectScenarioInternal(
  plan: SimulationPlan,
  config: ProjectionConfig,
  recordProjections: boolean,
): PathResult {
  const { profile, accounts, socialSecurity } = plan;

  const currentYear = Number(profile.asOfDate.slice(0, 4));
  const birthYear = birthYearOf(profile.birthDate);
  const age = ageOn(profile.birthDate, profile.asOfDate);
  const rmdStartAge = getRmdStartAge(birthYear);
  const remainingYearFraction = remainingYearFractionOf(profile.asOfDate);
  
  // Life expectancy is inclusive: simulate from current age through that age.
  // Deriving this directly also supports people who are already retired.
  const totalYears = profile.lifeExpectancy - age + 1;

  const yearlyProjections: PathProjection[] = [];
  let success = true;

  const accountBalances: ProjectionAccount[] = toBuckets(accounts);
  const rothBasis: RothBasisState = {
    enabled: plan.assumptions.rothConversion.enabled
      && profile.retirementAge < TRADITIONAL_PENALTY_AGE
      && age < TRADITIONAL_PENALTY_AGE,
    regularPrincipal: balanceOfBucket(accountBalances, 'Roth'),
    conversionLots: [],
    unseasonedPrincipal: 0,
  };
  let currentPortfolioValue = accountBalances.reduce((sum, acc) => sum + acc.balance, 0);
  
  let previousYearTraditionalBalance = 0;
  /** Medical cost the HSA may still reimburse tax-free, carried year to year. */
  let hsaQualifiedAllowance = 0;
  // MAGI for each modeled year, which the next years' premiums are tested
  // against. Healthcare cost is priced before this year's withdrawals are
  // known, so both tests look backward: IRMAA because that is the law, the
  // marketplace credit because enrollment rests on an estimate made in advance.
  const magiByYear: number[] = [];
  const rng = createRNG(config.seed);
  const returnsGenerator = createMarketReturnsGenerator(plan, rng);
  
  for (let year = 0; year < totalYears; year++) {
    const currentAge = age + year;
    const taxYear = currentYear + year;
    const isRetired = currentAge >= profile.retirementAge;

    if (currentAge >= TRADITIONAL_PENALTY_AGE && rothBasis.enabled) {
      rothBasis.enabled = false;
      rothBasis.regularPrincipal = 0;
      rothBasis.conversionLots = [];
      rothBasis.unseasonedPrincipal = 0;
    } else if (rothBasis.enabled) {
      seasonRothConversions(rothBasis, taxYear);
    }

    
    // An RMD is assessed on the prior year-end balance, which the first
    // modeled year does not have.
    let rmdAmount = 0;
    if (currentAge >= rmdStartAge) {
      const balanceForRmd = previousYearTraditionalBalance > 0 
        ? previousYearTraditionalBalance
        : accountBalances
            .filter(acc => acc.type === 'Traditional')
            .reduce((sum, acc) => sum + acc.balance, 0);
      rmdAmount = calculateRmd(balanceForRmd, currentAge, rmdStartAge);
    }
    
    const annualSalary = profile.currentSalary * Math.pow(1 + profile.salaryGrowthRate, year);
    let income = 0;
    let spending = 0;
    let taxes = 0;
    let savings = 0;
    let socialSecurityBenefit = 0;
    
    let withdrawalTaxableYear = 0;
    let withdrawalTraditionalYear = 0;
    let withdrawalRothYear = 0;
    let withdrawalHSAYear = 0;
    let depositTaxableYear = 0;
    let depositTraditionalYear = 0;
    let depositRothYear = 0;
    let depositHSAYear = 0;
    let insufficientFundsYear = false;
    let healthcareCostYear = 0;
    let rothConversionYear = 0;
    let conversionTaxFromTaxable = 0;
    let conversionTaxWithheld = 0;
    
    if (!isRetired) {
      // Working phase saves the residual: gross income less taxes and spending.
      // Contributions fill statutory limits HSA → Traditional → Roth, and the
      // taxable bucket absorbs the rest.
      const annualWorkingSpending = profile.currentSpending
        * Math.pow(1 + profile.workingSpendingGrowthRate, year);
      const policy: ContributionPolicy = {
        hsaEligible: plan.assumptions.hsaEligible ?? false,
        useBackdoorRoth: plan.assumptions.useBackdoorRoth ?? true,
      };
      const periodFraction = year === 0 ? remainingYearFraction : 1;

      const yearlyReturns = returnsGenerator.next();


      for (const account of accountBalances) {
        const accountReturn =
          account.assetWeights.stocks * yearlyReturns.stockReturn +
          account.assetWeights.bonds * yearlyReturns.bondReturn
          - ANNUAL_PORTFOLIO_FEE;

        const effectiveReturn = year === 0 ? accountReturn * remainingYearFraction : accountReturn;
        account.balance *= (1 + effectiveReturn);
        // An extreme drawdown can drive the weighted return below -100%.
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
      const taxableGainRatio = plan.assumptions.taxableGainRatio ?? 0.5;
      // An early-withdrawal penalty is cash out the door, not a tax on income,
      // so the cash-flow model sees it the way it sees spending: it shrinks
      // what is left to invest and widens the gap the portfolio has to close.
      const cashFlowWith = (penalties: number, ordinary: number, qualified: number) =>
        calculateWorkingCashFlow({
          grossIncome: annualSalary,
          annualSpending: annualWorkingSpending + penalties / periodFraction,
          household: householdOf(profile.filingStatus, currentAge),
          state: profile.state,
          taxYear,
          policy,
          other: { ordinary, qualified },
        });
      let workingCashFlow = cashFlowWith(0, annualizedRmdIncome, 0);

      // Spending above after-tax income is funded from the portfolio, exactly as
      // it is in retirement — it is a drawdown, not a failure. Traditional
      // withdrawals are ordinary income and taxable withdrawals realize gains,
      // so each pass re-converges the tax the withdrawal itself creates.
      // Each draw creates income, which raises the gap, which needs a further
      // draw. The step shrinks by roughly the marginal rate each pass, so this
      // converges quickly — but it has to actually converge, because the
      // remainder left over is what decides whether the year was funded. Hence
      // signed `netCashFlow` rather than a gap floored at zero: once the gap
      // closes, a zero floor hides the cash a draw still owes and asks for
      // another draw, which owes more again.
      let shortfallPrincipal = 0;
      let shortfallGains = 0;
      let workingPenalties = 0;
      for (let pass = 0; pass < SHORTFALL_PASSES; pass++) {
        const remaining = Math.max(
          0,
          -workingCashFlow.netCashFlow * periodFraction - shortfallPrincipal,
        );
        if (remaining <= SHORTFALL_TOLERANCE) break;
        const drawn = withdrawInOrder(accountBalances, remaining);
        if (drawn.total <= SHORTFALL_TOLERANCE) break; // portfolio exhausted
        withdrawalTaxableYear += drawn.taxable;
        withdrawalTraditionalYear += drawn.traditional;
        withdrawalRothYear += drawn.roth;
        withdrawalHSAYear += drawn.hsa;
        // Traditional and HSA reach the cash-flow model as income; only the
        // buckets it never sees are principal it has to be credited with.
        workingPenalties += penaltiesOn(drawn.traditional, drawn.hsa, 0, currentAge);
        shortfallPrincipal += drawn.taxable + drawn.roth;
        shortfallGains += drawn.taxable * taxableGainRatio;
        workingCashFlow = cashFlowWith(
          workingPenalties,
          // A working-year HSA draw is not paying a modeled medical cost, so it
          // is an ordinary distribution rather than a tax-free one.
          (withdrawalTraditionalYear + withdrawalHSAYear) / periodFraction,
          shortfallGains / periodFraction,
        );
      }

      // The shortfall that survived every draw — measured once, after the loop,
      // rather than left holding whatever the last pass tried.
      const unfunded = Math.max(
        0,
        -workingCashFlow.netCashFlow * periodFraction - shortfallPrincipal,
      );

      const taxResult = workingCashFlow.tax;
      // Only true ruin counts as failure: the portfolio could not cover the gap.
      insufficientFundsYear = unfunded > SHORTFALL_TOLERANCE;
      income = annualSalary * periodFraction;
      spending = annualWorkingSpending * periodFraction - unfunded;
      taxes = taxResult.totalTax * periodFraction + workingPenalties;
      if (rothBasis.enabled) {
        rothBasis.regularPrincipal = Math.max(
          0,
          rothBasis.regularPrincipal - withdrawalRothYear,
        );
      }

      // The residual is fully invested, so the buckets receive all of it and
      // nothing is left unallocated. First year prorates like every other flow.
      const { contributions } = workingCashFlow;
      depositHSAYear = depositToBucket(
        accountBalances, 'HSA', contributions.hsa * periodFraction,
      );
      depositTraditionalYear = depositToBucket(
        accountBalances, 'Traditional', contributions.traditional * periodFraction,
      );
      depositRothYear = depositToBucket(
        accountBalances, 'Roth', contributions.roth * periodFraction,
      );
      if (rothBasis.enabled) rothBasis.regularPrincipal += depositRothYear;
      depositTaxableYear = depositToBucket(
        accountBalances, 'Taxable', contributions.taxable * periodFraction,
      );

      savings = depositTaxableYear
        + depositTraditionalYear
        + depositRothYear
        + depositHSAYear
        - withdrawalTaxableYear
        - withdrawalTraditionalYear
        - withdrawalRothYear
        - withdrawalHSAYear;
      
      currentPortfolioValue = accountBalances.reduce((sum, acc) => sum + acc.balance, 0);

    } else {
      const retirementPeriodFraction = year === 0 ? remainingYearFraction : 1;
      // The retirement target is the first modeled retirement year's real
      // spending. Growth begins only in the following modeled retirement year.
      // Already-retired plans also start at exponent zero on their as-of date.
      const retirementStartYear = Math.max(0, profile.retirementAge - age);
      const yearsRetired = year - retirementStartYear;
      const healthcare = healthcareCostFor(
        profile.retirementHealthcare,
        currentAge,
        year,
        {
          priorYearMagi: magiByYear[year - 1],
          irmaaLookbackMagi: magiByYear[year - 2],
          filingStatus: profile.filingStatus,
          householdSize: householdOf(profile.filingStatus, currentAge).ages.length,
        },
      );
      healthcareCostYear = healthcare.total * retirementPeriodFraction;
      // Medical spending is what an HSA can cover tax-free, and the allowance
      // carries forward: an HSA has no reimbursement deadline, and this bucket
      // is drained last, so by the time it is touched the allowance is large.
      hsaQualifiedAllowance += healthcare.qualified * retirementPeriodFraction;
      const targetSpending = profile.retirementSpending
        * Math.pow(1 + profile.retirementSpendingGrowthRate, yearsRetired)
        * retirementPeriodFraction
        + healthcareCostYear;

      if (socialSecurity.enabled && currentAge >= socialSecurity.claimAge) {
        const annualSocialSecurityBenefit = socialSecurity.manualOverride
          ? Math.max(0, socialSecurity.estimatedBenefit ?? 0)
          : calculateSSABenefit(
              estimateSalaryHistory(
                profile.currentSalary,
                profile.salaryGrowthRate,
                age,
                profile.retirementAge,
              ),
              socialSecurity.claimAge,
              birthYear,
            ).annualBenefit;
        socialSecurityBenefit = annualSocialSecurityBenefit * retirementPeriodFraction;
      }

      const yearlyReturns = returnsGenerator.next();

      for (const account of accountBalances) {
        const accountReturn =
          account.assetWeights.stocks * yearlyReturns.stockReturn +
          account.assetWeights.bonds * yearlyReturns.bondReturn
          - ANNUAL_PORTFOLIO_FEE;

        const effectiveReturn = year === 0 ? accountReturn * remainingYearFraction : accountReturn;
        account.balance *= (1 + effectiveReturn);
        // An extreme drawdown can drive the weighted return below -100%.
        account.balance = Math.max(0, account.balance);
      }

      rmdAmount *= retirementPeriodFraction;
      const { withdrawalTaxable, withdrawalTraditional, withdrawalRoth, withdrawalHSA, totalWithdrawn, totalTaxes, insufficientFunds, depositTaxable, hsaQualifiedUsed } =
        executeOrderedWithdrawals(
          targetSpending,
          accountBalances,
          rothBasis,
          {
            household: householdOf(profile.filingStatus, currentAge),
            state: profile.state,
            taxYear,
            age: currentAge,
          },
          socialSecurityBenefit,
          rmdAmount,
          plan.assumptions.taxableGainRatio ?? 0.5,
          hsaQualifiedAllowance,
        );

      // An RMD is forced out of the account, not spent, so what the year
      // does not need is reinvested.
      if (depositTaxable > 0) {
        depositToBucket(accountBalances, 'Taxable', depositTaxable);
        depositTaxableYear = depositTaxable;
      }

      taxes = totalTaxes;

      // Converting after the year's spending is funded is both the realistic
      // order — the amount is chosen in December, once income is known — and
      // the only one that cannot overfill the ceiling, since every dollar of
      // ordinary income the year will report has already been realized.
      // A year that could not fund itself has nothing spare to convert with.
      if (currentAge < rmdStartAge && !insufficientFunds) {
        const conversion = rothConversionFor({
          policy: plan.assumptions.rothConversion,
          traditionalWithdrawals: withdrawalTraditional,
          socialSecurityBenefit,
          qualifiedIncome: withdrawalTaxable * (plan.assumptions.taxableGainRatio ?? 0.5),
          taxableWithdrawals: withdrawalTaxable,
          taxableGainRatio: plan.assumptions.taxableGainRatio ?? 0.5,
          household: householdOf(profile.filingStatus, currentAge),
          state: profile.state,
          taxYear,
          traditionalBalance: balanceOfBucket(accountBalances, 'Traditional'),
          taxableBalance: balanceOfBucket(accountBalances, 'Taxable'),
        });
        if (conversion.converted > 0) {
          drawFromBucket(accountBalances, 'Traditional', conversion.converted);
          drawFromBucket(accountBalances, 'Taxable', conversion.fromTaxable);
          depositToBucket(accountBalances, 'Roth', conversion.converted - conversion.withheld);
          // What reached the Roth. Tax withheld out of a conversion never gets
          // there, so it is reported as the ordinary distribution it is —
          // which also keeps the two figures from double-counting a dollar.
          rothConversionYear = conversion.converted - conversion.withheld;
          if (rothBasis.enabled) {
            rothBasis.conversionLots.push({
              conversionYear: taxYear,
              remainingPrincipal: rothConversionYear,
            });
            rothBasis.unseasonedPrincipal += rothConversionYear;
          }
          conversionTaxFromTaxable = conversion.fromTaxable;
          conversionTaxWithheld = conversion.withheld;
          taxes += conversion.tax;
        }
      }

      hsaQualifiedAllowance -= hsaQualifiedUsed;
      withdrawalTaxableYear = withdrawalTaxable + conversionTaxFromTaxable;
      withdrawalTraditionalYear = withdrawalTraditional + conversionTaxWithheld;
      withdrawalRothYear = withdrawalRoth;
      withdrawalHSAYear = withdrawalHSA;
      insufficientFundsYear = insufficientFunds;

      spending = insufficientFunds
        ? Math.max(0, totalWithdrawn - totalTaxes - depositTaxable + socialSecurityBenefit)
        : targetSpending;

      income = socialSecurityBenefit;
      savings = depositTaxable - totalWithdrawn - conversionTaxFromTaxable
        - conversionTaxWithheld;

      currentPortfolioValue = accountBalances.reduce((sum, acc) => sum + acc.balance, 0);
    }
    
    previousYearTraditionalBalance = accountBalances
      .filter(acc => acc.type === 'Traditional')
      .reduce((sum, acc) => sum + acc.balance, 0);
    
    // `income` is wages while working and the whole benefit once retired.
    // That is the ACA definition, which adds untaxed Social Security back;
    // IRMAA counts only the taxable part, so this runs high by the untaxed
    // remainder. At the income a surcharge starts from, 85% of the benefit is
    // taxable anyway, and erring high charges the surcharge sooner.
    magiByYear[year] = income
      + withdrawalTraditionalYear
      + rothConversionYear
      + withdrawalTaxableYear * (plan.assumptions.taxableGainRatio ?? 0.5);

    if (insufficientFundsYear) success = false;
    if (recordProjections) {
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
        rothConversion: rothConversionYear,
        depositTaxable: depositTaxableYear,
        depositTraditional: depositTraditionalYear,
        depositRoth: depositRothYear,
        depositHSA: depositHSAYear,
        // Outcome cohorts average this field, so cap it on the individual path
        // before aggregation. Capping cohort means later would misclassify the
        // living/healthcare split when only some paths are underfunded.
        healthcareCost: Math.min(healthcareCostYear, Math.max(0, spending)),
        insufficientFunds: insufficientFundsYear,
      });
    }
  }
  
  const finalWealth = currentPortfolioValue;
  return {
    terminalWealth: finalWealth,
    afterTaxTerminalWealth: afterTaxWealthOf(
      accountBalances,
      plan.assumptions.terminalTaxRate ?? DEFAULT_TERMINAL_TAX_RATE,
    ),
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
    this.prng = seedrandom(seed.toString());
  }

  next(): number {
    return this.prng();
  }

  normal(mean = 0, std = 1): number {
    // Box-Muller produces two normals per pass; the second is kept for the
    // next call rather than discarded.
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

    if (df <= 0) {
      throw new Error(`Invalid degrees of freedom: ${df}`);
    }

    // Student's t converges to the normal above about 30 degrees of freedom.
    if (df > 30) {
      return this.normal(mean, scale);
    }

    // t = Z / sqrt(V/df), where Z ~ N(0,1) and V ~ chi^2(df).
    const z = this.normal();

    let chiSquare = 0;
    const n = Math.floor(df);
    for (let i = 0; i < n; i++) {
      const u = this.normal();
      chiSquare += u * u;
    }

    if (df !== n) {
      const u = this.normal();
      chiSquare += (df - n) * u * u;
    }

    if (chiSquare <= 0) {
      chiSquare = 1e-10;
    }

    const t = z / Math.sqrt(chiSquare / df);

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
    
    this.currentBlock = [];
    for (let i = 0; i < this.blockSize; i++) {
      const yearData = HISTORICAL_RETURNS[(startIndex + i) % HISTORICAL_RETURNS.length];
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
export function createMarketReturnsGenerator(plan: SimulationPlan, rng: SeededRNG): MarketReturnsGenerator {
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
/**
 * Deposit into a type's bucket, opening it when the household holds no account
 * of that kind — funding must never depend on which accounts happen to exist.
 * A new bucket inherits the portfolio's blend so the money is invested the way
 * the rest of it is; with nothing to blend it stays in cash, which is also what
 * keeps that balance out of the taxable-gain calculation.
 *
 * @returns the amount deposited, for the caller's cash-flow row
 */
/**
 * What the portfolio is worth once the tax nobody has paid yet is settled.
 *
 * Traditional and HSA balances are income in respect of a decedent: no step-up
 * in basis, and ordinary rates on every dollar. Taxable and Roth pass through
 * whole — an inherited taxable account steps its basis up to date-of-death
 * value, and a Roth owes nothing either way. Counting all four at face value
 * would credit a pre-tax-heavy plan for money it does not own, which is
 * exactly the comparison a conversion setting exists to make.
 */
function afterTaxWealthOf(accounts: ProjectionAccount[], terminalTaxRate: number): number {
  return accounts.reduce((sum, account) => {
    const taxed = account.type === 'Traditional' || account.type === 'HSA';
    return sum + account.balance * (taxed ? 1 - terminalTaxRate : 1);
  }, 0);
}

function balanceOfBucket(accounts: ProjectionAccount[], type: AccountType): number {
  return accounts
    .filter((account) => account.type === type)
    .reduce((sum, account) => sum + account.balance, 0);
}

/** Take `amount` from one bucket, or whatever of it that bucket holds. */
function drawFromBucket(
  accounts: ProjectionAccount[],
  type: AccountType,
  amount: number,
): number {
  if (amount <= 0) return 0;
  const bucket = accounts.find((account) => account.type === type);
  if (!bucket) return 0;
  const drawn = Math.min(amount, bucket.balance);
  bucket.balance -= drawn;
  return drawn;
}

function depositToBucket(
  accounts: ProjectionAccount[],
  type: AccountType,
  amount: number,
): number {
  if (amount <= 0) return 0;
  const bucket = accounts.find((account) => account.type === type);
  if (bucket) {
    bucket.balance += amount;
    return amount;
  }

  const total = accounts.reduce((sum, account) => sum + account.balance, 0);
  const stocks = total > 0
    ? accounts.reduce((sum, a) => sum + a.balance * a.assetWeights.stocks, 0) / total
    : 0;
  accounts.push({
    type,
    balance: amount,
    assetWeights: { stocks, bonds: total > 0 ? 1 - stocks : 0 },
    isSurplusCash: total === 0,
  });
  return amount;
}

/**
 * Money taken out of a retirement wrapper too early owes a penalty on top of
 * ordinary income tax. Taxable was never sheltered. Roth conversion principal
 * has its own five-tax-year clock, tracked separately below.
 */
function penaltiesOn(
  traditionalWithdrawal: number,
  nonQualifiedHsaWithdrawal: number,
  rothConversionPenalty: number,
  age: number,
): number {
  const traditionalPenalty = age < TRADITIONAL_PENALTY_AGE
    ? traditionalWithdrawal * EARLY_TRADITIONAL_PENALTY_RATE
    : 0;
  const hsaPenalty = age < MEDICARE_AGE
    ? nonQualifiedHsaWithdrawal * NON_QUALIFIED_HSA_PENALTY_RATE
    : 0;
  return traditionalPenalty + hsaPenalty + rothConversionPenalty;
}

/**
 * Apply Roth distribution ordering to the part of a withdrawal whose basis the
 * model knows: regular contributions first, then conversions oldest-first.
 * Existing Roth money remains penalty-free because the plan does not collect
 * its contribution basis. Each new conversion, however, has an exact amount
 * and year, so withdrawing it before its fifth anniversary and before age 60
 * incurs the modeled 10% early-distribution penalty.
 */
function rothConversionPenaltyFor(
  withdrawal: number,
  state: Readonly<RothBasisState>,
  age: number,
): number {
  if (!state.enabled || withdrawal <= 0 || age >= TRADITIONAL_PENALTY_AGE) return 0;
  const conversionPrincipal = Math.min(
    Math.max(0, withdrawal - state.regularPrincipal),
    state.unseasonedPrincipal,
  );
  return conversionPrincipal * EARLY_TRADITIONAL_PENALTY_RATE;
}

/** Move five-year-old conversion principal into the penalty-free basis pool. */
function seasonRothConversions(state: RothBasisState, taxYear: number): void {
  while (
    state.conversionLots.length > 0
    && taxYear >= state.conversionLots[0].conversionYear + 5
  ) {
    const lot = state.conversionLots.shift()!;
    state.unseasonedPrincipal = Math.max(
      0,
      state.unseasonedPrincipal - lot.remainingPrincipal,
    );
    state.regularPrincipal += lot.remainingPrincipal;
  }
}

/** Commit the selected withdrawal to the basis ledger after bisection finishes. */
function consumeRothBasis(withdrawal: number, state: RothBasisState): void {
  if (!state.enabled || withdrawal <= 0) return;
  let remaining = withdrawal;
  const regularUsed = Math.min(remaining, state.regularPrincipal);
  state.regularPrincipal -= regularUsed;
  remaining -= regularUsed;
  const conversionPrincipalUsed = Math.min(remaining, state.unseasonedPrincipal);
  state.unseasonedPrincipal = Math.max(
    0,
    state.unseasonedPrincipal - conversionPrincipalUsed,
  );

  for (const lot of state.conversionLots) {
    if (remaining <= 0) break;
    const used = Math.min(remaining, lot.remainingPrincipal);
    lot.remainingPrincipal -= used;
    remaining -= used;
  }
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
  accountBalances: ProjectionAccount[],
  rothBasis: RothBasisState,
  profile: { household: Household; state: State; taxYear: number; age: number },
  socialSecurityBenefit: number,
  rmdAmount: number,
  taxableGainRatio: number,
  hsaQualifiedAllowance: number,
): {
  hsaQualifiedUsed: number;
  withdrawalTaxable: number;
  withdrawalTraditional: number;
  withdrawalRoth: number;
  withdrawalHSA: number;
  totalWithdrawn: number;
  totalTaxes: number;
  insufficientFunds: boolean;
  depositTaxable: number;
} {
  for (const [index, account] of accountBalances.entries()) {
    if (account.balance === undefined || isNaN(account.balance) || !isFinite(account.balance)) {
      throw new Error(`Account ${index + 1} has invalid balance: ${account.balance}`);
    }
    // An extreme drawdown can drive the weighted return below -100%.
    if (account.balance < 0) {
      account.balance = 0;
    }
  }

  const tolerance = 1;

  type Evaluation = {
    balances: ProjectionAccount[];
    withdrawalTaxable: number;
    withdrawalTraditional: number;
    withdrawalRoth: number;
    withdrawalHSA: number;
    totalWithdrawn: number;
    totalTaxes: number;
    cashAvailableAfterTax: number;
    hsaQualifiedUsed: number;
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
        if (!account.isSurplusCash) {
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

    const rothConversionPenalty = rothBasis.enabled && withdrawalRoth > 0
      ? rothConversionPenaltyFor(
          withdrawalRoth,
          rothBasis,
          profile.age,
        )
      : 0;

    // An HSA pays medical costs tax-free; anything beyond them is an ordinary
    // distribution, and before 65 it carries a penalty as well.
    const hsaQualifiedUsed = Math.min(withdrawalHSA, hsaQualifiedAllowance);
    const nonQualifiedHsa = withdrawalHSA - hsaQualifiedUsed;

    const tax = calculateRetirementTax({
      traditionalWithdrawals: withdrawalTraditional + nonQualifiedHsa,
      socialSecurityBenefit,
      qualifiedIncome,
      household: profile.household,
      state: profile.state,
      taxYear: profile.taxYear,
    }).totalTax;
    const penalties = penaltiesOn(
      withdrawalTraditional,
      nonQualifiedHsa,
      rothConversionPenalty,
      profile.age,
    );
    const totalTaxes = tax + penalties;
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
      hsaQualifiedUsed,
    };
  };

  const finish = (evaluation: Evaluation) => {
    for (let index = 0; index < accountBalances.length; index++) {
      accountBalances[index].balance = evaluation.balances[index].balance;
    }
    if (rothBasis.enabled && evaluation.withdrawalRoth > 0) {
      consumeRothBasis(evaluation.withdrawalRoth, rothBasis);
      rothBasis.conversionLots = rothBasis.conversionLots.filter(
        (lot) => lot.remainingPrincipal > 0,
      );
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
      hsaQualifiedUsed: evaluation.hsaQualifiedUsed,
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
