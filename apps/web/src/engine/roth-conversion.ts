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
 * The largest conversion a year can absorb without breaching its ceiling, and
 * what that conversion costs.
 *
 * Headroom is solved rather than subtracted because a converted dollar does not
 * raise the measured quantity by a dollar: against a bracket top it also drags
 * more of the Social Security benefit into taxable income, so the ceiling binds
 * before a naive subtraction says it should. Bisection handles both ceilings
 * with one code path, since each measure rises monotonically with the amount
 * converted.
 */
export function rothConversionFor(input: RothConversionInput): RothConversionResult {
  const { policy, traditionalBalance } = input;
  if (!policy.enabled || traditionalBalance <= 0) return NONE;

  const { limit, measure } = ceilingOf(input);
  if (measure(0) >= limit) return NONE;
  if (measure(traditionalBalance) <= limit) {
    return settle(traditionalBalance, input);
  }

  let low = 0;
  let high = traditionalBalance;
  for (let i = 0; i < 32; i++) {
    const mid = (low + high) / 2;
    if (measure(mid) <= limit) low = mid;
    else high = mid;
  }
  // Whole dollars, rounded down. Nobody converts a fraction of a cent, and
  // pinning the result to an integer is what lets the two engines agree
  // exactly: bisection alone lands them a hair apart on the same root.
  return settle(Math.floor(low), input);
}

function ceilingOf(input: RothConversionInput): {
  limit: number;
  measure: (conversion: number) => number;
} {
  const { policy, household, taxableWithdrawals, taxableGainRatio } = input;

  if (policy.ceiling === 'irmaaTier') {
    // Mirrors how the projection reports MAGI: the whole benefit, every
    // ordinary withdrawal, and the gain portion of what taxable paid out.
    const base = input.socialSecurityBenefit
      + input.traditionalWithdrawals
      + taxableWithdrawals * taxableGainRatio;
    return {
      limit: irmaaFreeMagiCeiling(household.filingStatus),
      measure: (conversion) => base + conversion,
    };
  }

  return {
    limit: bracketTopFor(CEILING_BRACKET_RATE[policy.ceiling], household.filingStatus),
    measure: (conversion) => taxOf(conversion, input).taxableIncome,
  };
}

function taxOf(conversion: number, input: RothConversionInput) {
  return calculateRetirementTax({
    traditionalWithdrawals: input.traditionalWithdrawals + conversion,
    socialSecurityBenefit: input.socialSecurityBenefit,
    qualifiedIncome: input.qualifiedIncome,
    household: input.household,
    state: input.state,
    taxYear: input.taxYear,
  });
}

/**
 * Prices a conversion and decides which dollars pay for it. Paying from taxable
 * is what makes the trade worth doing — every converted dollar then compounds
 * tax-free — so taxable funds the bill while it lasts, and only the remainder
 * is withheld from the conversion itself.
 */
function settle(converted: number, input: RothConversionInput): RothConversionResult {
  if (converted <= 0) return NONE;

  const tax = Math.max(0, taxOf(converted, input).totalTax - taxOf(0, input).totalTax);
  const fromTaxable = Math.min(tax, Math.max(0, input.taxableBalance));
  const withheld = Math.min(converted, tax - fromTaxable);

  return { converted, tax, fromTaxable, withheld };
}
