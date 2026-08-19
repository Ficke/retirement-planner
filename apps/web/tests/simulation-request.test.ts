import { describe, it, expect } from 'vitest';
import {
  monteCarloRequestSchema,
  batchRequestSchema,
  MAX_PATHS,
  MAX_BATCH_SIMULATIONS,
} from '@/lib/simulation-request';
import { PLAN_SCHEMA_VERSION } from '@/domain/constants';
import { readLimitedJson } from '@/lib/validation';

const validPlan = {
  schemaVersion: 4,
  profile: {
    birthDate: '1991-01-01',
    state: 'CA',
    filingStatus: 'Single',
    retirementAge: 65,
    currentSalary: 100000,
    salaryGrowthRate: 0.01,
    currentSpending: 50000,
    workingSpendingGrowthRate: 0,
    retirementSpending: 50000,
    retirementSpendingGrowthRate: 0,
    lifeExpectancy: 90,
    retirementHealthcare: { preMedicarePremium: 0, medicarePremium: 0, outOfPocket: 0, realGrowthRate: 0 },
    asOfDate: '2026-01-01',
  },
  accounts: [
    {
      type: 'Taxable',
      balance: 100000,
      assetWeights: { stocks: 0.6, bonds: 0.4 },
    },
  ],
  socialSecurity: { enabled: true, claimAge: 67, manualOverride: false },
  assumptions: {
    simulationModel: 'historical',
    taxableGainRatio: 0.5,
    hsaEligible: false, useBackdoorRoth: false,
  },
};

const legacyPlan = {
  ...validPlan,
  schemaVersion: undefined,
  profile: {
    ...validPlan.profile,
    workingSpendingGrowthRate: undefined,
    retirementSpending: undefined,
    retirementSpendingGrowthRate: undefined,
    desiredSpending: 55000,
    spendingGrowthRate: 0.02,
  },
};

/** What a v2 bundle puts on the wire: age and birth year, spending in dollars. */
const v2Plan = {
  ...validPlan,
  schemaVersion: 2,
  profile: {
    ...validPlan.profile,
    birthDate: undefined,
    age: 35,
    birthYear: 1991,
  },
};

const validConfig = { paths: 5000, seed: 42 };

describe('simulation request limits', () => {
  it('accepts a normal request', () => {
    const result = monteCarloRequestSchema.safeParse({ plan: validPlan, config: validConfig });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.plan.assumptions.randomSeed).toBe(42);
  });

  it('accepts and normalizes a legacy browser request without changing its semantics version', () => {
    const result = monteCarloRequestSchema.safeParse({ plan: legacyPlan, config: validConfig });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.plan.schemaVersion).toBe(0);
    expect(result.data.plan.profile).toMatchObject({
      currentSpending: 50000,
      workingSpendingGrowthRate: 0,
      retirementSpending: 55000,
      retirementSpendingGrowthRate: 0.02,
    });
  });

  it('accepts a request from the previously deployed bundle', () => {
    const result = monteCarloRequestSchema.safeParse({ plan: v2Plan, config: validConfig });
    expect(result.success).toBe(true);
    if (!result.success) return;
    // Preserved, not upgraded: v2 predates birthDate but already had the
    // phase-based spending model, and the engine keys that off the version.
    expect(result.data.plan.schemaVersion).toBe(2);
    expect(result.data.plan.profile.birthDate).toBe('1991-01-01');
  });

  it('rejects a request from a newer unsupported schema', () => {
    expect(monteCarloRequestSchema.safeParse({
      plan: { ...validPlan, schemaVersion: PLAN_SCHEMA_VERSION + 1 },
      config: validConfig,
    }).success).toBe(false);
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
    const sims = Array.from({ length: 17 }, (_, i) => ({
      id: `sweep-${i}`,
      plan: validPlan,
      config: { paths: 300, seed: 42 },
    }));
    const summary = batchRequestSchema.safeParse({ responseMode: 'summary', simulations: sims });
    expect(summary.success).toBe(true);

    const legacy = batchRequestSchema.safeParse({ simulations: sims });
    expect(legacy.success).toBe(true);
    if (legacy.success) expect(legacy.data.responseMode).toBe('full');
  });
});

describe('bounded JSON parsing', () => {
  it('rejects declared and actual bodies above the cap', async () => {
    await expect(readLimitedJson(new Request('https://example.test', {
      method: 'POST',
      headers: { 'content-length': '100' },
      body: '{}',
    }), 10)).rejects.toBeInstanceOf(RangeError);

    await expect(readLimitedJson(new Request('https://example.test', {
      method: 'POST',
      body: JSON.stringify({ payload: 'too large' }),
    }), 10)).rejects.toBeInstanceOf(RangeError);
  });

  it('rejects malformed JSON as a client error', async () => {
    await expect(readLimitedJson(new Request('https://example.test', {
      method: 'POST',
      body: '{',
    }), 10)).rejects.toBeInstanceOf(SyntaxError);
  });
});
