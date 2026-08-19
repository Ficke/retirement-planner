import { describe, it, expect } from 'vitest';
import { calculateSSABenefit } from '@/engine/ssa';
import { calculateRetirementTax,
  householdOf,
} from '@/engine/tax';

describe('Bug Fixes', () => {
  describe('Social Security Age Adjustment Bug', () => {
    const testSalaryHistory = Array(35).fill(80000); // 35 years at $80k for consistent testing
    
    it('should apply early claiming penalty at age 62 (FRA 67 → 30% reduction)', () => {
      const result = calculateSSABenefit(testSalaryHistory, 62);
      expect(result.claimAdjustment).toBeCloseTo(0.70, 12);
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
      const taxResult = calculateRetirementTax({ traditionalWithdrawals: 91400, socialSecurityBenefit: 0, qualifiedIncome: 0, household: householdOf('Single', 67), state: 'CA', taxYear: 2026 });
      
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
      const taxResult = calculateRetirementTax({ traditionalWithdrawals: 50000, socialSecurityBenefit: 20000, qualifiedIncome: 10000, household: householdOf('Single', 65), state: 'CA', taxYear: 2026 });
      
      expect(taxResult.totalTax).toBeGreaterThan(0);
      expect(taxResult.ficaTax).toBe(0); // No FICA in retirement
      expect(taxResult.k401Contribution).toBe(0); // No contributions in retirement
      expect(taxResult.hsaContribution).toBe(0); // No contributions in retirement
    });
    
    it('should apply senior standard deduction for 65+ taxpayers', () => {
      const under65Tax = calculateRetirementTax({ traditionalWithdrawals: 50000, socialSecurityBenefit: 0, qualifiedIncome: 0, household: householdOf('Single', 64), state: 'CA', taxYear: 2026 });
      const over65Tax = calculateRetirementTax({ traditionalWithdrawals: 50000, socialSecurityBenefit: 0, qualifiedIncome: 0, household: householdOf('Single', 65), state: 'CA', taxYear: 2026 });
      
      // Over 65 should pay less tax due to higher standard deduction
      expect(over65Tax.totalTax).toBeLessThan(under65Tax.totalTax);
    });
  });
});
