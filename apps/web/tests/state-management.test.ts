import { describe, it, expect, beforeEach } from 'vitest';
import { usePlan } from '@/state/usePlan';
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
    usePlan.getState().updatePlan({ assumptions: { useBackdoorRoth: false } });
    expectAllCleared();
  });
});