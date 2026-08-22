import { describe, expect, it } from 'vitest';
import { toCashFlowRows } from '@/components/ui/charts/cash-flow-data';
import type { OutcomeCashFlowRow } from '@/domain/types';

function row(overrides: Partial<OutcomeCashFlowRow>): OutcomeCashFlowRow {
  return {
    age: 70,
    isRetired: true,
    income: 0,
    spending: 0,
    taxes: 0,
    savings: 0,
    socialSecurityBenefit: 0,
    withdrawalTaxable: 0,
    withdrawalTraditional: 0,
    withdrawalRoth: 0,
    withdrawalHSA: 0,
    healthcareCost: 0,
    ...overrides,
  };
}

const moneyOut = (r: Record<string, number>) => r.living + r.healthcare + r.tax;

describe('cash-flow chart rows', () => {
  it('leaves exactly the year’s saving between the two stacks in a working year', () => {
    const [r] = toCashFlowRows([row({
      age: 40, isRetired: false, income: 100_000, spending: 50_000,
      taxes: 20_000, savings: 30_000,
    })]);

    expect(r.moneyIn).toBe(100_000);
    expect(moneyOut(r)).toBe(70_000);
    expect(r.moneyIn - moneyOut(r)).toBe(r.saved);
  });

  it('closes the gap in a retirement year funded by the portfolio', () => {
    const [r] = toCashFlowRows([row({
      spending: 60_000, taxes: 5_000, socialSecurityBenefit: 20_000,
      income: 20_000, withdrawalTaxable: 45_000, savings: -45_000,
      healthcareCost: 14_000,
    })]);

    expect(r.moneyIn).toBe(65_000);
    expect(moneyOut(r)).toBe(65_000);
    expect(r.saved).toBe(0);
    expect(r.living + r.healthcare).toBe(60_000);
  });

  it('nets a required distribution the household never received', () => {
    const [r] = toCashFlowRows([row({
      age: 85, spending: 50_000, taxes: 20_000, socialSecurityBenefit: 20_000,
      income: 20_000, withdrawalTraditional: 400_000, savings: -50_000,
      healthcareCost: 15_000,
    })]);

    // The draw reaching the household is what the year actually needed; the
    // rest went straight back into taxable.
    expect(r.portfolio).toBe(50_000);
    expect(r.fromTraditional).toBe(50_000);
    expect(r.moneyIn).toBe(70_000);
    expect(moneyOut(r)).toBe(70_000);
  });

  it('never draws money out above money in when the year is underfunded', () => {
    const [r] = toCashFlowRows([row({
      age: 88, spending: 4_000, taxes: 0, socialSecurityBenefit: 0,
      income: 0, withdrawalTaxable: 4_000, savings: -4_000,
      healthcareCost: 15_000,
    })]);

    expect(moneyOut(r)).toBeLessThanOrEqual(r.moneyIn);
    expect(r.living).toBeGreaterThanOrEqual(0);
    expect(r.living + r.healthcare).toBe(4_000);
  });

  it('treats a cloud engine with no healthcare field as no healthcare', () => {
    const bare = row({ spending: 40_000, taxes: 0, withdrawalTaxable: 40_000, savings: -40_000 });
    delete (bare as Partial<OutcomeCashFlowRow>).healthcareCost;
    const [r] = toCashFlowRows([bare]);

    expect(r.healthcare).toBe(0);
    expect(r.living).toBe(40_000);
    expect(moneyOut(r)).toBe(r.moneyIn);
  });
});
