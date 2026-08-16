/**
 * Tests for the pure simulation service (no state management)
 * State management is now handled by usePlan store
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getSimulationService } from '@/services/simulation';
import { runMonteCarloSimulation } from '@/engine/mc';
import type { RetirementPlan } from '@/domain/types';
import { batchRequestSchema } from '@/lib/simulation-request';
import { createTestProjectionSettings } from './test-helpers';

// Mock the analysis and mc modules
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
  })
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

  it('sweeps claim age every other year across the eligible range', async () => {
    const result = await service.runSocialSecurityAnalysis(mockPlan, false);

    expect(result.map((r) => r.claimAge)).toEqual([62, 64, 66, 68, 70]);
  });

  it('does not simulate duplicate claim ages when Social Security is disabled', async () => {
    const result = await service.runSocialSecurityAnalysis({
      ...mockPlan,
      socialSecurity: { ...mockPlan.socialSecurity, enabled: false },
    }, false);
    expect(result).toHaveLength(1);
    expect(result[0].claimAge).toBe(mockPlan.socialSecurity.claimAge);
    expect(vi.mocked(runMonteCarloSimulation)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runMonteCarloSimulation).mock.calls[0][0].socialSecurity.enabled).toBe(false);
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
    expect(vi.mocked(runMonteCarloSimulation).mock.calls[0][0].socialSecurity).toMatchObject({
      manualOverride: true,
      estimatedBenefit: 50_000,
    });
  });

  it('sweeps spending from 60% to 120% of plan, with the plan itself on the grid', async () => {
    const result = await service.runSpendingAnalysis(mockPlan, false);

    expect(result.map((r) => r.annualSpending)).toEqual([
      30_000, 35_000, 40_000, 45_000, 50_000, 55_000, 60_000,
    ]);
    expect(result.map((r) => r.annualSpending)).toContain(
      mockPlan.profile.retirementSpending,
    );
  });

  it('keeps the plan spending exact when a percentage would not land on $1k', async () => {
    const result = await service.runSpendingAnalysis({
      ...mockPlan,
      profile: { ...mockPlan.profile, retirementSpending: 94_500 },
    }, false);

    expect(result.map((r) => r.annualSpending)).toContain(94_500);
  });

  it('sweeps retirement age by two years either side of the plan', async () => {
    const result = await service.runRetirementAgeAnalysis(mockPlan, false);

    expect(result.map((r) => r.retirementAge)).toEqual([61, 63, 65, 67, 69]);
  });

  it('drops swept retirement ages that fall below the minimum', async () => {
    const result = await service.runRetirementAgeAnalysis({
      ...mockPlan,
      profile: { ...mockPlan.profile, age: 44, retirementAge: 46 },
    }, false);

    expect(result.map((r) => r.retirementAge)).toEqual([46, 48, 50]);
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
            result: {
              successProbability: 0.95,
              riskOfRuin: 0.05,
              medianTerminalWealth: 1000000,
              percentile10TerminalWealth: 500000,
              wealthAtAge: {},
              wealthThresholds: { below1m: 0.1, below500k: 0.05 },
              yearlyProjections: [],
            },
          })),
        }),
      } as Response;
    }));

    await service.runRetirementAgeAnalysis(plan, true);

    expect(batchRequestSchema.safeParse(requestBody).success).toBe(true);
    const wireAccount = (requestBody as {
      simulations: Array<{ plan: { accounts: Array<Record<string, unknown>> } }>;
    }).simulations[0].plan.accounts[0];
    expect(wireAccount).toEqual({
      type: 'Taxable',
      balance: 100000,
      assetWeights: { stocks: 0.6, bonds: 0.4 },
    });
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
