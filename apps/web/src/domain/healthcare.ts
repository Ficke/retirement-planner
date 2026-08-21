import type { RetirementHealthcare } from '@/domain/types';
import { MEDICARE_AGE } from '@/domain/constants';

/**
 * Retirement healthcare for one year. Which premium applies is a step at
 * Medicare age; out-of-pocket cost is one figure on both sides of it.
 *
 * Real growth compounds from the as-of date, not from retirement, because the
 * entered figures are what the household would pay today. Medical costs rise
 * in real terms through the working years too, so a plan that is decades out
 * retires into a bill well above what it entered.
 *
 * `qualified` is the share an HSA can pay tax-free. Marketplace premiums are
 * not on that list — HSAs cover premiums only for COBRA, coverage during
 * unemployment, Medicare, and long-term care — so folding them in would hand an
 * early retiree a large tax break they do not have.
 *
 * Shared with the profile page so the spending it previews is the spending the
 * engine funds. Mirrored by `healthcare_cost_for` in the Rust engine.
 */
export function healthcareCostFor(
  healthcare: RetirementHealthcare,
  age: number,
  yearsFromAsOf: number,
): { total: number; qualified: number } {
  const growth = Math.pow(1 + healthcare.realGrowthRate, Math.max(0, yearsFromAsOf));
  const onMedicare = age >= MEDICARE_AGE;
  const premium = onMedicare ? healthcare.medicarePremium : healthcare.preMedicarePremium;
  const outOfPocket = healthcare.outOfPocket;
  return {
    total: (premium + outOfPocket) * growth,
    qualified: (outOfPocket + (onMedicare ? premium : 0)) * growth,
  };
}
