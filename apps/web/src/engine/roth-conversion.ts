import type {
  FilingStatus,
  RothConversionCeiling,
  RothConversionPolicy,
  State,
} from '@/domain/types';
import { FEDERAL_TAX_BRACKETS_2025 } from '@/data/tax-brackets-2025';
import { irmaaFreeMagiCeiling } from '@/data/healthcare-premiums';
import { calculateRetirementTax, type Household } from './tax';

/**
 * Ceilings are expressed in the same real dollars the rest of the projection
 * uses. Federal brackets and IRMAA tiers are both inflation-indexed, so their
 * 2025 and 2026 tables stand unadjusted for every modeled year — unlike the
 * Social Security thresholds, which are frozen in nominal dollars and are
 * deflated where they are applied.
 */
const CEILING_BRACKET_RATE: Record<Exclude<RothConversionCeiling, 'irmaaTier'>, number> = {
  bracket12: 0.12,
  bracket22: 0.22,
  bracket24: 0.24,
  bracket32: 0.32,
};

function bracketTopFor(rate: number, filingStatus: FilingStatus): number {
  const bracket = FEDERAL_TAX_BRACKETS_2025[filingStatus].find((b) => b.rate === rate);
  if (!bracket || bracket.max === null) {
    throw new RangeError(`No bounded federal bracket at rate ${rate} for ${filingStatus}`);
  }
  return bracket.max;
}

export interface RothConversionInput {
  policy: RothConversionPolicy;
  /** Ordinary income the year has already realized, before any conversion. */
  traditionalWithdrawals: number;
  socialSecurityBenefit: number;
  qualifiedIncome: number;
  /** Taxable-account withdrawals, which reach MAGI at the plan's gain ratio. */
  taxableWithdrawals: number;
  taxableGainRatio: number;
  household: Household;
  state: State;
  taxYear: number;
  traditionalBalance: number;
  taxableBalance: number;
}

export interface RothConversionResult {
  /** Pre-tax dollars leaving the Traditional bucket. */
  converted: number;
  /** Tax the conversion adds to the year, over and above its other tax. */
  tax: number;
  /** Tax funded by selling from taxable, which keeps the Roth whole. */
  fromTaxable: number;
  /** Tax withheld out of the conversion, so those dollars never reach the Roth. */
  withheld: number;
}

const NONE: RothConversionResult = { converted: 0, tax: 0, fromTaxable: 0, withheld: 0 };

/**
 * The loop shrinks its error by roughly a gain share times a marginal rate each
 * pass, so four settle any balance this model can hold to a few dollars — well
 * inside the resolution of the ceilings being aimed at.
 */
const SETTLING_PASSES = 4;

/**
 * Cap on root-finding steps. False position resolves a piecewise-linear measure
 * in a handful; the cap only matters if a kink lands badly, and the bisection
 * safeguard below keeps even that case converging.
 */
const SOLVE_STEPS = 24;

/** Whole dollars is the answer's resolution, so a narrower bracket is waste. */
const SOLVE_TOLERANCE = 1;

/**
 * A conversion and everything that follows from its size: what it costs, which
 * dollars pay for it, and the capital gain those dollars realize on the way out.
 *
 * Paying the bill from taxable is what makes the trade worth doing — every
 * converted dollar then compounds tax-free — so taxable funds it while it
 * lasts, and only the remainder is withheld from the conversion itself.
 *
 * Selling to pay is a taxable event of its own, and the gain it realizes feeds
 * back into the tax that prompted the sale. Each pass closes more of that loop.
 */
function outcomeOf(conversion: number, input: RothConversionInput, baseTax: number) {
  const taxableBalance = Math.max(0, input.taxableBalance);
  let qualifiedIncome = input.qualifiedIncome;
  let tax = 0;
  let fromTaxable = 0;

  for (let pass = 0; pass < SETTLING_PASSES; pass++) {
    tax = Math.max(0, taxOf(conversion, qualifiedIncome, input) - baseTax);
    fromTaxable = Math.min(tax, taxableBalance);
    qualifiedIncome = input.qualifiedIncome + fromTaxable * input.taxableGainRatio;
  }

  return {
    tax,
    fromTaxable,
    withheld: Math.min(conversion, tax - fromTaxable),
    /** Gain realized selling to pay, which counts toward MAGI like any other. */
    fundingGain: fromTaxable * input.taxableGainRatio,
  };
}

