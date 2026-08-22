import { describe, it, expect, beforeEach } from 'vitest';
import { cloudComputeEnabled, hydratePlan, usePlan } from '@/state/usePlan';
import { ageOn } from '@/domain/age';
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
      simulationPlan: null,
      simulationPending: false,
      sensitivityPending: false,
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

  /** Results outlive the edit that obsoleted them, so the UI can keep the last
   * completed run on screen while the next one computes. */
  function expectMarkedStale() {
    const state = usePlan.getState();
    expect(state.simulationPending).toBe(true);
    expect(state.sensitivityPending).toBe(true);
    expect(state.retirementAgeAnalysisResult).not.toBeNull();
    expect(state.spendingAnalysisResult).not.toBeNull();
    expect(state.ssAnalysisResult).not.toBeNull();
  }

  it('should mark analysis results stale when profile changes', () => {
    seedMockResults();
    usePlan.getState().updatePlan({ profile: { retirementAge: 58 } });
    expectMarkedStale();
  });

  it('should mark analysis results stale when social security settings change', () => {
    seedMockResults();
    usePlan.getState().updatePlan({ socialSecurity: { claimAge: 65 } });
    expectMarkedStale();
  });

  it('should mark analysis results stale when assumptions change', () => {
    seedMockResults();
    usePlan.getState().updatePlan({ assumptions: { randomSeed: 123 } });
    expectMarkedStale();
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
      birthDate: '1986-01-01',
      retirementHealthcare: { preMedicarePremium: 0, medicarePremium: 0, outOfPocket: 0, realGrowthRate: 0 },
      asOfDate: '2026-01-01',
      currentSpending: 48_000,
      desiredSpending: 60_000,
      spendingGrowthRate: 0.02,
    }, null, null, []);

    expect(migrated.profile).toMatchObject({
      currentSpending: 48_000,
      workingSpendingGrowthRate: 0,
      // $60k target on $48k of working-year spending.
      retirementSpendingMultiplier: 1.25,
      retirementSpendingGrowthRate: 0.02,
    });
    expect(migrated.profile).not.toHaveProperty('desiredSpending');
    expect(migrated.profile).not.toHaveProperty('spendingGrowthRate');
  });

  it('reads contribution intent out of legacy per-account targets', () => {
    const base = { birthDate: '1986-01-01', asOfDate: '2026-01-01' };
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

  it('rebuilds a birth date that reproduces a v2 plan stored age exactly', () => {
    // Birthday already passed at the as-of date: 2026 - 1986 === 40.
    const passed = hydratePlan(
      { age: 40, birthYear: 1986, asOfDate: '2026-06-01' }, null, null, [],
    );
    expect(ageOn(passed.profile.birthDate, '2026-06-01')).toBe(40);

    // Birthday still ahead: the calendar difference is one more than the age.
    const upcoming = hydratePlan(
      { age: 39, birthYear: 1986, asOfDate: '2026-06-01' }, null, null, [],
    );
    expect(ageOn(upcoming.profile.birthDate, '2026-06-01')).toBe(39);

    // Plans that never stored a birth year still land on their stored age.
    const yearless = hydratePlan(
      { age: 52, asOfDate: '2026-06-01' }, null, null, [],
    );
    expect(ageOn(yearless.profile.birthDate, '2026-06-01')).toBe(52);
  });

  it('honors the pre-4113fbe backdoor Roth flag when a plan still carries it', () => {
    const migrated = hydratePlan(
      { birthDate: '1986-01-01', asOfDate: '2026-01-01' },
      null,
      { simulationModel: 'historical', taxableGainRatio: 0.5, useBackdoorRoth: false },
      [],
    );
    expect(migrated.assumptions.useBackdoorRoth).toBe(false);
  });

  it('seeds a starter balance for a plan that was never stored, but not for a cleared one', () => {
    const fresh = hydratePlan(null, null, null, null);
    expect(fresh.accounts).toHaveLength(1);
    expect(fresh.accounts[0].balance).toBe(100_000);
    expect(fresh.accounts[0].assetWeights.stocks).toBe(1);

    const cleared = hydratePlan(null, null, null, []);
    expect(cleared.accounts).toEqual([]);
  });
});

describe('cloud compute gating', () => {
  it('uses the compute preference independently of the persistence mode', () => {
    expect(cloudComputeEnabled({ useServerSideCalculations: true })).toBe(true);
    expect(cloudComputeEnabled({ useServerSideCalculations: false })).toBe(false);
  });
});
