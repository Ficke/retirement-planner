import { describe, expect, it } from 'vitest';
import { leverRange } from '@/domain/levers';
import { createTestProjectionSettings } from './test-helpers';
import type { Account, RetirementPlan } from '@/domain/types';

const account = (balance: number): Account => ({
  id: 'a1',
  name: 'Brokerage',
  institution: 'Vanguard',
  type: 'Taxable',
  balance,
  assetWeights: { stocks: 0.8, bonds: 0.2 },
});

function plan({ spending, salary = 150_000, balance = 500_000 }: {
  spending: number;
  salary?: number;
  balance?: number;
}): RetirementPlan {
  return {
    profile: {
      birthDate: '1985-01-01', asOfDate: '2025-01-01', currentSalary: salary, salaryGrowthRate: 0.02,
      retirementAge: 65, lifeExpectancy: 95, currentSpending: spending, workingSpendingGrowthRate: 0,
      retirementSpendingMultiplier: 1, retirementSpendingGrowthRate: 0,
      retirementHealthcare: { preMedicarePremium: 0, medicarePremium: 0, outOfPocket: 0, realGrowthRate: 0 },
      longTermCare: { enabled: false, costMultiplier: 1 },
      filingStatus: 'Single', state: 'CA',
    },
    accounts: [account(balance)],
    socialSecurity: { enabled: false, claimAge: 67, manualOverride: false },
    assumptions: createTestProjectionSettings({}),
  };
}

/** What the slider writes when the handle lands at `fraction` along its track. */
function drag(spending: number, fraction: number): number {
  const { min, max, step } = leverRange('spending', plan({ spending }));
  return Math.round((min + fraction * (max - min)) / step) * step;
}

describe('Spending lever range', () => {
  it('does not move when spending does, so one track position means one number', () => {
    const ranges = [0, 40_000, 80_000, 200_000, 260_000].map(
      (spending) => leverRange('spending', plan({ spending })),
    );
    ranges.forEach((range) => {
      expect([range.min, range.max]).toEqual([ranges[0].min, ranges[0].max]);
    });
  });

  it('sizes itself from income and balances', () => {
    // 150k salary + 4% of 500k, half again over: the axis runs to 260k.
    expect(leverRange('spending', plan({ spending: 80_000 })).max).toBe(260_000);
    expect(leverRange('spending', plan({ spending: 80_000, balance: 2_000_000 })).max)
      .toBe(360_000);
  });

  it('settles after one move rather than climbing with each repeat', () => {
    let spending = 80_000;
    const landings: number[] = [];
    for (let i = 0; i < 20; i++) {
      spending = drag(spending, 0.6);
      landings.push(spending);
    }
    expect(new Set(landings).size).toBe(1);
  });

  it('caps a handle dragged to the far right instead of pushing the ceiling up', () => {
    let spending = 80_000;
    for (let i = 0; i < 20; i++) spending = drag(spending, 1);
    expect(spending).toBe(260_000);
  });

  it('reaches a plan spending past the ceiling, in whole multiples of it', () => {
    // The ceiling is 260k, so a 400k plan gets two bands rather than an axis
    // that stops on the handle.
    expect(leverRange('spending', plan({ spending: 400_000 })).max).toBe(520_000);
    expect(leverRange('spending', plan({ spending: 520_000 })).max).toBe(520_000);
    expect(leverRange('spending', plan({ spending: 600_000 })).max).toBe(780_000);
  });

  it('lets an over-ceiling plan return to a value the lever just left', () => {
    // Stretching the axis to the handle itself made this impossible: every
    // drag shrank the track under it, so the old value fell off the right end.
    const start = 400_000;
    const moved = drag(start, 0.75);

    expect(moved).not.toBe(start);
    expect(leverRange('spending', plan({ spending: moved })).max)
      .toBe(leverRange('spending', plan({ spending: start })).max);
    expect(drag(moved, start / leverRange('spending', plan({ spending: moved })).max))
      .toBe(start);
  });

  it('stops climbing at the top of an over-ceiling band', () => {
    let spending = 400_000;
    for (let i = 0; i < 20; i++) spending = drag(spending, 1);
    expect(spending).toBe(520_000);
  });

  it('keeps a frugal plan off the left edge', () => {
    const { min, max } = leverRange('spending', plan({ spending: 30_000 }));
    expect(min).toBe(0);
    expect(30_000).toBeGreaterThan(min);
    expect(30_000).toBeLessThan(max);
  });

  it('gives a plan with no income and no savings a band to sit in', () => {
    const { min, max } = leverRange('spending', plan({ spending: 0, salary: 0, balance: 0 }));
    expect(max).toBeGreaterThan(min);
  });

  it('sweeps the axis it plots, including the plan\'s own spending', () => {
    const { min, max, sweepValues } = leverRange('spending', plan({ spending: 80_000 }));
    expect(sweepValues[0]).toBe(min);
    expect(sweepValues.every((value) => value >= min && value <= max)).toBe(true);
    expect(sweepValues).toContain(80_000);
  });
});
