import { describe, it, expect } from 'vitest';
import {
  calculateRetirementTax,
  calculateTaxableSocialSecurity,
  calculateWorkingCashFlow,
  householdOf,
} from '@/engine/tax';

describe('Retirement Tax Calculation', () => {
  it('taxes working-year RMD income without applying payroll tax to it', () => {
    const policy = { hsaEligible: false, useBackdoorRoth: false };
    const wagesOnly = calculateWorkingCashFlow({ grossIncome: 100_000, annualSpending: 60_000, household: householdOf('Single', 75), state: 'TX', taxYear: 2026, policy: policy });
    const withRmd = calculateWorkingCashFlow({ grossIncome: 100_000, annualSpending: 60_000, household: householdOf('Single', 75), state: 'TX', taxYear: 2026, policy: policy, other: { ordinary: 40_000, qualified: 0 } });

    expect(withRmd.tax.ficaTax).toBe(wagesOnly.tax.ficaTax);
    expect(withRmd.tax.totalTax).toBeGreaterThan(wagesOnly.tax.totalTax);
    // RMD proceeds are income the household did not spend, so they land in taxable.
    expect(withRmd.contributions.taxable).toBeGreaterThan(wagesOnly.contributions.taxable);
  });

  describe('Working-year cash flow', () => {
    it('invests the entire residual, leaving nothing unallocated', () => {
      const result = calculateWorkingCashFlow({ grossIncome: 100_000, annualSpending: 50_000, household: householdOf('Single', 40), state: 'TX', taxYear: 2026, policy: { hsaEligible: true, useBackdoorRoth: true } });

      // Gross is fully accounted for: taxed, spent, or saved. No fourth bucket.
      expect(
        result.tax.totalTax + 50_000 + result.totalContributions,
      ).toBeCloseTo(100_000, 6);
      expect(result.contributions.taxable).toBeGreaterThanOrEqual(0);
    });

    it('fills tax-advantaged space to its statutory limits before taxable', () => {
      const result = calculateWorkingCashFlow({ grossIncome: 500_000, annualSpending: 40_000, household: householdOf('Single', 40), state: 'TX', taxYear: 2026, policy: { hsaEligible: true, useBackdoorRoth: true } });

      expect(result.contributions.hsa).toBe(4_300);
      expect(result.contributions.traditional).toBe(23_500);
      expect(result.contributions.roth).toBe(7_000);
      // A high earner has far more residual than the limits absorb.
      expect(result.contributions.taxable).toBeGreaterThan(100_000);
    });

    it('skips the space the household cannot use, without losing the cash', () => {
      const eligible = calculateWorkingCashFlow({ grossIncome: 200_000, annualSpending: 40_000, household: householdOf('Single', 40), state: 'TX', taxYear: 2026, policy: { hsaEligible: true, useBackdoorRoth: true } });
      const ineligible = calculateWorkingCashFlow({ grossIncome: 200_000, annualSpending: 40_000, household: householdOf('Single', 40), state: 'TX', taxYear: 2026, policy: { hsaEligible: false, useBackdoorRoth: false } });

      expect(ineligible.contributions.hsa).toBe(0);
      expect(ineligible.contributions.roth).toBe(0);
      // The money still gets saved — it just goes to taxable instead.
      expect(ineligible.contributions.taxable)
        .toBeGreaterThan(eligible.contributions.taxable);
    });

    it('taxes capital gains realized in a working year', () => {
      const base = {
        grossIncome: 200_000,
        annualSpending: 60_000,
        household: householdOf('Single', 45),
        state: 'CA' as const,
        taxYear: 2026,
        policy: { hsaEligible: false, useBackdoorRoth: false },
      };
      const wagesOnly = calculateWorkingCashFlow({ ...base, other: { ordinary: 0, qualified: 0 } });
      const withGains = calculateWorkingCashFlow({
        ...base,
        other: { ordinary: 0, qualified: 100_000 },
      });

      // Federal takes them at preferential rates; California taxes them as
      // ordinary income. Neither charges payroll tax on a gain.
      expect(withGains.tax.federalTax).toBeGreaterThan(wagesOnly.tax.federalTax);
      expect(withGains.tax.stateTax).toBeGreaterThan(wagesOnly.tax.stateTax);
      expect(withGains.tax.ficaTax).toBeCloseTo(wagesOnly.tax.ficaTax, 2);
    });

    it('taxes a working-year gain more gently than a working-year RMD', () => {
      const base = {
        grossIncome: 200_000,
        annualSpending: 60_000,
        household: householdOf('Single', 45),
        state: 'TX' as const,
        taxYear: 2026,
        policy: { hsaEligible: false, useBackdoorRoth: false },
      };
      const qualified = calculateWorkingCashFlow({
        ...base,
        other: { ordinary: 0, qualified: 50_000 },
      });
      const ordinary = calculateWorkingCashFlow({
        ...base,
        other: { ordinary: 50_000, qualified: 0 },
      });
      expect(qualified.tax.federalTax).toBeLessThan(ordinary.tax.federalTax);
    });

    it('reports a funding gap when spending outruns after-tax income', () => {
      const result = calculateWorkingCashFlow({ grossIncome: 50_000, annualSpending: 60_000, household: householdOf('Single', 40), state: 'TX', taxYear: 2026, policy: { hsaEligible: false, useBackdoorRoth: false } });
      expect(result.fundingGap).toBeGreaterThan(10_000);
      expect(result.totalContributions).toBe(0);
    });
  });

  describe('Bug Fix Verification', () => {
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
      
      // No retirement contributions
      expect(taxResult.k401Contribution).toBe(0);
      expect(taxResult.hsaContribution).toBe(0);
    });
    
    it('should handle mixed withdrawal sources correctly', () => {
      const taxResult = calculateRetirementTax({ traditionalWithdrawals: 50000, socialSecurityBenefit: 20000, qualifiedIncome: 10000, household: householdOf('Single', 65), state: 'CA', taxYear: 2026 });
      
      expect(taxResult.totalTax).toBeGreaterThan(0);
      expect(taxResult.ficaTax).toBe(0); // No FICA in retirement
      expect(taxResult.federalTax).toBeGreaterThan(0);
      expect(taxResult.stateTax).toBeGreaterThan(0);
    });
    
    it('should apply senior standard deduction for 65+ taxpayers', () => {
      const under65Tax = calculateRetirementTax({ traditionalWithdrawals: 50000, socialSecurityBenefit: 0, qualifiedIncome: 0, household: householdOf('Single', 64), state: 'CA', taxYear: 2026 });
      const over65Tax = calculateRetirementTax({ traditionalWithdrawals: 50000, socialSecurityBenefit: 0, qualifiedIncome: 0, household: householdOf('Single', 65), state: 'CA', taxYear: 2026 });
      
      // Over 65 should pay less tax due to higher standard deduction
      expect(over65Tax.totalTax).toBeLessThan(under65Tax.totalTax);
    });

    it('applies the 2025 enhanced senior deduction and phaseout', () => {
      const eligible = calculateRetirementTax({ traditionalWithdrawals: 50_000, socialSecurityBenefit: 0, qualifiedIncome: 0, household: householdOf('Single', 65), state: 'TX', taxYear: 2026 });
      expect(eligible.federalTax).toBeCloseTo(2_911.5, 2);

      const phasedOut = calculateRetirementTax({ traditionalWithdrawals: 175_000, socialSecurityBenefit: 0, qualifiedIncome: 0, household: householdOf('Single', 65), state: 'TX', taxYear: 2026 });
      const under65 = calculateRetirementTax({ traditionalWithdrawals: 175_000, socialSecurityBenefit: 0, qualifiedIncome: 0, household: householdOf('Single', 64), state: 'TX', taxYear: 2026 });
      expect(phasedOut.federalTax).toBe(under65.federalTax - 2_000 * 0.24);
    });

    it('uses final 2025 California brackets and standard deduction', () => {
      const result = calculateRetirementTax({ traditionalWithdrawals: 100_000, socialSecurityBenefit: 0, qualifiedIncome: 0, household: householdOf('Single', 64), state: 'CA', taxYear: 2026 });
      expect(result.stateTax).toBeCloseTo(5_207.98, 2);
    });
    
    it('should handle LTCG stacking correctly', () => {
      // Test LTCG preferential rates
      const noLTCGTax = calculateRetirementTax({ traditionalWithdrawals: 40000, socialSecurityBenefit: 0, qualifiedIncome: 0, household: householdOf('Single', 67), state: 'CA', taxYear: 2026 });
      const withLTCGTax = calculateRetirementTax({ traditionalWithdrawals: 40000, socialSecurityBenefit: 0, qualifiedIncome: 20000, household: householdOf('Single', 67), state: 'CA', taxYear: 2026 });
      
      // Adding LTCG should increase total tax, but not as much as ordinary income would
      expect(withLTCGTax.totalTax).toBeGreaterThan(noLTCGTax.totalTax);
      
      // LTCG should be taxed at preferential rates (0%, 15%, or 20%)
      const ltcgTaxAmount = withLTCGTax.totalTax - noLTCGTax.totalTax;
      expect(ltcgTaxAmount).toBeLessThan(20000 * 0.25); // Should be less than ordinary income rate
    });

    it('applies the Net Investment Income Tax above the filing threshold', () => {
      const result = calculateRetirementTax({ traditionalWithdrawals: 0, socialSecurityBenefit: 0, qualifiedIncome: 250_000, household: householdOf('Single', 64), state: 'TX', taxYear: 2025 });
      // $234,250 after the standard deduction: $185,800 at 15%, plus
      // 3.8% NIIT on the $50,000 of MAGI above $200,000.
      expect(result.federalTax).toBeCloseTo(29_770, 2);
    });

    it('erodes the thresholds Congress never indexed', () => {
      const args = {
        traditionalWithdrawals: 0,
        socialSecurityBenefit: 0,
        qualifiedIncome: 250_000,
        household: householdOf('Single', 64),
        state: 'TX' as const,
      };
      // The $200,000 NIIT threshold is fixed in nominal dollars, so in the real
      // dollars the engine works in it shrinks every year and catches more.
      const atLawYear = calculateRetirementTax({ ...args, taxYear: 2025 });
      const twentyYearsOn = calculateRetirementTax({ ...args, taxYear: 2045 });
      expect(twentyYearsOn.federalTax).toBeGreaterThan(atLawYear.federalTax);
    });

    it('taxes Social Security more heavily as its 1984 thresholds erode', () => {
      const args = {
        traditionalWithdrawals: 30_000,
        socialSecurityBenefit: 40_000,
        qualifiedIncome: 0,
        household: householdOf('Single', 70),
        state: 'TX' as const,
      };
      const atLawYear = calculateRetirementTax({ ...args, taxYear: 2025 });
      const twentyYearsOn = calculateRetirementTax({ ...args, taxYear: 2045 });
      expect(twentyYearsOn.totalTax).toBeGreaterThan(atLawYear.totalTax);
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
      const withoutBenefits = calculateRetirementTax({ traditionalWithdrawals: 20_000, socialSecurityBenefit: 0, qualifiedIncome: 0, household: householdOf('Single', 67), state: 'CA', taxYear: 2026 });
      const withBenefits = calculateRetirementTax({ traditionalWithdrawals: 20_000, socialSecurityBenefit: 50_000, qualifiedIncome: 0, household: householdOf('Single', 67), state: 'CA', taxYear: 2026 });
      expect(withBenefits.stateTax).toBeCloseTo(withoutBenefits.stateTax, 8);
    });

    it('applies unused standard deduction to capital gains', () => {
      const result = calculateRetirementTax({ traditionalWithdrawals: 0, socialSecurityBenefit: 0, qualifiedIncome: 10_000, household: householdOf('Single', 67), state: 'TX', taxYear: 2026 });
      expect(result.federalTax).toBe(0);
    });
    it('should not tax SS when combined income is below threshold', () => {
      // Low income scenario - no SS should be taxable
      const taxResult = calculateRetirementTax({ traditionalWithdrawals: 10000, socialSecurityBenefit: 20000, qualifiedIncome: 0, household: householdOf('Single', 67), state: 'CA', taxYear: 2026 });
      
      // Combined income = 10k + 0 + (20k * 0.5) = 20k < 25k threshold
      // So no SS should be taxable, only the 10k Traditional withdrawal
      expect(taxResult.totalTax).toBeLessThan(5000); // Should be low due to standard deduction
    });
    
    it('should tax 50% of SS when in middle tier', () => {
      // Middle income scenario - up to 50% SS taxable
      const taxResult = calculateRetirementTax({ traditionalWithdrawals: 20000, socialSecurityBenefit: 20000, qualifiedIncome: 0, household: householdOf('Single', 67), state: 'CA', taxYear: 2026 });
      
      // Combined income = 20k + 0 + (20k * 0.5) = 30k (between 25k and 34k)
      // Some SS should be taxable but not all
      expect(taxResult.totalTax).toBeGreaterThan(0);
      expect(taxResult.totalTax).toBeLessThan(8000);
    });
    
    it('should tax up to 85% of SS when income is high', () => {
      // High income scenario - up to 85% SS taxable
      const taxResult = calculateRetirementTax({ traditionalWithdrawals: 60000, socialSecurityBenefit: 30000, qualifiedIncome: 10000, household: householdOf('Single', 67), state: 'CA', taxYear: 2026 });
      
      // Combined income = 60k + 10k + (30k * 0.5) = 85k > 34k threshold
      // Up to 85% of SS should be taxable
      expect(taxResult.totalTax).toBeCloseTo(12797.17, 2);
    });
    
    it('should handle married filing jointly thresholds correctly', () => {
      // Married filing jointly has different thresholds ($32k/$44k vs $25k/$34k)
      const singleTax = calculateRetirementTax({ traditionalWithdrawals: 25000, socialSecurityBenefit: 20000, qualifiedIncome: 0, household: householdOf('Single', 67), state: 'CA', taxYear: 2026 });
      const marriedTax = calculateRetirementTax({ traditionalWithdrawals: 25000, socialSecurityBenefit: 20000, qualifiedIncome: 0, household: householdOf('MarriedFilingJointly', 67), state: 'CA', taxYear: 2026 });
      
      // Same income should result in less tax for married filers due to higher thresholds
      expect(marriedTax.totalTax).toBeLessThanOrEqual(singleTax.totalTax);
    });
  });

  describe('Real-World Scenario Validation', () => {
    it('should calculate correct taxes for screenshot scenario', () => {
      // From user screenshot: Age 57, $25.2K Traditional, $58.3K Taxable (50% LTCG)
      const taxResult = calculateRetirementTax({ traditionalWithdrawals: 25200, socialSecurityBenefit: 0, qualifiedIncome: 29150, household: householdOf('Single', 57), state: 'CA', taxYear: 2026 });
      
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
      const highTraditionalTax = calculateRetirementTax({ traditionalWithdrawals: 70000, socialSecurityBenefit: 0, qualifiedIncome: 15000, household: householdOf('Single', 67), state: 'CA', taxYear: 2026 });
      
      // Should be much higher tax rate
      expect(highTraditionalTax.totalTax).toBeCloseTo(11206.48, 2);
      expect(highTraditionalTax.effectiveRate).toBeGreaterThan(0.13);
    });
  });
});
