import { MIN_RETIREMENT_AGE } from './constants';
import type { RetirementPlan } from './types';

/**
 * The three plan levers the Plan page exposes. Slider bounds, the sensitivity
 * curve's x domain, and the sweep's scenario values all resolve from one range
 * per lever, so a slider can never reach a value the curve does not plot.
 */
export type LeverKey = 'retirementAge' | 'spending' | 'socialSecurityClaimAge';

export interface LeverRange {
  min: number;
  max: number;
  step: number;
  ticks: number[];
  sweepValues: number[];
}

interface LeverSpec {
  base: [number, number];
  step: number;
  tickStep: number;
  sweepStep: number;
  maxTicks: number;
  maxSweepValues: number;
  value: (plan: RetirementPlan) => number;
  /** Hard limits the range may never grow past, however extreme the plan value. */
  bounds: (plan: RetirementPlan) => [number, number];
}

const SPECS: Record<LeverKey, LeverSpec> = {
  retirementAge: {
    base: [MIN_RETIREMENT_AGE, 70],
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
    base: [60_000, 120_000],
    step: 1_000,
    tickStep: 20_000,
    sweepStep: 10_000,
    maxTicks: 7,
    maxSweepValues: 9,
    value: (plan) => plan.profile.currentSpending,
    bounds: () => [20_000, 250_000],
  },
  socialSecurityClaimAge: {
    base: [62, 70],
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
  const current = spec.value(plan);

  // A plan value outside the standard band still needs a marker on the curve,
  // so the range grows to a round multiple that contains it.
  const min = Math.max(
    lowBound,
    Math.min(spec.base[0], Math.floor(current / spec.tickStep) * spec.tickStep),
  );
  const max = Math.max(min, Math.min(
    highBound,
    Math.max(spec.base[1], Math.ceil(current / spec.tickStep) * spec.tickStep),
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
