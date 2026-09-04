import { MAX_PLAN_DOLLARS, MIN_RETIREMENT_AGE } from './constants';
import type { RetirementPlan, RothConversionPolicy } from './types';

/**
 * Conversion ceilings in the order of how much they actually convert, which is
 * the order a slider has to put them in. The IRMAA cap is measured on MAGI
 * rather than taxable income, and after the standard and senior deductions it
 * lands between the 12% and 22% bracket tops rather than where its larger
 * dollar figure suggests.
 *
 * Index 0 converts nothing, so the lever's own zero is the off switch.
 */
export const CONVERSION_STEPS: { policy: RothConversionPolicy; label: string }[] = [
  { policy: { enabled: false, ceiling: 'bracket24' }, label: 'Off' },
  { policy: { enabled: true, ceiling: 'bracket12' }, label: '12%' },
  { policy: { enabled: true, ceiling: 'irmaaTier' }, label: 'IRMAA' },
  { policy: { enabled: true, ceiling: 'bracket22' }, label: '22%' },
  { policy: { enabled: true, ceiling: 'bracket24' }, label: '24%' },
  { policy: { enabled: true, ceiling: 'bracket32' }, label: '32%' },
];

/** Where a plan's policy sits on the slider. Anything unrecognized reads as off. */
export function conversionStepOf(plan: RetirementPlan): number {
  const { enabled, ceiling } = plan.assumptions.rothConversion;
  if (!enabled) return 0;
  const index = CONVERSION_STEPS.findIndex(
    (step) => step.policy.enabled && step.policy.ceiling === ceiling,
  );
  return index === -1 ? 0 : index;
}

export function conversionLabelOf(step: number): string {
  return CONVERSION_STEPS[Math.round(step)]?.label ?? 'Off';
}

/**
 * The plan levers the Plan page exposes. Slider bounds, the sensitivity curve's
 * x domain, and the sweep's scenario values all resolve from one range per
 * lever, so a slider can never reach a value the curve does not plot.
 *
 * A lever's value is always a number, because the slider and the curve's x axis
 * both need one. The conversion ceiling is a choice rather than a quantity, so
 * its value is a position in `CONVERSION_STEPS` — evenly spaced, which also
 * keeps the 22% and 24% ceilings from landing on top of each other on a curve
 * plotted by rate.
 */
export type LeverKey =
  | 'retirementAge'
  | 'spending'
  | 'socialSecurityClaimAge'
  | 'rothConversion';

export interface LeverRange {
  min: number;
  max: number;
  step: number;
  ticks: number[];
  sweepValues: number[];
}

interface LeverSpec {
  /**
   * The standard band, before the range grows to contain a plan value outside
   * it. A lever whose interesting region moves with the plan resolves this
   * from the plan rather than fixing it.
   */
  base: (plan: RetirementPlan) => [number, number];
  step: number;
  tickStep: number;
  sweepStep: number;
  maxTicks: number;
  maxSweepValues: number;
  value: (plan: RetirementPlan) => number;
  /** Hard limits the range may never grow past, however extreme the plan value. */
  bounds: (plan: RetirementPlan) => [number, number];
}

/**
 * What a plan spending nothing falls back to, so a zero cannot collapse the
 * range to a single point. Deliberately small: every plan that spends anything
 * real sizes its own band, and a floor above that only widens the axis into
 * territory the household will never reach.
 */
const MIN_SPENDING_BAND = 20_000;

/**
 * Spending a household could sustain indefinitely: everything it earns, plus a
 * safe draw on what it holds. Spending well past this fails every year whatever
 * the markets do, so it fixes how far above the plan the axis is worth running.
 */
function sustainableSpending(plan: RetirementPlan): number {
  const balances = plan.accounts.reduce((total, account) => total + account.balance, 0);
  return plan.profile.currentSalary + 0.04 * balances;
}

const roundUpToTick = (value: number, tick: number) => Math.ceil(value / tick) * tick;

