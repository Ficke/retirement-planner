import { describe, it, expect, beforeEach } from 'vitest';
import { hydratePlan, usePlan } from '@/state/usePlan';
import type {
  RetirementAgeAnalysisResult,
  SpendingAnalysisResult,
  SSAnalysisResult,
} from '@/domain/types';

describe('State Management - Simple Invalidation Logic', () => {
  // Mock analysis results
  const mockSSResult = [{ claimAge: 67, result: { successProbability: 0.9, riskOfRuin: 0.1 } }];
  const mockSpendingResult = [{ annualSpending: 75000, result: { successProbability: 0.9, riskOfRuin: 0.1 } }];
  const mockRetirementAgeResult = [{ retirementAge: 60, result: { successProbability: 0.9, riskOfRuin: 0.1 } }];

  beforeEach(() => {
    // Reset the result slices touched by these tests
    usePlan.setState({
      authUser: null,
      cloudAccountReady: false,
      cloudAvailable: false,
      cloudSyncEnabled: true,
      error: null,
      simulationResult: null,
      ssAnalysisResult: null,
      spendingAnalysisResult: null,
      retirementAgeAnalysisResult: null,
    });
  });

  function seedMockResults() {
    usePlan.setState({
      retirementAgeAnalysisResult:
        mockRetirementAgeResult as unknown as RetirementAgeAnalysisResult[],
      spendingAnalysisResult: mockSpendingResult as unknown as SpendingAnalysisResult[],
      ssAnalysisResult: mockSSResult as unknown as SSAnalysisResult[],
    });
  }

  function expectAllCleared() {
    expect(usePlan.getState().retirementAgeAnalysisResult).toBeNull();
    expect(usePlan.getState().spendingAnalysisResult).toBeNull();
    expect(usePlan.getState().ssAnalysisResult).toBeNull();
  }

  it('should clear all analysis results when profile changes', () => {
    seedMockResults();
    usePlan.getState().updatePlan({ profile: { retirementAge: 58 } });
    expectAllCleared();
  });

  it('should clear all analysis results when social security settings change', () => {
    seedMockResults();
    usePlan.getState().updatePlan({ socialSecurity: { claimAge: 65 } });
    expectAllCleared();
  });

  it('should clear all analysis results when assumptions change', () => {
    seedMockResults();
    usePlan.getState().updatePlan({ assumptions: { randomSeed: 123 } });
    expectAllCleared();
  });

  it('enters cloud mode only after both identity setup and cloud reads succeed', () => {
    usePlan.setState({ authUser: { id: 'user-1' }, cloudAccountReady: true });
    expect(usePlan.getState().dataMode()).toBe('local');

    usePlan.setState({ cloudAvailable: true });
    expect(usePlan.getState().dataMode()).toBe('cloud');

    usePlan.setState({ cloudAccountReady: false });
    expect(usePlan.getState().dataMode()).toBe('local');
  });

  it('rejects invalid plan transitions before persistence or simulation', () => {
    const previousPlan = usePlan.getState().plan;
    usePlan.getState().updatePlan({ profile: { lifeExpectancy: 10 } });
    expect(usePlan.getState().plan).toBe(previousPlan);
    expect(usePlan.getState().error).toContain('Plan change was not applied');
  });

  it('migrates legacy spending fields into explicit working and retirement phases', () => {
    const migrated = hydratePlan({
      age: 40,
      birthYear: 1986,
      asOfDate: '2026-01-01',
      currentSpending: 48_000,
      desiredSpending: 60_000,
      spendingGrowthRate: 0.02,
    }, null, null, []);

    expect(migrated.profile).toMatchObject({
      currentSpending: 48_000,
      workingSpendingGrowthRate: 0,
      retirementSpending: 60_000,
      retirementSpendingGrowthRate: 0.02,
    });
    expect(migrated.profile).not.toHaveProperty('desiredSpending');
    expect(migrated.profile).not.toHaveProperty('spendingGrowthRate');
  });

  it('reads contribution intent out of legacy per-account targets', () => {
    const base = { age: 40, birthYear: 1986, asOfDate: '2026-01-01' };
    const legacy = {
      simulationModel: 'historical',
      taxableGainRatio: 0.5,
      contributions: { hsa: 4_300, traditional: 23_500, roth: 7_000, taxable: 30_000 },
    };

    const funded = hydratePlan(base, null, legacy, []);
    expect(funded.assumptions.hsaEligible).toBe(true);
    expect(funded.assumptions.useBackdoorRoth).toBe(true);
    expect(funded.assumptions).not.toHaveProperty('contributions');

    // A zero target meant the household had no such space to fill.
    const unfunded = hydratePlan(base, null, {
      ...legacy,
      contributions: { hsa: 0, traditional: 23_500, roth: 0, taxable: 30_000 },
    }, []);
    expect(unfunded.assumptions.hsaEligible).toBe(false);
    expect(unfunded.assumptions.useBackdoorRoth).toBe(false);
  });

  it('honors the pre-4113fbe backdoor Roth flag when a plan still carries it', () => {
    const migrated = hydratePlan(
      { age: 40, birthYear: 1986, asOfDate: '2026-01-01' },
      null,
      { simulationModel: 'historical', taxableGainRatio: 0.5, useBackdoorRoth: false },
      [],
    );
    expect(migrated.assumptions.useBackdoorRoth).toBe(false);
  });
});
