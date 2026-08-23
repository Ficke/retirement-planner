import { describe, expect, it } from 'vitest';
import { CONVERSION_STEPS, conversionLabelOf, conversionStepOf, leverRange } from '@/domain/levers';
import { createTestProjectionSettings } from './test-helpers';
import type { RetirementPlan } from '@/domain/types';

const plan = (step: number): RetirementPlan => ({
  profile: {
    birthDate: '1960-01-01', asOfDate: '2025-01-01', currentSalary: 0, salaryGrowthRate: 0,
    retirementAge: 65, lifeExpectancy: 95, currentSpending: 100_000, workingSpendingGrowthRate: 0,
    retirementSpendingMultiplier: 1, retirementSpendingGrowthRate: 0,
    retirementHealthcare: { preMedicarePremium: 0, medicarePremium: 0, outOfPocket: 0, realGrowthRate: 0 },
    filingStatus: 'Single', state: 'CA',
  },
  accounts: [],
  socialSecurity: { enabled: false, claimAge: 67, manualOverride: false },
  assumptions: createTestProjectionSettings({ rothConversion: CONVERSION_STEPS[step].policy }),
});

describe('Roth conversion lever', () => {
  it('puts every ceiling on the slider, with off at zero', () => {
    expect(CONVERSION_STEPS[0].policy.enabled).toBe(false);
    expect(CONVERSION_STEPS.slice(1).every((s) => s.policy.enabled)).toBe(true);
    expect(CONVERSION_STEPS.map((s) => s.label))
      .toEqual(['Off', '12%', 'IRMAA', '22%', '24%', '32%']);
  });

  it('round-trips a policy through its slider position', () => {
    CONVERSION_STEPS.forEach((_, step) => {
      expect(conversionStepOf(plan(step))).toBe(step);
    });
  });

  it('sweeps every notch, so the slider cannot reach a value the curve omits', () => {
    const { min, max, step, ticks, sweepValues } = leverRange('rothConversion', plan(0));
    expect([min, max, step]).toEqual([0, CONVERSION_STEPS.length - 1, 1]);
    expect(sweepValues).toEqual(CONVERSION_STEPS.map((_, i) => i));
    expect(ticks).toEqual(CONVERSION_STEPS.map((_, i) => i));
  });

  it('labels a position that is off the end as off rather than throwing', () => {
    expect(conversionLabelOf(CONVERSION_STEPS.length)).toBe('Off');
  });
});
