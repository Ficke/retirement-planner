import { describe, it, expect } from 'vitest';
import { calculateSSABenefit } from '@/engine/ssa';
import { calculateRetirementTax } from '@/engine/tax';

describe('Bug Fixes', () => {
  describe('Social Security Age Adjustment Bug', () => {
    const testSalaryHistory = Array(35).fill(80000); // 35 years at $80k for consistent testing
    
    it('should apply early claiming penalty at age 62 (FRA 67 → 30% reduction)', () => {
      const result = calculateSSABenefit(testSalaryHistory, 62);
      expect(result.claimAdjustment).toBe(0.70);
      expect(result.annualBenefit).toBeGreaterThan(0);
    });
    
    it('should give full benefit at full retirement age 67', () => {
      const result = calculateSSABenefit(testSalaryHistory, 67);
      expect(result.claimAdjustment).toBe(1.0); // Full benefit
      expect(result.annualBenefit).toBeGreaterThan(0);
    });
    
    it('should apply delayed retirement credit at age 70', () => {
      const result = calculateSSABenefit(testSalaryHistory, 70);
      expect(result.claimAdjustment).toBe(1.24); // 24% increase
      expect(result.annualBenefit).toBeGreaterThan(0);
    });
    
    it('should show proper benefit progression by claim age', () => {
      const benefit62 = calculateSSABenefit(testSalaryHistory, 62);
      const benefit67 = calculateSSABenefit(testSalaryHistory, 67);
      const benefit70 = calculateSSABenefit(testSalaryHistory, 70);
      
      // Benefits should increase with later claiming
      expect(benefit62.annualBenefit).toBeLessThan(benefit67.annualBenefit);
      expect(benefit67.annualBenefit).toBeLessThan(benefit70.annualBenefit);
      
      // Verify approximate ratios
      expect(benefit70.annualBenefit / benefit67.annualBenefit).toBeCloseTo(1.24, 2);
      expect(benefit62.annualBenefit / benefit67.annualBenefit).toBeCloseTo(0.70, 2);
    });
  });
  
  describe('Retirement Tax Calculation Bug', () => {
    it('should calculate realistic taxes on Traditional withdrawals', () => {
      // Test case from bug report: $91.4K withdrawal should yield much more than $2.1K taxes
      const taxResult = calculateRetirementTax(
        91400, // Traditional withdrawal (ordinary income)
        0,     // No SS benefits
        0,     // No LTCG
        67,    // Age 67
        'Single',
        'CA'
      );
      
      // Should be significantly higher than the buggy $2.1K
      expect(taxResult.totalTax).toBeGreaterThan(10000); // At least $10K
      expect(taxResult.totalTax).toBeLessThan(30000); // But reasonable upper bound
      
      // Should have no FICA taxes in retirement
      expect(taxResult.ficaTax).toBe(0);
      
      // Should have both federal and CA state taxes
      expect(taxResult.federalTax).toBeGreaterThan(0);
      expect(taxResult.stateTax).toBeGreaterThan(0);
    });
    
    it('should handle mixed withdrawal sources correctly', () => {
      const taxResult = calculateRetirementTax(
        50000, // Traditional withdrawal
        20000, // SS benefits
        10000, // LTCG from taxable account
        65,    // Age 65 (gets senior deduction)
        'Single',
        'CA'
      );
      
      expect(taxResult.totalTax).toBeGreaterThan(0);
      expect(taxResult.ficaTax).toBe(0); // No FICA in retirement
      expect(taxResult.k401Contribution).toBe(0); // No contributions in retirement
      expect(taxResult.backdoorRothContribution).toBe(0); // No contributions in retirement
    });
    
    it('should apply senior standard deduction for 65+ taxpayers', () => {
      const under65Tax = calculateRetirementTax(50000, 0, 0, 64, 'Single', 'CA');
      const over65Tax = calculateRetirementTax(50000, 0, 0, 65, 'Single', 'CA');
      
      // Over 65 should pay less tax due to higher standard deduction
      expect(over65Tax.totalTax).toBeLessThan(under65Tax.totalTax);
    });
  });
});