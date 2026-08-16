import { describe, it, expect } from 'vitest';
import {
  calculateRetirementTax,
  calculateTaxableSocialSecurity,
  calculateWorkingCashFlow,
} from '@/engine/tax';

describe('Retirement Tax Calculation', () => {
  it('taxes working-year RMD income without applying payroll tax to it', () => {
    const policy = { hsaEligible: false, useBackdoorRoth: false };
    const wagesOnly = calculateWorkingCashFlow(
      100_000,
      60_000,
      75,
      'Single',
      'TX',
      policy,
    );
    const withRmd = calculateWorkingCashFlow(
      100_000,
      60_000,
      75,
      'Single',
      'TX',
      policy,
      { ordinary: 40_000, qualified: 0 },
    );

    expect(withRmd.tax.ficaTax).toBe(wagesOnly.tax.ficaTax);
    expect(withRmd.tax.totalTax).toBeGreaterThan(wagesOnly.tax.totalTax);
    // RMD proceeds are income the household did not spend, so they land in taxable.
    expect(withRmd.contributions.taxable).toBeGreaterThan(wagesOnly.contributions.taxable);
  });

  describe('Working-year cash flow', () => {
    it('invests the entire residual, leaving nothing unallocated', () => {
      const result = calculateWorkingCashFlow(
        100_000,
        50_000,
        40,
        'Single',
        'TX',
        { hsaEligible: true, useBackdoorRoth: true },
      );

      // Gross is fully accounted for: taxed, spent, or saved. No fourth bucket.
      expect(
        result.tax.totalTax + 50_000 + result.totalContributions,
      ).toBeCloseTo(100_000, 6);
      expect(result.contributions.taxable).toBeGreaterThanOrEqual(0);
    });

    it('fills tax-advantaged space to its statutory limits before taxable', () => {
      const result = calculateWorkingCashFlow(
        500_000,
        40_000,
        40,
        'Single',
        'TX',
        { hsaEligible: true, useBackdoorRoth: true },
      );

      expect(result.contributions.hsa).toBe(4_300);
      expect(result.contributions.traditional).toBe(23_500);
      expect(result.contributions.roth).toBe(7_000);
      // A high earner has far more residual than the limits absorb.
      expect(result.contributions.taxable).toBeGreaterThan(100_000);
    });

    it('skips the space the household cannot use, without losing the cash', () => {
      const eligible = calculateWorkingCashFlow(
        200_000, 40_000, 40, 'Single', 'TX',
        { hsaEligible: true, useBackdoorRoth: true },
      );
      const ineligible = calculateWorkingCashFlow(
        200_000, 40_000, 40, 'Single', 'TX',
        { hsaEligible: false, useBackdoorRoth: false },
      );

      expect(ineligible.contributions.hsa).toBe(0);
      expect(ineligible.contributions.roth).toBe(0);
      // The money still gets saved — it just goes to taxable instead.
      expect(ineligible.contributions.taxable)
        .toBeGreaterThan(eligible.contributions.taxable);
    });

    it('reports a funding gap when spending outruns after-tax income', () => {
      const result = calculateWorkingCashFlow(
        50_000,
        60_000,
        40,
        'Single',
        'TX',
        { hsaEligible: false, useBackdoorRoth: false },
      );
      expect(result.fundingGap).toBeGreaterThan(10_000);
      expect(result.totalContributions).toBe(0);
    });
  });

  describe('Bug Fix Verification', () => {
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
      
      // No retirement contributions
      expect(taxResult.k401Contribution).toBe(0);
      expect(taxResult.hsaContribution).toBe(0);
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
      expect(taxResult.federalTax).toBeGreaterThan(0);
      expect(taxResult.stateTax).toBeGreaterThan(0);
    });
    
    it('should apply senior standard deduction for 65+ taxpayers', () => {
      const under65Tax = calculateRetirementTax(50000, 0, 0, 64, 'Single', 'CA');
      const over65Tax = calculateRetirementTax(50000, 0, 0, 65, 'Single', 'CA');
      
      // Over 65 should pay less tax due to higher standard deduction
      expect(over65Tax.totalTax).toBeLessThan(under65Tax.totalTax);
    });

    it('applies the 2025 enhanced senior deduction and phaseout', () => {
      const eligible = calculateRetirementTax(50_000, 0, 0, 65, 'Single', 'TX');
      expect(eligible.federalTax).toBeCloseTo(2_911.5, 2);

      const phasedOut = calculateRetirementTax(175_000, 0, 0, 65, 'Single', 'TX');
      const under65 = calculateRetirementTax(175_000, 0, 0, 64, 'Single', 'TX');
      expect(phasedOut.federalTax).toBe(under65.federalTax - 2_000 * 0.24);
    });

    it('uses final 2025 California brackets and standard deduction', () => {
      const result = calculateRetirementTax(100_000, 0, 0, 64, 'Single', 'CA');
      expect(result.stateTax).toBeCloseTo(5_207.98, 2);
    });
    
    it('should handle LTCG stacking correctly', () => {
      // Test LTCG preferential rates
      const noLTCGTax = calculateRetirementTax(40000, 0, 0, 67, 'Single', 'CA');
      const withLTCGTax = calculateRetirementTax(40000, 0, 20000, 67, 'Single', 'CA');
      
      // Adding LTCG should increase total tax, but not as much as ordinary income would
      expect(withLTCGTax.totalTax).toBeGreaterThan(noLTCGTax.totalTax);
      
      // LTCG should be taxed at preferential rates (0%, 15%, or 20%)
      const ltcgTaxAmount = withLTCGTax.totalTax - noLTCGTax.totalTax;
      expect(ltcgTaxAmount).toBeLessThan(20000 * 0.25); // Should be less than ordinary income rate
    });

    it('applies the Net Investment Income Tax above the filing threshold', () => {
      const result = calculateRetirementTax(0, 0, 250_000, 64, 'Single', 'TX');
      // $234,250 after the standard deduction: $185,800 at 15%, plus
      // 3.8% NIIT on the $50,000 of MAGI above $200,000.
      expect(result.federalTax).toBeCloseTo(29_770, 2);
    });
  });

  describe('Social Security Taxation', () => {
    it('applies the IRS 50% formula in the first taxable tier', () => {
      expect(calculateTaxableSocialSecurity(20_000, 20_000, 0, 'Single')).toBe(2_500);
    });

    it('caps the upper tier at 85% of benefits', () => {
      expect(calculateTaxableSocialSecurity(40_000, 20_000, 0, 'Single')).toBe(17_000);
    });

    it('excludes Social Security from California taxable income', () => {
      const withoutBenefits = calculateRetirementTax(20_000, 0, 0, 67, 'Single', 'CA');
      const withBenefits = calculateRetirementTax(20_000, 50_000, 0, 67, 'Single', 'CA');
      expect(withBenefits.stateTax).toBeCloseTo(withoutBenefits.stateTax, 8);
    });

    it('applies unused standard deduction to capital gains', () => {
      const result = calculateRetirementTax(0, 0, 10_000, 67, 'Single', 'TX');
      expect(result.federalTax).toBe(0);
    });
    it('should not tax SS when combined income is below threshold', () => {
      // Low income scenario - no SS should be taxable
      const taxResult = calculateRetirementTax(
        10000, // Traditional withdrawal
        20000, // SS benefits
        0,     // No LTCG
        67,    // Age 67
        'Single',
        'CA'
      );
      
      // Combined income = 10k + 0 + (20k * 0.5) = 20k < 25k threshold
      // So no SS should be taxable, only the 10k Traditional withdrawal
      expect(taxResult.totalTax).toBeLessThan(5000); // Should be low due to standard deduction
    });
    
    it('should tax 50% of SS when in middle tier', () => {
      // Middle income scenario - up to 50% SS taxable
      const taxResult = calculateRetirementTax(
        20000, // Traditional withdrawal
        20000, // SS benefits
        0,     // No LTCG
        67,    // Age 67
        'Single',
        'CA'
      );
      
      // Combined income = 20k + 0 + (20k * 0.5) = 30k (between 25k and 34k)
      // Some SS should be taxable but not all
      expect(taxResult.totalTax).toBeGreaterThan(0);
      expect(taxResult.totalTax).toBeLessThan(8000);
    });
    
    it('should tax up to 85% of SS when income is high', () => {
      // High income scenario - up to 85% SS taxable
      const taxResult = calculateRetirementTax(
        60000, // Traditional withdrawal
        30000, // SS benefits
        10000, // LTCG
        67,    // Age 67
        'Single',
        'CA'
      );
      
      // Combined income = 60k + 10k + (30k * 0.5) = 85k > 34k threshold
      // Up to 85% of SS should be taxable
      expect(taxResult.totalTax).toBeCloseTo(12797.17, 2);
    });
    
    it('should handle married filing jointly thresholds correctly', () => {
      // Married filing jointly has different thresholds ($32k/$44k vs $25k/$34k)
      const singleTax = calculateRetirementTax(25000, 20000, 0, 67, 'Single', 'CA');
      const marriedTax = calculateRetirementTax(25000, 20000, 0, 67, 'MarriedFilingJointly', 'CA');
      
      // Same income should result in less tax for married filers due to higher thresholds
      expect(marriedTax.totalTax).toBeLessThanOrEqual(singleTax.totalTax);
    });
  });

  describe('Real-World Scenario Validation', () => {
    it('should calculate correct taxes for screenshot scenario', () => {
      // From user screenshot: Age 57, $25.2K Traditional, $58.3K Taxable (50% LTCG)
      const taxResult = calculateRetirementTax(
        25200, // Traditional withdrawal (ordinary income)
        0,     // No SS benefits at age 57
        29150, // 50% of $58.3K taxable withdrawal = LTCG
        57,    // Age 57
        'Single',
        'CA'
      );
      
      console.log(`Detailed tax breakdown for screenshot scenario:`);
      console.log(`Traditional: $25,200 (ordinary income)`);
      console.log(`LTCG: $29,150 (from taxable accounts)`);
      console.log(`Federal tax: $${taxResult.federalTax.toFixed(0)}`);
      console.log(`State tax: $${taxResult.stateTax.toFixed(0)}`);
      console.log(`Total tax: $${taxResult.totalTax.toFixed(0)}`);
      console.log(`Effective rate: ${(taxResult.effectiveRate * 100).toFixed(1)}%`);
      
      // This might actually be correct due to:
      // 1. Standard deduction ($15K federal) covers most of Traditional withdrawal
      // 2. LTCG at 0% rate for income under $48,450
      // 3. CA has lower rates on moderate income
      expect(taxResult.totalTax).toBeGreaterThan(2000);
      expect(taxResult.totalTax).toBeLessThan(4000);
      expect(taxResult.ficaTax).toBe(0);
    });
    
    it('should show much higher taxes when Traditional withdrawals are larger', () => {
      // Test scenario with more Traditional withdrawals
      const highTraditionalTax = calculateRetirementTax(
        70000, // Much larger Traditional withdrawal
        0,     // No SS
        15000, // Some LTCG
        67,    // Age 67
        'Single',
        'CA'
      );
      
      // Should be much higher tax rate
      expect(highTraditionalTax.totalTax).toBeCloseTo(11206.48, 2);
      expect(highTraditionalTax.effectiveRate).toBeGreaterThan(0.13);
    });
  });
});