const SPECS: Record<LeverKey, LeverSpec> = {
  retirementAge: {
    base: () => [MIN_RETIREMENT_AGE, 70],
    step: 1,
    tickStep: 5,
    sweepStep: 5,
    maxTicks: 8,
    maxSweepValues: 8,
    value: (plan) => plan.profile.retirementAge,
    // Retiring at or past the modeled lifetime leaves no projection to run.
    bounds: (plan) => [MIN_RETIREMENT_AGE, Math.min(100, plan.profile.lifeExpectancy - 1)],
  },
  spending: {
    // Centered on what the plan already spends, so the handle never starts at
    // an edge and the curve is plotted where this household's answer changes.
    base: (plan) => {
      const span = Math.max(plan.profile.currentSpending, MIN_SPENDING_BAND);
      return [Math.floor((span * 0.5) / 20_000) * 20_000, roundUpToTick(span * 1.5, 20_000)];
    },
    step: 1_000,
    tickStep: 20_000,
    sweepStep: 10_000,
    maxTicks: 7,
    maxSweepValues: 9,
    value: (plan) => plan.profile.currentSpending,
    // A guard against an absurd axis rather than the thing that sizes it: the
    // band above does that. Half again above the larger of what the plan can
    // sustain and what it already spends, so the cap can never pin the handle
    // to the right edge of a plan that happens to spend near its own ceiling.
    // Every sweep value is validated against the plan schema, so it also may
    // never resolve past what that schema accepts.
    bounds: (plan) => [
      0,
      Math.min(
        MAX_PLAN_DOLLARS,
        roundUpToTick(
          Math.max(sustainableSpending(plan), plan.profile.currentSpending) * 1.5,
          20_000,
        ),
      ),
    ],
  },
  rothConversion: {
    base: () => [0, CONVERSION_STEPS.length - 1],
    step: 1,
    tickStep: 1,
    sweepStep: 1,
    maxTicks: CONVERSION_STEPS.length,
    maxSweepValues: CONVERSION_STEPS.length,
    value: conversionStepOf,
    bounds: () => [0, CONVERSION_STEPS.length - 1],
  },
  socialSecurityClaimAge: {
    base: () => [62, 70],
    step: 1,
    tickStep: 2,
    sweepStep: 2,
    maxTicks: 8,
    maxSweepValues: 7,
    value: (plan) => plan.socialSecurity.claimAge,
    // Claiming outside 62–70 is not a choice Social Security offers.
    bounds: () => [62, 70],
  },
};

function multiplesWithin(min: number, max: number, step: number, maxCount: number): number[] {
  let spacing = step;
  while ((max - min) / spacing + 1 > maxCount) spacing *= 2;
  const values: number[] = [];
  for (let v = Math.ceil(min / spacing) * spacing; v <= max; v += spacing) values.push(v);
  return values;
}

export function leverRange(key: LeverKey, plan: RetirementPlan): LeverRange {
  const spec = SPECS[key];
  const [lowBound, highBound] = spec.bounds(plan);
  const [baseLow, baseHigh] = spec.base(plan);
  const current = spec.value(plan);

  // A plan value outside the standard band still needs a marker on the curve,
  // so the range grows to a round multiple that contains it.
  const min = Math.max(
    lowBound,
    Math.min(baseLow, Math.floor(current / spec.tickStep) * spec.tickStep),
  );
  const max = Math.max(min, Math.min(
    highBound,
    Math.max(baseHigh, Math.ceil(current / spec.tickStep) * spec.tickStep),
  ));

  const sweepValues = multiplesWithin(min, max, spec.sweepStep, spec.maxSweepValues);
  if (current >= min && current <= max) sweepValues.push(current);

  return {
    min,
    max,
    step: spec.step,
    ticks: multiplesWithin(min, max, spec.tickStep, spec.maxTicks),
    sweepValues: [...new Set(sweepValues)].sort((a, b) => a - b),
  };
}
