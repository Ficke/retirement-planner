import type { FilingStatus, RetirementHealthcare } from '@/domain/types';
import { MEDICARE_AGE } from '@/domain/constants';
import { expectedPremiumContribution, irmaaAnnualSurcharge } from '@/data/healthcare-premiums';

/**
 * What the household's income makes of its premium. Absent, the entered
 * premium stands as written, which is what the profile page previews and what
 * a plan with no modeled income history falls back to.
 */
export interface PremiumIncomeTest {
  /** Prior modeled year's MAGI, which is what a marketplace estimate rests on. */
  priorYearMagi?: number;
  /** MAGI from two years prior, which is the year IRMAA actually looks at. */
  irmaaLookbackMagi?: number;
  filingStatus: FilingStatus;
  householdSize: number;
}

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
  incomeTest?: PremiumIncomeTest,
): { total: number; qualified: number } {
  const growth = Math.pow(1 + healthcare.realGrowthRate, Math.max(0, yearsFromAsOf));
  const onMedicare = age >= MEDICARE_AGE;
  const listPremium = (onMedicare ? healthcare.medicarePremium : healthcare.preMedicarePremium)
    * growth;
  const premium = incomeTest
    ? incomeTestedPremium(listPremium, onMedicare, incomeTest)
    : listPremium;
  const outOfPocket = healthcare.outOfPocket * growth;
  return {
    total: premium + outOfPocket,
    qualified: outOfPocket + (onMedicare ? premium : 0),
  };
}

/**
 * Before Medicare the entered premium is treated as the benchmark plan, since
 * that is what the credit is measured against and what the default figure
 * describes. After Medicare the entered premium is what the household pays at
 * the standard rate, and IRMAA is added to it.
 *
 * The surcharge is per enrolled person, but the plan models one age, so it is
 * charged for one until a spouse's age is modeled. Charging it per filer would
 * double a couple's surcharge years before the second person is eligible.
 */
function incomeTestedPremium(
  listPremium: number,
  onMedicare: boolean,
  test: PremiumIncomeTest,
): number {
  if (onMedicare) {
    if (test.irmaaLookbackMagi == null) return listPremium;
    return listPremium + irmaaAnnualSurcharge(test.irmaaLookbackMagi, test.filingStatus, 1);
  }
  if (test.priorYearMagi == null) return listPremium;
  const expected = expectedPremiumContribution(test.priorYearMagi, test.householdSize);
  if (expected == null) return listPremium;
  return Math.max(0, Math.min(listPremium, expected));
}
