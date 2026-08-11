/**
 * Core-flow smoke test — the trip-wire for "I broke the main simulation."
 *
 * Exercises the real projection engine against a realistic plan and asserts
 * that the projected years span working + retirement and terminal wealth is
 * plausible. No worker, no network, no DB — fast and deterministic.
 */

import { describe, it, expect } from 'vitest';
import { projectScenario } from '@/engine/projection';
import type { RetirementPlan } from '@/domain/types';
import { createTestAccount, createTestProjectionSettings } from '../test-helpers';

const plan: RetirementPlan = {
  profile: {
    age: 45,
    state: 'TX',
    filingStatus: 'Single',
    retirementAge: 65,
    currentSalary: 120_000,
    salaryGrowthRate: 0.03,
    currentSpending: 60_000,
    desiredSpending: 60_000,
    spendingGrowthRate: 0.025,
    lifeExpectancy: 90,
    asOfDate: '2026-01-01',
  },
  accounts: [
    createTestAccount({ type: 'Taxable', balance: 250_000 }),
    createTestAccount({ type: 'Traditional', balance: 400_000 }),
    createTestAccount({ type: 'Roth', balance: 100_000 }),
  ],
  socialSecurity: {
    enabled: true,
    claimAge: 67,
    manualOverride: false,
  },
  assumptions: createTestProjectionSettings({
    simulationModel: 'historical',
  }),
};

describe('core simulation flow', () => {
  it('produces a full lifecycle projection with plausible terminal wealth', () => {
    const result = projectScenario(plan, { paths: 1, seed: 42 });

    expect(result.projections.length).toBe(90 - 45 + 1);

    // Working → retirement transition exists
    const working = result.projections.filter(p => !p.isRetired);
    const retired = result.projections.filter(p => p.isRetired);
    expect(working.length).toBeGreaterThan(0);
    expect(retired.length).toBeGreaterThan(0);

    // Retirement-year income should equal SS benefit (post-fix for Rust bug mirrored in TS)
    const claimingYear = retired.find(p => p.age >= 67 && p.socialSecurityBenefit > 0);
    expect(claimingYear).toBeDefined();
    expect(claimingYear!.income).toBeCloseTo(claimingYear!.socialSecurityBenefit, 2);

    // Terminal wealth must be finite; plausible non-zero outcome given this plan
    expect(Number.isFinite(result.terminalWealth)).toBe(true);
    expect(result.terminalWealth).toBeGreaterThan(0);
  });

  it('is deterministic given a fixed seed', () => {
    const a = projectScenario(plan, { paths: 1, seed: 42 });
    const b = projectScenario(plan, { paths: 1, seed: 42 });
    expect(a.terminalWealth).toBe(b.terminalWealth);
  });
});
