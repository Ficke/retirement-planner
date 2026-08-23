import * as React from 'react';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CashFlowChart } from '@/components/ui/charts/cash-flow-chart';
import { toCashFlowRows } from '@/components/ui/charts/cash-flow-data';
import type { OutcomeCashFlowRow } from '@/domain/types';
import { remainingYearFractionOf } from '@/domain/age';

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
    longTermCareCost: 0,
    ...overrides,
  };
}

const moneyOut = (r: Record<string, number>) =>
  r.living + r.healthcare + r.longTermCare + r.tax;
const moneyIn = (r: Record<string, number>) => r.salary + r.socialSecurity + r.portfolio;

afterEach(() => vi.unstubAllGlobals());

describe('cash-flow chart rows', () => {
  it('leaves exactly the year’s saving between the two stacks in a working year', () => {
    const [r] = toCashFlowRows([row({
      age: 40, isRetired: false, income: 100_000, spending: 50_000,
      taxes: 20_000, savings: 30_000,
    })]);

    expect(moneyIn(r)).toBe(100_000);
    expect(moneyOut(r)).toBe(70_000);
    expect(moneyIn(r) - moneyOut(r)).toBe(30_000);
  });

  it('annualizes every cash flow in the initial partial year', () => {
    const [r] = toCashFlowRows([row({
      age: 70, spending: 30_000, taxes: 2_500, savings: -22_500,
      socialSecurityBenefit: 10_000, withdrawalTaxable: 22_500,
      healthcareCost: 7_000, longTermCareCost: 5_000,
    })], { age: 70, fraction: 0.5 });

    expect(moneyIn(r)).toBe(65_000);
    expect(moneyOut(r)).toBe(65_000);
    expect(r.portfolio).toBe(45_000);
    expect(r.healthcare).toBe(14_000);
    expect(r.longTermCare).toBe(10_000);
  });

  it('does not annualize the first visible row when the true partial year was filtered out', () => {
    const [r] = toCashFlowRows([row({
      age: 65, spending: 60_000, taxes: 5_000,
      withdrawalTaxable: 65_000, savings: -65_000,
    })], { age: 40, fraction: 0.5 });

    expect(moneyIn(r)).toBe(65_000);
    expect(moneyOut(r)).toBe(65_000);
  });

  it('uses the same inclusive calendar fraction as the projection engine', () => {
    expect(remainingYearFractionOf('2025-01-01')).toBe(1);
    expect(remainingYearFractionOf('2025-12-31')).toBeCloseTo(1 / 365, 12);
    expect(remainingYearFractionOf('2024-12-31')).toBeCloseTo(1 / 366, 12);
  });

  it('closes the gap in a retirement year funded by the portfolio', () => {
    const [r] = toCashFlowRows([row({
      spending: 60_000, taxes: 5_000, socialSecurityBenefit: 20_000,
      income: 20_000, withdrawalTaxable: 45_000, savings: -45_000,
      healthcareCost: 14_000, longTermCareCost: 6_000,
    })]);

    expect(moneyIn(r)).toBe(65_000);
    expect(moneyOut(r)).toBe(65_000);
    expect(r.living).toBe(40_000);
    expect(r.healthcare).toBe(14_000);
    expect(r.longTermCare).toBe(6_000);
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
    expect(moneyIn(r)).toBe(70_000);
    expect(moneyOut(r)).toBe(70_000);
  });

  it('never draws money out above money in when the year is underfunded', () => {
    const [r] = toCashFlowRows([row({
      age: 88, spending: 4_000, taxes: 0, socialSecurityBenefit: 0,
      income: 0, withdrawalTaxable: 4_000, savings: -4_000,
      healthcareCost: 15_000, longTermCareCost: 15_000,
    })]);

    expect(moneyOut(r)).toBeLessThanOrEqual(moneyIn(r));
    expect(r.living).toBeGreaterThanOrEqual(0);
    expect(r.healthcare).toBe(2_000);
    expect(r.longTermCare).toBe(2_000);
    expect(r.living + r.healthcare + r.longTermCare).toBe(4_000);
  });

  it('treats a cloud engine with no healthcare field as no healthcare', () => {
    const bare = row({ spending: 40_000, taxes: 0, withdrawalTaxable: 40_000, savings: -40_000 });
    delete (bare as Partial<OutcomeCashFlowRow>).healthcareCost;
    delete (bare as Partial<OutcomeCashFlowRow>).longTermCareCost;
    const [r] = toCashFlowRows([bare]);

    expect(r.healthcare).toBe(0);
    expect(r.longTermCare).toBe(0);
    expect(r.living).toBe(40_000);
    expect(moneyOut(r)).toBe(moneyIn(r));
  });

  it('renders both sides of a one-year phase in one chart without a savings line', () => {
    // Vitest compiles this client component with the classic JSX runtime.
    vi.stubGlobal('React', React);
    const projection = row({
      age: 64,
      isRetired: false,
      income: 100_000,
      spending: 50_000,
      taxes: 20_000,
      savings: 30_000,
    });

    const { container } = render(React.createElement(CashFlowChart, {
      projections: [projection],
      height: 400,
    }));

    expect(container.querySelector('.recharts-bar-rectangle')).not.toBeNull();
    expect(container.querySelectorAll('.recharts-wrapper')).toHaveLength(1);
    expect(container.querySelector('.recharts-line')).toBeNull();
  });
});
