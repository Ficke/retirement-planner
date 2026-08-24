/**
 * Income-tested healthcare premiums: the ACA premium tax credit before
 * Medicare, and the IRMAA surcharge after it.
 *
 * Both make a withdrawal decision a healthcare decision. A Roth conversion at
 * 63 raises the Medicare premium at 65, and large Traditional draws before 65
 * can cost more in lost subsidy than they save in tax. Neither follows from
 * the plan alone, only from the income the projection produces.
 *
 * Indexed annually, stated here for 2026. The Rust engine carries a copy and
 * both change together.
 */

import type { FilingStatus } from '@/domain/types';

export const HEALTHCARE_PREMIUM_RULES_YEAR = 2026;

/**
 * HHS poverty guidelines for the 48 contiguous states, published January 2025
 * and the ones a 2026 coverage year is measured against. Alaska and Hawaii run
 * higher and are not modeled.
 */
const FEDERAL_POVERTY_LEVEL_2025 = {
  firstPerson: 15_650,
  eachAdditionalPerson: 5_500,
} as const;

export function federalPovertyLevel(householdSize: number): number {
  const people = Math.max(1, householdSize);
  return FEDERAL_POVERTY_LEVEL_2025.firstPerson
    + (people - 1) * FEDERAL_POVERTY_LEVEL_2025.eachAdditionalPerson;
}

/**
 * Share of income a household is expected to pay for the benchmark plan,
 * interpolated within each band (IRC 36B(b)(3)(A)(i), indexed for 2026 by
 * Rev. Proc. 2025-25).
 *
 * There is no band above 400%. That is the subsidy cliff, which returned on
 * 2026-01-01 when the enhanced credits lapsed: one dollar over and the whole
 * credit is gone. It is a cliff here too, not a taper, because the
 * discontinuity is what makes managing MAGI worth modeling.
 */
const APPLICABLE_PERCENTAGE_BANDS: {
  upperFplRatio: number;
  startPercent: number;
  endPercent: number;
}[] = [
  { upperFplRatio: 1.33, startPercent: 0.0210, endPercent: 0.0210 },
  { upperFplRatio: 1.5, startPercent: 0.0314, endPercent: 0.0419 },
  { upperFplRatio: 2.0, startPercent: 0.0419, endPercent: 0.0660 },
  { upperFplRatio: 2.5, startPercent: 0.0660, endPercent: 0.0844 },
  { upperFplRatio: 3.0, startPercent: 0.0844, endPercent: 0.0996 },
  { upperFplRatio: 4.0, startPercent: 0.0996, endPercent: 0.0996 },
];

export const SUBSIDY_CLIFF_FPL_RATIO = 4.0;
/**
 * The credit starts at the poverty level. Below it is the Medicaid population:
 * expansion states cover them, non-expansion states leave them in the coverage
 * gap, and this model can price neither. They pay list here, so a plan is not
 * handed free coverage for holding MAGI at zero.
 */
export const SUBSIDY_FLOOR_FPL_RATIO = 1.0;

/**
 * What the household is expected to pay toward the benchmark plan, or null
 * when no credit reaches it: over the cliff, or under the floor.
 */
export function expectedPremiumContribution(
  magi: number,
  householdSize: number,
): number | null {
  const fplRatio = magi / federalPovertyLevel(householdSize);
  if (fplRatio > SUBSIDY_CLIFF_FPL_RATIO || fplRatio < SUBSIDY_FLOOR_FPL_RATIO) return null;

  let lowerRatio = 0;
  for (const band of APPLICABLE_PERCENTAGE_BANDS) {
    if (fplRatio <= band.upperFplRatio) {
      const span = band.upperFplRatio - lowerRatio;
      const position = span > 0 ? (fplRatio - lowerRatio) / span : 0;
      const percent = band.startPercent
        + (band.endPercent - band.startPercent) * Math.min(1, Math.max(0, position));
      return Math.max(0, magi) * percent;
    }
    lowerRatio = band.upperFplRatio;
  }
  return null;
}

/**
 * IRMAA tiers for 2026, keyed on MAGI from two years prior. `surcharge` is the
 * monthly Part B and Part D surcharge per enrolled person, on top of the
 * standard premium the household already entered.
 *
 * These are cliffs, not phase-outs: a dollar over a threshold owes the whole
 * next tier.
 */
const IRMAA_TIERS_2026: { singleUpperBound: number; monthlySurcharge: number }[] = [
  { singleUpperBound: 109_000, monthlySurcharge: 0 },
  { singleUpperBound: 137_000, monthlySurcharge: 95.70 },
  { singleUpperBound: 171_000, monthlySurcharge: 240.40 },
  { singleUpperBound: 205_000, monthlySurcharge: 385.00 },
  { singleUpperBound: 500_000, monthlySurcharge: 529.70 },
  { singleUpperBound: Infinity, monthlySurcharge: 578.00 },
];

/**
 * Married filing separately gets its own schedule rather than half the joint
 * one: it stays at the standard premium to $109,000, then jumps straight to
 * the top two tiers.
 */
const IRMAA_SEPARATE_BOUNDS = [109_000, 391_000] as const;

/**
 * The most MAGI a household can report and still owe no surcharge. Conversion
 * planning aims at this because IRMAA is a cliff: one dollar over buys the
 * whole next tier, for both spouses, for a year.
 */
export function irmaaFreeMagiCeiling(filingStatus: FilingStatus): number {
  const firstTier = IRMAA_TIERS_2026[0].singleUpperBound;
  if (filingStatus === 'MarriedFilingSeparately') return IRMAA_SEPARATE_BOUNDS[0];
  return filingStatus === 'MarriedFilingJointly' ? firstTier * 2 : firstTier;
}

export function irmaaAnnualSurcharge(
  magi: number,
  filingStatus: FilingStatus,
  peopleOnMedicare: number,
): number {
  const perPerson = () => {
    if (filingStatus === 'MarriedFilingSeparately') {
      if (magi <= IRMAA_SEPARATE_BOUNDS[0]) return 0;
      return magi < IRMAA_SEPARATE_BOUNDS[1]
        ? IRMAA_TIERS_2026[4].monthlySurcharge
        : IRMAA_TIERS_2026[5].monthlySurcharge;
    }
    const scale = filingStatus === 'MarriedFilingJointly' ? 2 : 1;
    const tier = IRMAA_TIERS_2026.find((t) => magi <= t.singleUpperBound * scale)
      ?? IRMAA_TIERS_2026[IRMAA_TIERS_2026.length - 1];
    return tier.monthlySurcharge;
  };
  return perPerson() * 12 * Math.max(0, peopleOnMedicare);
}
