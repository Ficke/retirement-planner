import { describe, expect, it } from 'vitest';
import { interpolateSensitivityY } from '@/components/ui/charts/sensitivity-chart';
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
  it('places the current-value marker on the displayed sensitivity line', () => {
    const points = [
      { x: 60_000, y: 0.45 },
      { x: 70_000, y: 0.04 },
    ];

    expect(interpolateSensitivityY(points, 64_000)).toBeCloseTo(0.286);
  });

  it('does not move when spending does, so one track position means one number', () => {
    const ranges = [40_000, 60_000, 80_000, 100_000, 120_000].map(
      (spending) => leverRange('spending', plan({ spending })),
    );
    ranges.forEach((range) => {
      expect([range.min, range.max]).toEqual([ranges[0].min, ranges[0].max]);
    });
  });

  it('sizes itself from salary across income levels', () => {
    expect(leverRange('spending', plan({ spending: 80_000 })))
      .toMatchObject({ min: 40_000, max: 120_000 });
    expect(leverRange('spending', plan({ spending: 30_000, salary: 40_000 })))
      .toMatchObject({ min: 20_000, max: 40_000 });
    expect(leverRange('spending', plan({ spending: 250_000, salary: 500_000 })))
      .toMatchObject({ min: 120_000, max: 400_000 });
  });

  it('does not widen the spending range for a larger portfolio', () => {
    const base = leverRange('spending', plan({ spending: 80_000, balance: 0 }));
    const wealthy = leverRange('spending', plan({ spending: 80_000, balance: 2_000_000 }));

    expect([wealthy.min, wealthy.max]).toEqual([base.min, base.max]);
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
    expect(spending).toBe(120_000);
  });

  it('reaches a plan spending past the ceiling, in whole multiples of it', () => {
    // The ceiling is 120k, so a 400k plan gets four bands rather than an axis
    // that stops on the handle.
    expect(leverRange('spending', plan({ spending: 400_000 })).max).toBe(480_000);
    expect(leverRange('spending', plan({ spending: 480_000 })).max).toBe(480_000);
    expect(leverRange('spending', plan({ spending: 600_000 })).max).toBe(600_000);
  });

  it('lets an over-ceiling plan return to a value the lever just left', () => {
    // Stretching the axis to the handle itself made this impossible: every
    // drag shrank the track under it, so the old value fell off the right end.
    const start = 400_000;
    const moved = drag(start, 0.75);

    expect(moved).not.toBe(start);
    expect(leverRange('spending', plan({ spending: moved })).max)
      .toBe(leverRange('spending', plan({ spending: start })).max);
    const { min, max } = leverRange('spending', plan({ spending: moved }));
    expect(drag(moved, (start - min) / (max - min)))
      .toBe(start);
  });

  it('stops climbing at the top of an over-ceiling band', () => {
    let spending = 400_000;
    for (let i = 0; i < 20; i++) spending = drag(spending, 1);
    expect(spending).toBe(480_000);
  });

  it('expands to include a frugal plan without adding zero', () => {
    const { min, max } = leverRange('spending', plan({ spending: 30_000 }));
    expect(min).toBe(20_000);
    expect(30_000).toBeGreaterThan(min);
    expect(30_000).toBeLessThan(max);
  });

  it('gives a plan with no income and no savings a band to sit in', () => {
    const { min, max } = leverRange('spending', plan({ spending: 0, salary: 0, balance: 0 }));
    expect(max).toBeGreaterThan(min);
  });

  it('keeps the plotted samples fixed when the selected spending changes', () => {
    const first = leverRange('spending', plan({
      spending: 58_000,
      salary: 75_000,
      balance: 150_000,
    }));
    const second = leverRange('spending', plan({
      spending: 48_000,
      salary: 75_000,
      balance: 150_000,
    }));

    expect(first.sweepValues).toEqual(second.sweepValues);
    expect(first.sweepValues).not.toContain(58_000);
    expect(second.sweepValues).not.toContain(48_000);
  });

  it('uses the full ten-thousand-dollar resolution for a typical salary band', () => {
    const range = leverRange('spending', plan({
      spending: 58_000,
      salary: 75_000,
      balance: 150_000,
    }));

    expect([range.min, range.max]).toEqual([20_000, 60_000]);
    expect(range.sweepValues).toEqual([
      20_000, 30_000, 40_000, 50_000, 60_000,
    ]);
  });

  it('sweeps the full visible spending axis', () => {
    const { min, max, sweepValues } = leverRange('spending', plan({ spending: 80_000 }));
    expect(sweepValues[0]).toBe(min);
    expect(sweepValues.at(-1)).toBe(max);
    expect(sweepValues.every((value) => value >= min && value <= max)).toBe(true);
  });
});
