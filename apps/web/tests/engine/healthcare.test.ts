import { describe, it, expect } from 'vitest';
import { projectScenario } from '@/engine/projection';
import { healthcareCostFor } from '@/domain/healthcare';
import { retirementSpendingOf } from '@/domain/age';
import type { SimulationPlan } from '@/domain/types';
import { createTestAccount, createTestProjectionSettings } from '../test-helpers';
import { PLAN_SCHEMA_VERSION } from '@/domain/constants';

const HEALTHCARE = {
  preMedicarePremium: 15_900,
  medicarePremium: 4_650,
  outOfPocket: 3_000,
  realGrowthRate: 0.02,
};

/** Retires `years` from the as-of date, on a portfolio large enough to fund it. */
function planRetiringIn(years: number): SimulationPlan {
  const retirementAge = 35 + years;
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    profile: {
      birthDate: '1990-01-01',
      state: 'TX',
      filingStatus: 'Single',
      retirementAge,
      currentSalary: 150_000,
      salaryGrowthRate: 0,
      currentSpending: 50_000,
      workingSpendingGrowthRate: 0,
      retirementSpending: 50_000,
      retirementSpendingGrowthRate: 0,
      lifeExpectancy: retirementAge + 2,
      retirementHealthcare: HEALTHCARE,
      asOfDate: '2025-01-01',
    },
    accounts: [
      createTestAccount({ type: 'Taxable', balance: 5_000_000, assetWeights: { stocks: 0, bonds: 1 } }),
    ],
    socialSecurity: { enabled: false, claimAge: 67, manualOverride: false },
    assumptions: createTestProjectionSettings(),
  };
}

describe('retirement healthcare', () => {
  it('compounds real growth from the as-of date, not from the retirement year', () => {
    const soon = projectScenario(planRetiringIn(1), { paths: 1, seed: 7 }).projections;
    const later = projectScenario(planRetiringIn(20), { paths: 1, seed: 7 }).projections;

    const firstRetired = (rows: typeof soon) => rows.find((row) => row.isRetired)!;
    const soonHealthcare = firstRetired(soon).spending - 50_000;
    const laterHealthcare = firstRetired(later).spending - 50_000;

    // Both retire before 65, so both are on the marketplace premium and differ
    // only by the nineteen extra years of medical inflation.
    expect(soonHealthcare).toBeCloseTo(18_900 * 1.02, 2);
    expect(laterHealthcare).toBeCloseTo(18_900 * 1.02 ** 20, 2);
  });

  it('charges the Medicare premium from 65 and keeps out-of-pocket on both sides of it', () => {
    const before = healthcareCostFor(HEALTHCARE, 64, 0);
    const from = healthcareCostFor(HEALTHCARE, 65, 0);

    expect(before.total).toBe(18_900);
    expect(from.total).toBe(7_650);
    // A marketplace premium is not an HSA-qualified expense; a Medicare one is.
    expect(before.qualified).toBe(3_000);
    expect(from.qualified).toBe(7_650);
  });
});

describe('retirementSpendingOf', () => {
  const base = {
    currentSpending: 50_000,
    retirementSpendingMultiplier: 0.8,
    retirementAge: 65,
    birthDate: '1990-01-01',
    asOfDate: '2025-01-01',
  };

  it('applies the multiplier to spending as it stands at retirement', () => {
    expect(retirementSpendingOf({ ...base, workingSpendingGrowthRate: 0.01 }))
      .toBeCloseTo(50_000 * 1.01 ** 30 * 0.8, 6);
  });

  it('is the plain multiple when working spending does not drift', () => {
    expect(retirementSpendingOf({ ...base, workingSpendingGrowthRate: 0 })).toBe(40_000);
  });
});

describe('income-tested premiums', () => {
  const test = { filingStatus: 'Single' as const, householdSize: 1 };

  it('caps a marketplace premium at the share of income the credit leaves', () => {
    // 300% of a $15,650 poverty level, where the applicable percentage is 9.96%.
    const magi = 15_650 * 3;
    const subsidized = healthcareCostFor(HEALTHCARE, 60, 0, { ...test, priorYearMagi: magi });
    expect(subsidized.total).toBeCloseTo(magi * 0.0996 + 3_000, 2);
    expect(subsidized.total).toBeLessThan(18_900);
  });

  it('charges the full premium one dollar over the cliff', () => {
    const underCliff = 15_650 * 4;
    expect(
      healthcareCostFor(HEALTHCARE, 60, 0, { ...test, priorYearMagi: underCliff }).total,
    ).toBeLessThan(18_900);
    expect(
      healthcareCostFor(HEALTHCARE, 60, 0, { ...test, priorYearMagi: underCliff + 1 }).total,
    ).toBe(18_900);
  });

  it('adds the IRMAA surcharge from the MAGI of two years prior', () => {
    const standard = healthcareCostFor(HEALTHCARE, 66, 0, { ...test, irmaaLookbackMagi: 109_000 });
    const surcharged = healthcareCostFor(HEALTHCARE, 66, 0, { ...test, irmaaLookbackMagi: 109_001 });
    expect(standard.total).toBe(7_650);
    expect(surcharged.total).toBeCloseTo(7_650 + 95.7 * 12, 2);
    // A surcharged Medicare premium is still an HSA-qualified expense.
    expect(surcharged.qualified).toBeCloseTo(surcharged.total, 6);
  });

  it('leaves the premium alone when no income history exists yet', () => {
    expect(healthcareCostFor(HEALTHCARE, 60, 0, test).total).toBe(18_900);
    expect(healthcareCostFor(HEALTHCARE, 66, 0, test).total).toBe(7_650);
  });
});
