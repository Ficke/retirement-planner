/**
 * Tests for the pure simulation service (no state management)
 * State management is now handled by usePlan store
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getSimulationService } from '@/services/simulation';
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
    age: 35,
    state: 'CA',
    filingStatus: 'Single',
    retirementAge: 65,
    currentSalary: 75000,
    salaryGrowthRate: 0.03,
    desiredSpending: 50000,
    spendingGrowthRate: 0.02,
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

  it('should run social security analysis', async () => {
    const result = await service.runSocialSecurityAnalysis(mockPlan);

    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  });

  it('should run spending analysis', async () => {
    const result = await service.runSpendingAnalysis(mockPlan);

    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  });

  it('should run retirement age analysis', async () => {
    const result = await service.runRetirementAgeAnalysis(mockPlan);

    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  });

  it('sends a valid retirement age sweep at the minimum retirement age', async () => {
    const plan: RetirementPlan = {
      ...mockPlan,
      profile: { ...mockPlan.profile, retirementAge: 45 },
      accounts: [
        {
          id: 'account-1',
          name: 'Brokerage',
          institution: 'Test Bank',
          type: 'Taxable',
          balance: 100000,
          assetWeights: { stocks: 0.6, bonds: 0.4 },
          taxable: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
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
