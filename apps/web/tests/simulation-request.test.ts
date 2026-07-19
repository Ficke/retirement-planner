import { describe, it, expect } from 'vitest';
import {
  monteCarloRequestSchema,
  batchRequestSchema,
  MAX_PATHS,
  MAX_BATCH_SIMULATIONS,
} from '@/lib/simulation-request';

const validPlan = {
  profile: {
    age: 35,
    state: 'CA',
    filingStatus: 'Single',
    retirementAge: 65,
    currentSalary: 100000,
    salaryGrowthRate: 0.01,
    desiredSpending: 50000,
    spendingGrowthRate: 0,
    lifeExpectancy: 90,
    asOfDate: '2026-01-01',
  },
  accounts: [
    {
      id: 'a1',
      name: 'Brokerage',
      type: 'Taxable',
      balance: 100000,
      assetWeights: { stocks: 0.6, bonds: 0.4 },
      taxable: true,
    },
  ],
  socialSecurity: { enabled: true, claimAge: 67, manualOverride: false },
  assumptions: { simulationModel: 'historical', useBackdoorRoth: true },
};

const validConfig = { paths: 5000, seed: 42 };

describe('simulation request limits', () => {
  it('accepts a normal request', () => {
    expect(monteCarloRequestSchema.safeParse({ plan: validPlan, config: validConfig }).success).toBe(true);
  });

  it('rejects inflated path counts', () => {
    const result = monteCarloRequestSchema.safeParse({
      plan: validPlan,
      config: { ...validConfig, paths: MAX_PATHS + 1 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unbounded horizon', () => {
    const result = monteCarloRequestSchema.safeParse({
      plan: { ...validPlan, profile: { ...validPlan.profile, lifeExpectancy: 500 } },
      config: validConfig,
    });
    expect(result.success).toBe(false);
  });

  it('rejects oversized batches', () => {
    const sims = Array.from({ length: MAX_BATCH_SIMULATIONS + 1 }, (_, i) => ({
      id: `s${i}`,
      plan: validPlan,
      config: { paths: 100, seed: i },
    }));
    expect(batchRequestSchema.safeParse({ simulations: sims }).success).toBe(false);
  });

  it('rejects batches whose total paths exceed the cap', () => {
    const sims = Array.from({ length: 10 }, (_, i) => ({
      id: `s${i}`,
      plan: validPlan,
      config: { paths: 5000, seed: i },
    }));
    expect(batchRequestSchema.safeParse({ simulations: sims }).success).toBe(false);
  });

  it('accepts the sweep batches the UI actually sends', () => {
    const sims = Array.from({ length: 11 }, (_, i) => ({
      id: `retirementAge-${55 + i}`,
      plan: validPlan,
      config: { paths: 1000, seed: 3000 + i },
    }));
    expect(batchRequestSchema.safeParse({ simulations: sims }).success).toBe(true);
  });
});
