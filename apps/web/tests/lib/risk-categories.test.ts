import { describe, it, expect } from 'vitest';
import {
  categorizeRisk,
  findMaxValueForRiskLevel,
  findMinValueForRiskLevel,
  RISK_THRESHOLDS
} from '@/lib/risk-categories';

describe('Risk Categories', () => {
  describe('categorizeRisk', () => {
    it('should categorize risks correctly', () => {
      expect(categorizeRisk(0.03).category).toBe('Conservative');
      expect(categorizeRisk(0.07).category).toBe('Moderate');
      expect(categorizeRisk(0.15).category).toBe('Aggressive');
      expect(categorizeRisk(0.25).category).toBe('High Risk');
    });

    it('should have consistent visual styling', () => {
      const conservative = categorizeRisk(0.03);
      expect(conservative.color).toBe('text-emerald-600');
      expect(conservative.bg).toBe('bg-emerald-50');
      expect(conservative.emoji).toBe('🛡️');
    });
  });

  describe('findMaxValueForRiskLevel (for spending analysis)', () => {
    const spendingResults = [
      { annualSpending: 50000, result: { riskOfRuin: 0.03 } }, // Conservative
      { annualSpending: 60000, result: { riskOfRuin: 0.04 } }, // Conservative
      { annualSpending: 70000, result: { riskOfRuin: 0.08 } }, // Moderate
      { annualSpending: 80000, result: { riskOfRuin: 0.12 } }, // Aggressive
      { annualSpending: 90000, result: { riskOfRuin: 0.18 } }, // Aggressive
      { annualSpending: 100000, result: { riskOfRuin: 0.25 } }, // High Risk
    ];

    it('should find maximum spending within risk tolerance', () => {
      const conservative = findMaxValueForRiskLevel(spendingResults, RISK_THRESHOLDS.CONSERVATIVE);
      const moderate = findMaxValueForRiskLevel(spendingResults, RISK_THRESHOLDS.MODERATE);
      const aggressive = findMaxValueForRiskLevel(spendingResults, RISK_THRESHOLDS.AGGRESSIVE);

      expect(conservative?.annualSpending).toBe(60000); // Highest spending ≤ 5% risk
      expect(moderate?.annualSpending).toBe(70000);     // Highest spending ≤ 10% risk
      expect(aggressive?.annualSpending).toBe(90000);   // Highest spending ≤ 20% risk
    });
  });

  describe('findMinValueForRiskLevel (for retirement age analysis)', () => {
    const retirementAgeResults = [
      { retirementAge: 50, result: { riskOfRuin: 0.30 } }, // High Risk
      { retirementAge: 55, result: { riskOfRuin: 0.18 } }, // Aggressive
      { retirementAge: 60, result: { riskOfRuin: 0.08 } }, // Moderate
      { retirementAge: 62, result: { riskOfRuin: 0.04 } }, // Conservative
      { retirementAge: 65, result: { riskOfRuin: 0.02 } }, // Conservative
      { retirementAge: 67, result: { riskOfRuin: 0.01 } }, // Conservative
    ];

    it('should find earliest retirement age within risk tolerance', () => {
      const conservative = findMinValueForRiskLevel(retirementAgeResults, RISK_THRESHOLDS.CONSERVATIVE);
      const moderate = findMinValueForRiskLevel(retirementAgeResults, RISK_THRESHOLDS.MODERATE);
      const aggressive = findMinValueForRiskLevel(retirementAgeResults, RISK_THRESHOLDS.AGGRESSIVE);

      expect(conservative?.retirementAge).toBe(62); // Earliest age ≤ 5% risk
      expect(moderate?.retirementAge).toBe(60);     // Earliest age ≤ 10% risk
      expect(aggressive?.retirementAge).toBe(55);   // Earliest age ≤ 20% risk
    });

    it('should return null if no options meet risk tolerance', () => {
      const highRiskResults = [
        { retirementAge: 50, result: { riskOfRuin: 0.30 } },
        { retirementAge: 55, result: { riskOfRuin: 0.25 } },
      ];

      const conservative = findMinValueForRiskLevel(highRiskResults, RISK_THRESHOLDS.CONSERVATIVE);
      expect(conservative).toBeNull();
    });
  });

  describe('Different behavior for spending vs retirement age', () => {
    it('should demonstrate the difference between min and max finding', () => {
      const analysisResults = [
        { value: 100, result: { riskOfRuin: 0.03 } },
        { value: 200, result: { riskOfRuin: 0.04 } },
        { value: 300, result: { riskOfRuin: 0.08 } },
      ];

      // For spending: want maximum spending (value 200) within 5% risk
      const maxValue = findMaxValueForRiskLevel(analysisResults, 0.05);
      expect(maxValue?.value).toBe(200);

      // For retirement age: want minimum age (value 100) within 5% risk
      const minValue = findMinValueForRiskLevel(analysisResults, 0.05);
      expect(minValue?.value).toBe(100);
    });
  });
});