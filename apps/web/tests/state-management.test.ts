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

  it('should clear all analysis results when profile changes (simplified invalidation)', () => {
    const { updateProfile } = usePlan.getState();

    // Set mock results
    usePlan.setState({
      retirementAgeAnalysisResult: mockRetirementAgeResult as any,
      spendingAnalysisResult: mockSpendingResult as any,
      ssAnalysisResult: mockSSResult as any
    });

    // Change any profile property
    updateProfile({ retirementAge: 58 });

    // ALL analysis results should be cleared (simple invalidation for simplicity)
    expect(usePlan.getState().retirementAgeAnalysisResult).toBeNull();
    expect(usePlan.getState().spendingAnalysisResult).toBeNull();
    expect(usePlan.getState().ssAnalysisResult).toBeNull();
  });

  it('should clear all analysis results when social security settings change', () => {
    const { updateSocialSecurity } = usePlan.getState();

    // Set mock results
    usePlan.setState({
      retirementAgeAnalysisResult: mockRetirementAgeResult as any,
      spendingAnalysisResult: mockSpendingResult as any,
      ssAnalysisResult: mockSSResult as any
    });

    // Change any SS setting
    updateSocialSecurity({ claimAge: 65 });

    // ALL analysis results should be cleared
    expect(usePlan.getState().retirementAgeAnalysisResult).toBeNull();
    expect(usePlan.getState().spendingAnalysisResult).toBeNull();
    expect(usePlan.getState().ssAnalysisResult).toBeNull();
  });

  it('should clear all analysis results when assumptions change', () => {
    const { updateAssumptions } = usePlan.getState();

    // Set mock results
    usePlan.setState({
      retirementAgeAnalysisResult: mockRetirementAgeResult as any,
      spendingAnalysisResult: mockSpendingResult as any,
      ssAnalysisResult: mockSSResult as any
    });

    // Change any assumption
    updateAssumptions({ useBackdoorRoth: false });

    // ALL analysis results should be cleared
    expect(usePlan.getState().retirementAgeAnalysisResult).toBeNull();
    expect(usePlan.getState().spendingAnalysisResult).toBeNull();
    expect(usePlan.getState().ssAnalysisResult).toBeNull();
  });
});