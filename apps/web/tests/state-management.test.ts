import { describe, it, expect, beforeEach } from 'vitest';
import { usePlan } from '@/state/usePlan';

describe('State Management - Analysis Clearing Logic', () => {
  // Mock analysis results
  const mockSSResult = [{ claimAge: 67, result: { successProbability: 0.9, riskOfRuin: 0.1 } }];
  const mockSpendingResult = [{ annualSpending: 75000, result: { successProbability: 0.9, riskOfRuin: 0.1 } }];
  const mockRetirementAgeResult = [{ retirementAge: 60, result: { successProbability: 0.9, riskOfRuin: 0.1 } }];

  beforeEach(() => {
    // Reset state before each test
    usePlan.getState().reset();
  });

  it('should NOT clear retirement age analysis when retirement age changes', () => {
    const { updateProfile, retirementAgeAnalysisResult } = usePlan.getState();

    // Set mock results
    usePlan.setState({
      retirementAgeAnalysisResult: mockRetirementAgeResult as any
    });

    // Change retirement age (independent variable for retirement age analysis)
    updateProfile({ retirementAge: 58 });

    // Retirement age analysis should NOT be cleared
    expect(usePlan.getState().retirementAgeAnalysisResult).not.toBeNull();
    expect(usePlan.getState().retirementAgeAnalysisResult).toEqual(mockRetirementAgeResult);
  });

  it('should NOT clear spending analysis when spending changes', () => {
    const { updateProfile } = usePlan.getState();

    // Set mock results
    usePlan.setState({
      spendingAnalysisResult: mockSpendingResult as any
    });

    // Change spending (independent variable for spending analysis)
    updateProfile({ desiredSpending: 80000 });

    // Spending analysis should NOT be cleared
    expect(usePlan.getState().spendingAnalysisResult).not.toBeNull();
    expect(usePlan.getState().spendingAnalysisResult).toEqual(mockSpendingResult);
  });

  it('should NOT clear SS analysis when claim age changes', () => {
    const { updateSocialSecurity } = usePlan.getState();

    // Set mock results
    usePlan.setState({
      ssAnalysisResult: mockSSResult as any
    });

    // Change claim age (independent variable for SS analysis)
    updateSocialSecurity({ claimAge: 65 });

    // SS analysis should NOT be cleared (exclusion-based logic)
    expect(usePlan.getState().ssAnalysisResult).not.toBeNull();
    expect(usePlan.getState().ssAnalysisResult).toEqual(mockSSResult);
  });

  it('should clear retirement age analysis when life expectancy changes', () => {
    const { updateProfile } = usePlan.getState();

    // Set mock results
    usePlan.setState({
      retirementAgeAnalysisResult: mockRetirementAgeResult as any
    });

    // Change life expectancy (affects retirement age analysis)
    updateProfile({ lifeExpectancy: 90 });

    // Retirement age analysis SHOULD be cleared
    expect(usePlan.getState().retirementAgeAnalysisResult).toBeNull();
  });

  it('should clear spending analysis when retirement age changes', () => {
    const { updateProfile } = usePlan.getState();

    // Set mock results
    usePlan.setState({
      spendingAnalysisResult: mockSpendingResult as any
    });

    // Change retirement age (affects how long money needs to last in spending analysis)
    updateProfile({ retirementAge: 55 });

    // Spending analysis SHOULD be cleared
    expect(usePlan.getState().spendingAnalysisResult).toBeNull();
  });

  it('should clear SS analysis when salary changes', () => {
    const { updateProfile } = usePlan.getState();

    // Set mock results
    usePlan.setState({
      ssAnalysisResult: mockSSResult as any
    });

    // Change salary (affects SS benefit calculation)
    updateProfile({ currentSalary: 150000 });

    // SS analysis SHOULD be cleared
    expect(usePlan.getState().ssAnalysisResult).toBeNull();
  });

  it('should clear SS analysis when SS settings change (non-claimAge)', () => {
    const { updateSocialSecurity } = usePlan.getState();

    // Set mock results
    usePlan.setState({
      ssAnalysisResult: mockSSResult as any
    });

    // Change SS enabled status (fundamental change to analysis)
    updateSocialSecurity({ enabled: false });

    // SS analysis SHOULD be cleared
    expect(usePlan.getState().ssAnalysisResult).toBeNull();
  });
});