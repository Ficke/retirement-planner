import type { RetirementHealthcare } from '@/domain/types';
import { MEDICARE_AGE } from '@/domain/constants';

/**
 * Retirement healthcare for one year: premiums step down at Medicare, while
 * out-of-pocket cost barely moves across that line.
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
  yearsRetired: number,
): { total: number; qualified: number } {
  const growth = Math.pow(1 + healthcare.realGrowthRate, Math.max(0, yearsRetired));
  const onMedicare = age >= MEDICARE_AGE;
  const premium = onMedicare ? healthcare.medicarePremium : healthcare.preMedicarePremium;
  const outOfPocket = healthcare.outOfPocket;
  return {
    total: (premium + outOfPocket) * growth,
    qualified: (outOfPocket + (onMedicare ? premium : 0)) * growth,
  };
}
