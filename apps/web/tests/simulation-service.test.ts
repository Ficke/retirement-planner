/**
 * Tests for the pure simulation service (no state management)
 * State management is now handled by usePlan store
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getSimulationService } from '@/services/simulation';
import { runMonteCarloSummaries } from '@/engine/mc';
import type { RetirementPlan } from '@/domain/types';
import { batchRequestSchema } from '@/lib/simulation-request';
import { createTestProjectionSettings } from './test-helpers';

// Mock the analysis and mc modules
// The cloud engine now requires a signed-in user. These tests exercise request
// shaping, not auth, so the token wrapper delegates straight to the fetch stub.
vi.mock('@/lib/firebase/api-client', () => ({
  authenticatedFetch: (url: string, options?: RequestInit) => fetch(url, options),
}));

vi.mock('@/engine/analysis', () => ({
  runSocialSecurityAnalysis: vi.fn().mockResolvedValue([]),
  runSpendingAnalysis: vi.fn().mockResolvedValue([]),
  runRetirementAgeAnalysis: vi.fn().mockResolvedValue([])
}));

vi.mock('@/engine/mc', () => ({
  runMonteCarloSimulation: vi.fn().mockResolvedValue({
    successProbability: 0.95,
    riskOfRuin: 0.05,
    medianTerminalWealth: 1000000,
    percentile10TerminalWealth: 500000,
    wealthAtAge: {},
    wealthThresholds: { below1m: 0.1, below500k: 0.05 },
    yearlyProjections: []
  }),
  runMonteCarloSummaries: vi.fn().mockImplementation(async (
    scenarios: Array<{ id: string }>,
  ) => scenarios.map(({ id }) => ({ id, successProbability: 0.95 }))),
}));

const mockPlan: RetirementPlan = {
  profile: {
    birthDate: '1989-01-01',
    state: 'CA',
    filingStatus: 'Single',
    retirementAge: 65,
    currentSalary: 75000,
    salaryGrowthRate: 0.03,
    currentSpending: 50000,
    workingSpendingGrowthRate: 0,
    retirementSpendingMultiplier: 1,
    retirementSpendingGrowthRate: 0.02,
    lifeExpectancy: 90,
    retirementHealthcare: { preMedicarePremium: 0, medicarePremium: 0, outOfPocket: 0, realGrowthRate: 0 },
    longTermCare: { enabled: false, costMultiplier: 1 },
    asOfDate: '2024-01-01',
  },
  accounts: [],
  socialSecurity: {
    enabled: true,
    claimAge: 67,
    manualOverride: false,
  },
  assumptions: createTestProjectionSettings({
    simulationModel: 'historical',
  }),
};

describe('SimulationService (Pure)', () => {
  let service: ReturnType<typeof getSimulationService>;

  beforeEach(() => {
    service = getSimulationService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should run main simulation', async () => {
    const result = await service.runMainSimulation(mockPlan);

    expect(result).toBeDefined();
    expect(result.successProbability).toBe(0.95);
    expect(result.medianTerminalWealth).toBe(1000000);
  });

  it('sweeps the standard claim ages and includes the exact plan age', async () => {
    const result = await service.runSocialSecurityAnalysis(mockPlan, false);

    expect(result.map((r) => r.claimAge)).toEqual([62, 64, 66, 67, 68, 70]);
  });

  it('does not simulate duplicate claim ages when Social Security is disabled', async () => {
    const result = await service.runSocialSecurityAnalysis({
      ...mockPlan,
      socialSecurity: { ...mockPlan.socialSecurity, enabled: false },
    }, false);
    expect(result).toHaveLength(1);
    expect(result[0].claimAge).toBe(mockPlan.socialSecurity.claimAge);
    expect(vi.mocked(runMonteCarloSummaries)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runMonteCarloSummaries).mock.calls[0][0][0].plan.socialSecurity.enabled).toBe(false);
  });

  it('does not invent claim-age adjustments for a manual household benefit', async () => {
    const result = await service.runSocialSecurityAnalysis({
      ...mockPlan,
      socialSecurity: {
        ...mockPlan.socialSecurity,
        manualOverride: true,
        estimatedBenefit: 50_000,
      },
    }, false);

    expect(result).toHaveLength(1);
    expect(result[0].claimAge).toBe(mockPlan.socialSecurity.claimAge);
    expect(vi.mocked(runMonteCarloSummaries).mock.calls[0][0][0].plan.socialSecurity).toMatchObject({
      manualOverride: true,
      estimatedBenefit: 50_000,
    });
  });

  it('widens the standard spending range to cover a plan below it', async () => {
    const result = await service.runSpendingAnalysis(mockPlan, false);

    expect(result.map((r) => r.annualSpending)).toEqual([
      40_000, 50_000, 60_000, 70_000, 80_000, 90_000, 100_000, 110_000, 120_000,
    ]);
  });

  it('adds an exact in-range plan spending value to the standard range', async () => {
    const result = await service.runSpendingAnalysis({
      ...mockPlan,
      profile: { ...mockPlan.profile, currentSpending: 94_500 },
    }, false);

    expect(result.map((r) => r.annualSpending)).toEqual([
      60_000, 70_000, 80_000, 90_000, 94_500, 100_000, 110_000, 120_000,
    ]);
  });

  it('keeps every spending scenario within the simulation contract', async () => {
    const result = await service.runSpendingAnalysis({
      ...mockPlan,
      profile: { ...mockPlan.profile, currentSpending: 1_000_000_000 },
    }, false);

    const levels = result.map((r) => r.annualSpending);
    expect(levels.length).toBeLessThanOrEqual(9);
    expect(levels.every((level) => level >= 20_000 && level <= 250_000)).toBe(true);
  });

  it('sweeps a stable age 45–70 retirement range', async () => {
    const result = await service.runRetirementAgeAnalysis(mockPlan, false);

    expect(result.map((r) => r.retirementAge)).toEqual([45, 50, 55, 60, 65, 70]);
  });

  it('adds an exact in-range plan retirement age to the standard grid', async () => {
    const result = await service.runRetirementAgeAnalysis({
      ...mockPlan,
      profile: { ...mockPlan.profile, birthDate: '1980-01-01', retirementAge: 46 },
    }, false);

    expect(result.map((r) => r.retirementAge)).toEqual([45, 46, 50, 55, 60, 65, 70]);
  });

  it('sends a valid retirement age sweep at the minimum retirement age', async () => {
    const plan: RetirementPlan = {
      ...mockPlan,
      profile: { ...mockPlan.profile, retirementAge: 45 },
      accounts: [
        {
          id: 'private-account-id',
          name: 'Brokerage',
          institution: 'Test Bank',
          type: 'Taxable',
          balance: 100000,
          assetWeights: { stocks: 0.6, bonds: 0.4 },
        },
      ],
    };
    let requestBody: unknown;

    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      const simulations = (requestBody as { simulations: Array<{ id: string }> }).simulations;
      return {
        ok: true,
        json: async () => ({
          results: simulations.map(({ id }) => ({
            id,
            successProbability: 0.95,
          })),
        }),
      } as Response;
    }));

    await service.runRetirementAgeAnalysis(plan, true);

    expect(batchRequestSchema.safeParse(requestBody).success).toBe(true);
    expect((requestBody as { responseMode: string }).responseMode).toBe('summary');
    expect(new Set((requestBody as {
      simulations: Array<{ config: { seed: number } }>;
    }).simulations.map((simulation) => simulation.config.seed))).toEqual(new Set([42]));
    const wireAccount = (requestBody as {
      simulations: Array<{ plan: { accounts: Array<Record<string, unknown>> } }>;
    }).simulations[0].plan.accounts[0];
    expect(wireAccount).toEqual({
      type: 'Taxable',
      balance: 100000,
      assetWeights: { stocks: 0.6, bonds: 0.4 },
    });
  });

  it('accepts the legacy full batch response while continuing to request summaries', async () => {
    let requestBody: unknown;
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      const simulations = (requestBody as { simulations: Array<{ id: string }> }).simulations;
      return {
        ok: true,
        json: async () => ({
          results: simulations.map(({ id }) => ({
            id,
            result: {
              successProbability: 0.8,
              riskOfRuin: 0.2,
              yearlyProjections: [{ age: 65 }],
            },
          })),
        }),
      } as Response;
    }));

    const results = await service.runSpendingAnalysis(mockPlan, true);

    expect((requestBody as { responseMode: string }).responseMode).toBe('summary');
    expect(results).toHaveLength(9);
    expect(results.every(({ result }) => (
      result.successProbability === 0.8
      && result.source === 'server'
      && !('yearlyProjections' in result)
    ))).toBe(true);
  });

  it('should handle concurrent simulations independently', async () => {
    const mainPromise = service.runMainSimulation(mockPlan);
    const ssPromise = service.runSocialSecurityAnalysis(mockPlan);
    const spendingPromise = service.runSpendingAnalysis(mockPlan);

    const [mainResult, ssResult, spendingResult] = await Promise.all([
      mainPromise,
      ssPromise,
      spendingPromise
    ]);

    expect(mainResult).toBeDefined();
    expect(ssResult).toBeDefined();
    expect(spendingResult).toBeDefined();
  });
});
