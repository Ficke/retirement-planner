import { describe, it, expect } from 'vitest';
import { estimatedFirstRetirementYearMagi, healthcareCostFor } from '@/domain/healthcare';
import { federalPovertyLevel, irmaaFreeMagiCeiling, SUBSIDY_CLIFF_FPL_RATIO, SUBSIDY_FLOOR_FPL_RATIO } from '@/data/healthcare-premiums';
import type { Account } from '@/domain/types';
import { retirementSpendingOf } from '@/domain/age';

const HEALTHCARE = {
  preMedicarePremium: 15_900,
  medicarePremium: 4_650,
  outOfPocket: 3_000,
  realGrowthRate: 0.02,
};

describe('retirement healthcare', () => {
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

  it('applies the multiplier to the last working year, so 100% is no step', () => {
    // Age 35 at the as-of date, retiring at 65: the final working year is the
    // thirtieth, which the projection compounds twenty-nine times.
    expect(retirementSpendingOf({ ...base, workingSpendingGrowthRate: 0.01 }))
      .toBeCloseTo(50_000 * 1.01 ** 29 * 0.8, 6);
    expect(retirementSpendingOf({
      ...base,
      retirementSpendingMultiplier: 1,
      workingSpendingGrowthRate: 0.01,
    })).toBeCloseTo(50_000 * 1.01 ** 29, 6);
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

  it('charges the full premium below the poverty level, where no credit reaches', () => {
    const floor = 15_650;
    expect(
      healthcareCostFor(HEALTHCARE, 60, 0, { ...test, priorYearMagi: floor - 1 }).total,
    ).toBe(18_900);
    expect(
      healthcareCostFor(HEALTHCARE, 60, 0, { ...test, priorYearMagi: floor }).total,
    ).toBeLessThan(18_900);
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

describe('a plan that prices no healthcare', () => {
  const NONE = { preMedicarePremium: 0, medicarePremium: 0, outOfPocket: 0, realGrowthRate: 0.02 };
  const test = { filingStatus: 'Single' as const, householdSize: 1 };

  it('is charged nothing, whatever its income', () => {
    expect(healthcareCostFor(NONE, 66, 10, { ...test, irmaaLookbackMagi: 400_000 }).total).toBe(0);
    expect(healthcareCostFor(NONE, 60, 10, { ...test, priorYearMagi: 30_000 }).total).toBe(0);
  });
});

describe("the first retirement year's income estimate", () => {
  const accountsOf = (taxable: number, traditional: number): Account[] => [
    { id: 'a', name: 'Brokerage', institution: '', type: 'Taxable', balance: taxable, assetWeights: { stocks: 0.6, bonds: 0.4 } },
    { id: 'b', name: '401(k)', institution: '', type: 'Traditional', balance: traditional, assetWeights: { stocks: 0.6, bonds: 0.4 } },
  ];
  const povertyLevel = federalPovertyLevel(1);

  it('lands inside the band rather than under the floor', () => {
    // Subtracting the salary alone leaves nothing, and a household under the
    // poverty level pays list exactly as one over the cliff does. The
    // portfolio-draw term is what keeps the estimate in reach of a credit.
    const magi = estimatedFirstRetirementYearMagi(58, 'Single', 73_000, 0, accountsOf(600_000, 900_000), 0.5, true);
    expect(magi).toBeGreaterThan(povertyLevel * SUBSIDY_FLOOR_FPL_RATIO);
    expect(magi).toBeLessThan(povertyLevel * SUBSIDY_CLIFF_FPL_RATIO);
    expect(healthcareCostFor(HEALTHCARE, 58, 0, {
      filingStatus: 'Single',
      householdSize: 1,
      priorYearMagi: magi,
    }).total).toBeLessThan(18_900);
  });

  it('stops the pre-tax draw at the cliff when the order is managing MAGI', () => {
    // A spending target this large exhausts the taxable account and would
    // otherwise report the whole remainder as ordinary income.
    const managed = estimatedFirstRetirementYearMagi(58, 'Single', 200_000, 0, accountsOf(50_000, 900_000), 0.5, true);
    const plain = estimatedFirstRetirementYearMagi(58, 'Single', 200_000, 0, accountsOf(50_000, 900_000), 0.5, false);
    const cliff = povertyLevel * SUBSIDY_CLIFF_FPL_RATIO;
    // A dollar short of the cliff, not on it: aiming exactly at a cliff leaves
    // the result a rounding error away from losing the whole credit.
    expect(managed).toBeLessThan(cliff);
    expect(cliff - managed).toBeLessThanOrEqual(1);
    expect(plain).toBeGreaterThan(managed);
  });

  it('counts a benefit the household is already claiming', () => {
    const withBenefit = estimatedFirstRetirementYearMagi(58, 'Single', 73_000, 30_000, accountsOf(600_000, 900_000), 0.5, true);
    const without = estimatedFirstRetirementYearMagi(58, 'Single', 73_000, 0, accountsOf(600_000, 900_000), 0.5, true);
    // The benefit funds part of the year, so less is drawn — but it is income
    // itself, and at a 50% gain ratio it replaces gains dollar for two.
    expect(withBenefit).toBeGreaterThan(without);
  });
});

describe('the first-year estimate mirrors the engine band', () => {
  const accountsOf = (taxable: number, traditional: number): Account[] => [
    { id: 'a', name: 'Brokerage', institution: '', type: 'Taxable', balance: taxable, assetWeights: { stocks: 0.6, bonds: 0.4 } },
    { id: 'b', name: '401(k)', institution: '', type: 'Traditional', balance: traditional, assetWeights: { stocks: 0.6, bonds: 0.4 } },
  ];

  it('stops using the subsidy cliff once the household reaches Medicare first', () => {
    // Retiring at 64, the credit is out of reach — the year after is a Medicare
    // year — so the IRMAA threshold binds instead and the draw is not capped
    // anywhere near the cliff.
    const atSixtyFour = estimatedFirstRetirementYearMagi(64, 'Single', 200_000, 0, accountsOf(10_000, 1_000_000), 0.5, true);
    const atSixtyThree = estimatedFirstRetirementYearMagi(63, 'Single', 200_000, 0, accountsOf(10_000, 1_000_000), 0.5, true);
    expect(atSixtyThree).toBeLessThan(federalPovertyLevel(1) * SUBSIDY_CLIFF_FPL_RATIO);
    expect(atSixtyFour).toBeGreaterThan(atSixtyThree);
    expect(atSixtyFour).toBeLessThan(irmaaFreeMagiCeiling('Single'));
  });
});
