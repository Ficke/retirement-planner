import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildSimulationExport, getSimulationService } from '@/services/simulation';
import { runMonteCarloSummaries } from '@/engine/mc';
import type { RetirementPlan, SimulationResult } from '@/domain/types';
import {
  batchRequestSchema,
  MAX_BATCH_SIMULATIONS,
  MAX_BATCH_TOTAL_PATHS,
} from '@/lib/simulation-request';
import { simulationExportSchema } from '@/domain/simulation-export';
import { userProfileSchema } from '@/domain/schemas';
import { MAX_PLAN_DOLLARS } from '@/domain/constants';
import { createTestProjectionSettings } from './test-helpers';

// The server path signs every request with a Firebase ID token; these tests
// assert what is sent, not how it is authenticated.
vi.mock('@/lib/firebase/api-client', () => ({
  authenticatedFetch: (url: string, options?: RequestInit) => fetch(url, options),
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

  it('sweeps the same spending levels whatever the plan spends', async () => {
    // The band comes from income and balances, so moving the spending lever
    // cannot move the axis it is plotted against.
    const grid = [
      0, 10_000, 20_000, 30_000, 40_000, 50_000, 60_000,
      70_000, 80_000, 90_000, 100_000, 110_000, 120_000,
    ];

    for (const currentSpending of [20_000, 50_000, 100_000]) {
      const result = await service.runSpendingAnalysis({
        ...mockPlan,
        profile: { ...mockPlan.profile, currentSpending },
      }, false);
      const levels = result.map((r) => r.annualSpending);

      expect(levels.filter((level) => grid.includes(level))).toEqual(grid);
      expect(levels).toContain(currentSpending);
    }
  });

  it('adds an exact in-range plan spending value to the standard range', async () => {
    const result = await service.runSpendingAnalysis({
      ...mockPlan,
      profile: { ...mockPlan.profile, currentSpending: 94_500 },
    }, false);

    expect(result.map((r) => r.annualSpending)).toEqual([
      0, 10_000, 20_000, 30_000, 40_000, 50_000, 60_000, 70_000, 80_000, 90_000,
      94_500, 100_000, 110_000, 120_000,
    ]);
  });

  it('stops the sweep short of what a household could never outspend', async () => {
    // A $75k salary and no balances cannot fund much past its own income, so
    // the band stops rather than plotting a shelf of guaranteed failures. The
    // ceiling lands on the next $20k tick above half again that income.
    const result = await service.runSpendingAnalysis(mockPlan, false);

    expect(Math.max(...result.map((r) => r.annualSpending))).toBeLessThanOrEqual(
      mockPlan.profile.currentSalary * 1.5 + 20_000,
    );
  });

  it('keeps every spending scenario within the simulation contract', async () => {
    const result = await service.runSpendingAnalysis({
      ...mockPlan,
      profile: { ...mockPlan.profile, currentSpending: MAX_PLAN_DOLLARS },
    }, false);

    const levels = result.map((r) => r.annualSpending);
    // The lever's fourteen sweep steps, plus the plan's own value when it falls
    // off their grid.
    expect(levels.length).toBeLessThanOrEqual(15);
    expect(levels.every((level) => level >= 0 && level <= MAX_PLAN_DOLLARS)).toBe(true);
    // The schema each scenario is validated against is the real ceiling.
    for (const level of levels) {
      expect(userProfileSchema.safeParse({
        ...mockPlan.profile, currentSpending: level,
      }).success).toBe(true);
    }
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
    expect(results).toHaveLength(13);
    expect(results.every(({ result }) => (
      result.successProbability === 0.8
      && result.source === 'server'
      && !('yearlyProjections' in result)
    ))).toBe(true);
  });

  it('keeps the widest UI sensitivity batch within the public request bounds', async () => {
    let requestBody: unknown;
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      const simulations = (requestBody as { simulations: Array<{ id: string }> }).simulations;
      return {
        ok: true,
        json: async () => ({
          results: simulations.map(({ id }) => ({ id, successProbability: 0.95 })),
        }),
      } as Response;
    }));

    const results = await service.runSensitivityAnalyses({
      ...mockPlan,
      profile: {
        ...mockPlan.profile,
        retirementAge: 76,
        // A $170k income puts the spending axis at its widest: a $260k ceiling
        // is exactly fourteen $20k steps, and $65.5k sits off that grid and
        // adds itself as a fifteenth.
        currentSalary: 170_000,
        currentSpending: 65_500,
      },
      socialSecurity: { ...mockPlan.socialSecurity, claimAge: 63 },
    }, true);

    const simulations = (requestBody as {
      simulations: Array<{ config: { paths: number } }>;
    }).simulations;
    const totalPaths = simulations.reduce((total, simulation) => (
      total + simulation.config.paths
    ), 0);
    const curvePoints = results.socialSecurity.length
      + results.spending.length
      + results.retirementAge.length
      + results.rothConversion.length;

    // Every lever's sweep includes the plan's current value, so four of the 36
    // curve points are the unchanged plan. They are dispatched once.
    expect(curvePoints).toBe(36);
    expect(simulations).toHaveLength(33);
    expect(simulations.length).toBeLessThanOrEqual(MAX_BATCH_SIMULATIONS);
    expect(totalPaths).toBe(33_000);
    expect(totalPaths).toBeLessThanOrEqual(MAX_BATCH_TOTAL_PATHS);
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

describe('simulation export', () => {
  it('is compact and excludes account identity fields', () => {
    const plan: RetirementPlan = {
      ...mockPlan,
      accounts: [{
        id: 'private-account-id',
        name: 'Private account name',
        institution: 'Private institution',
        type: 'Taxable',
        balance: 123_456,
        assetWeights: { stocks: 0.7, bonds: 0.3 },
      }],
    };
    const result: SimulationResult = {
      source: 'client',
      engineVersion: '0.1.0:chacha12-v1',
      sourceRevision: 'exact-source-revision',
      successProbability: 0.8,
      riskOfRuin: 0.2,
      medianTerminalWealth: 1_000_000,
      medianAfterTaxTerminalWealth: 900_000,
      percentile5TerminalWealth: 0,
      percentile10TerminalWealth: 100_000,
      percentile90TerminalWealth: 3_000_000,
      yearlyProjections: [],
      outcomeBuckets: [],
    };

    const exported = buildSimulationExport(plan, result, new Date('2026-08-23T12:00:00Z'));
    const account = exported.input.accounts[0] as unknown as Record<string, unknown>;

    expect(exported).toMatchObject({
      version: 1,
      exportedAt: '2026-08-23T12:00:00.000Z',
      paths: 5000,
    });
    expect(Object.keys(exported)).toEqual(['version', 'exportedAt', 'paths', 'input', 'output']);
    expect(simulationExportSchema.parse(JSON.parse(JSON.stringify(exported)))).toEqual(exported);
    expect(exported.input.profile.retirementSpending).toBe(50_000);
    expect(account).toEqual({
      type: 'Taxable',
      balance: 123_456,
      assetWeights: { stocks: 0.7, bonds: 0.3 },
    });
    expect(JSON.stringify(exported)).not.toContain('Private account name');
    expect(JSON.stringify(exported)).not.toContain('Private institution');
    expect(JSON.stringify(exported)).not.toContain('private-account-id');
  });
});
