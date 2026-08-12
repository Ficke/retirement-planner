import { describe, it, expect } from 'vitest';
import {
  monteCarloRequestSchema,
  batchRequestSchema,
  MAX_PATHS,
  MAX_BATCH_SIMULATIONS,
} from '@/lib/simulation-request';
import { getClientIp } from '@/lib/rate-limit';
import { readLimitedJson } from '@/lib/validation';

const validPlan = {
  schemaVersion: 2,
  profile: {
    age: 35,
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
    contributions: { hsa: 0, traditional: 0, roth: 0, taxable: 0 },
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

const validConfig = { paths: 5000, seed: 42 };

describe('simulation request limits', () => {
  it('accepts a normal request', () => {
    expect(monteCarloRequestSchema.safeParse({ plan: validPlan, config: validConfig }).success).toBe(true);
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

  it('rejects a request from a newer unsupported schema', () => {
    expect(monteCarloRequestSchema.safeParse({
      plan: { ...validPlan, schemaVersion: 3 },
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
    const sims = Array.from({ length: 11 }, (_, i) => ({
      id: `retirementAge-${55 + i}`,
      plan: validPlan,
      config: { paths: 1000, seed: 3000 + i },
    }));
    expect(batchRequestSchema.safeParse({ simulations: sims }).success).toBe(true);
  });
});

describe('simulation client address handling', () => {
  it('uses the load-balancer-appended client address, not a spoofed prefix', () => {
    const headers = new Headers({
      'x-forwarded-for': '198.51.100.99, 203.0.113.7, 169.254.1.1',
    });
    expect(getClientIp(headers)).toBe('203.0.113.7');
  });

  it('uses the shared limiter bucket when the forwarding chain is untrusted', () => {
    expect(getClientIp(new Headers({ 'x-forwarded-for': '198.51.100.99' }))).toBe('unknown');
    expect(getClientIp(new Headers({ 'x-real-ip': '198.51.100.99' }))).toBe('unknown');
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
