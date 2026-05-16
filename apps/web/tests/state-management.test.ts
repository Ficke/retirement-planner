import { describe, it, expect, beforeEach } from 'vitest';
import { usePlan } from '@/state/usePlan';

describe('State Management - Simple Invalidation Logic', () => {
  // Mock analysis results
  const mockSSResult = [{ claimAge: 67, result: { successProbability: 0.9, riskOfRuin: 0.1 } }];
  const mockSpendingResult = [{ annualSpending: 75000, result: { successProbability: 0.9, riskOfRuin: 0.1 } }];
  const mockRetirementAgeResult = [{ retirementAge: 60, result: { successProbability: 0.9, riskOfRuin: 0.1 } }];

  beforeEach(() => {
    // Reset state before each test
    usePlan.getState().reset();
  });

  function seedMockResults() {
    usePlan.setState({
      retirementAgeAnalysisResult: mockRetirementAgeResult as any,
      spendingAnalysisResult: mockSpendingResult as any,
      ssAnalysisResult: mockSSResult as any,
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
    usePlan.getState().updatePlan({ assumptions: { useBackdoorRoth: false } });
    expectAllCleared();
  });
});