/**
 * The largest conversion a year can absorb without breaching its ceiling, and
 * what that conversion costs.
 *
 * Headroom is solved rather than subtracted because a converted dollar does not
 * raise the measured quantity by a dollar. Against a bracket top it drags more
 * of the Social Security benefit into taxable income; against either ceiling it
 * also forces the sale that pays its own tax, and the gain on that sale counts
 * too. Each candidate is measured against the sale it would itself require, so
 * the amount that gets reported is one the ceiling has already been checked
 * against — which matters most for the IRMAA ceiling, where a dollar over buys
 * a whole tier and there is no partial credit for being close.
 *
 * Both measures rise monotonically with the amount converted, so the root is
 * bracketed from the start and the search only has to narrow it.
 */
export function rothConversionFor(input: RothConversionInput): RothConversionResult {
  const { policy, traditionalBalance } = input;
  if (!policy.enabled || traditionalBalance <= 0) return NONE;

  const baseTax = taxOf(0, input.qualifiedIncome, input);
  const limit = ceilingOf(input);
  // How far a candidate sits over its ceiling, negative while it still fits.
  const gapAt = (conversion: number) => measureOf(
    conversion,
    outcomeOf(conversion, input, baseTax).fundingGain,
    input,
  ) - limit;

  if (gapAt(0) >= 0) return NONE;
  if (gapAt(traditionalBalance) <= 0) return settle(traditionalBalance, input, baseTax);

  // Ordinary income cannot outrun the ceiling by more than the untaxed benefit
  // and the deductions sitting under it, so the search never needs a wider
  // bracket to start from.
  //
  // Both measures are piecewise linear in the amount converted — progressive
  // brackets and the Social Security phase-in are each a run of straight
  // segments — so interpolating between the bracket's ends lands on or very
  // near the root instead of merely halving the interval. Every other step
  // bisects regardless, which bounds the worst case when a kink falls between
  // the two ends and interpolation would otherwise crawl.
  let low = 0;
  let lowGap = gapAt(low);
  let high = Math.min(traditionalBalance, 2 * limit + input.socialSecurityBenefit);
  let highGap = gapAt(high);

  for (let step = 0; step < SOLVE_STEPS && high - low > SOLVE_TOLERANCE; step++) {
    const interpolate = step % 2 === 0 && highGap > lowGap;
    const guess = interpolate
      ? low + ((high - low) * -lowGap) / (highGap - lowGap)
      : (low + high) / 2;
    // Interpolation can land on an endpoint; nudge inside so the bracket shrinks.
    const mid = Math.min(Math.max(guess, low + (high - low) / 64), high - (high - low) / 64);

    const gap = gapAt(mid);
    if (gap <= 0) {
      low = mid;
      lowGap = gap;
    } else {
      high = mid;
      highGap = gap;
    }
  }

  // Whole dollars, rounded down. Nobody converts a fraction of a cent, and
  // pinning the result to an integer is what lets the two engines agree
  // exactly: bisection alone lands them a hair apart on the same root.
  return settle(Math.floor(low), input, baseTax);
}

function ceilingOf(input: RothConversionInput): number {
  const { policy, household } = input;
  return policy.ceiling === 'irmaaTier'
    ? irmaaFreeMagiCeiling(household.filingStatus)
    : bracketTopFor(CEILING_BRACKET_RATE[policy.ceiling], household.filingStatus);
}

function measureOf(
  conversion: number,
  fundingGain: number,
  input: RothConversionInput,
): number {
  if (input.policy.ceiling === 'irmaaTier') {
    // Mirrors how the projection reports MAGI: the whole benefit, every
    // ordinary withdrawal, and the gain portion of what taxable paid out.
    return input.socialSecurityBenefit
      + input.traditionalWithdrawals
      + conversion
      + input.taxableWithdrawals * input.taxableGainRatio
      + fundingGain;
  }

  return calculateRetirementTax({
    traditionalWithdrawals: input.traditionalWithdrawals + conversion,
    socialSecurityBenefit: input.socialSecurityBenefit,
    qualifiedIncome: input.qualifiedIncome + fundingGain,
    household: input.household,
    state: input.state,
    taxYear: input.taxYear,
  }).taxableIncome;
}

function taxOf(conversion: number, qualifiedIncome: number, input: RothConversionInput): number {
  return calculateRetirementTax({
    traditionalWithdrawals: input.traditionalWithdrawals + conversion,
    socialSecurityBenefit: input.socialSecurityBenefit,
    qualifiedIncome,
    household: input.household,
    state: input.state,
    taxYear: input.taxYear,
  }).totalTax;
}

function settle(
  converted: number,
  input: RothConversionInput,
  baseTax: number,
): RothConversionResult {
  if (converted <= 0) return NONE;
  const { tax, fromTaxable, withheld } = outcomeOf(converted, input, baseTax);
  return { converted, tax, fromTaxable, withheld };
}
