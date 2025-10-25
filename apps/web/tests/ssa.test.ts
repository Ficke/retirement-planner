import { describe, it, expect } from 'vitest';
import { calculateSSABenefit, calculateAIME, calculatePIA, getClaimAgeAdjustment } from '@/engine/ssa';

describe('Social Security Administration', () => {
  const testSalaryHistory = Array(35).fill(80000); // 35 years at $80k
  
  describe('Claim Age Adjustments', () => {
    it('should apply early claiming penalty at age 62', () => {
      const adjustment = getClaimAgeAdjustment(62);
      expect(adjustment).toBe(0.75); // 25% reduction
    });
    
    it('should give full benefit at full retirement age 67', () => {
      const adjustment = getClaimAgeAdjustment(67);
      expect(adjustment).toBe(1.0); // Full benefit
    });
    
    it('should apply delayed retirement credit at age 70', () => {
      const adjustment = getClaimAgeAdjustment(70);
      expect(adjustment).toBe(1.24); // 24% increase
    });
  });
  
  describe('Full Benefit Calculation', () => {
    it('should show proper benefit progression by claim age', () => {
      const benefit62 = calculateSSABenefit(testSalaryHistory, 62);
      const benefit67 = calculateSSABenefit(testSalaryHistory, 67);
      const benefit70 = calculateSSABenefit(testSalaryHistory, 70);
      
      // Benefits should increase with later claiming
      expect(benefit62.annualBenefit).toBeLessThan(benefit67.annualBenefit);
      expect(benefit67.annualBenefit).toBeLessThan(benefit70.annualBenefit);
      
      // Verify claim adjustments are applied correctly
      expect(benefit62.claimAdjustment).toBe(0.75);
      expect(benefit67.claimAdjustment).toBe(1.0);
      expect(benefit70.claimAdjustment).toBe(1.24);
      
      // All should have same PIA (before adjustment)
      expect(benefit62.pia).toBe(benefit67.pia);
      expect(benefit67.pia).toBe(benefit70.pia);
    });
    
    it('should calculate reasonable AIME from salary history', () => {
      const aime = calculateAIME(testSalaryHistory);
      
      // $80k annual = ~$6,667 monthly
      expect(aime).toBeCloseTo(6667, -2); // Within $100/month
      expect(aime).toBeGreaterThan(6000);
      expect(aime).toBeLessThan(8000);
    });
    
    it('should calculate reasonable PIA using bend points', () => {
      const aime = calculateAIME(testSalaryHistory);
      const pia = calculatePIA(aime, [
        { threshold: 1174, rate: 0.90 },
        { threshold: 7078, rate: 0.32 },
        { threshold: null, rate: 0.15 },
      ]);
      
      // Should be positive and reasonable
      expect(pia).toBeGreaterThan(1000); // At least $1k/month
      expect(pia).toBeLessThan(4000); // But not unreasonably high
    });
  });
});