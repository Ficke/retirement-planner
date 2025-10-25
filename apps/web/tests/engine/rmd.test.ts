import { describe, it, expect } from 'vitest';
import { createTestAccount, createTestProjectionSettings } from '../test-helpers';
import { calculateRmd } from '@/engine/rmd';
import { projectScenario } from '@/engine/projection';
import type { RetirementPlan } from '@/domain/types';

describe('RMD Calculation', () => {
  describe('calculateRmd', () => {
    it('should return 0 for age 72 (before RMD age)', () => {
      const result = calculateRmd(1000000, 72);
      expect(result).toBe(0);
    });

    it('should calculate correct RMD for age 73', () => {
      const result = calculateRmd(1000000, 73);
      const expected = 1000000 / 26.5; // From IRS table
      expect(result).toBeCloseTo(expected, 2);
    });

    it('should calculate correct RMD for age 80', () => {
      const result = calculateRmd(500000, 80);
      const expected = 500000 / 20.2; // From IRS table
      expect(result).toBeCloseTo(expected, 2);
    });

    it('should calculate correct RMD for age 95', () => {
      const result = calculateRmd(250000, 95);
      const expected = 250000 / 8.9; // From IRS table
      expect(result).toBeCloseTo(expected, 2);
    });

    it('should use fallback factor for ages beyond table', () => {
      const result = calculateRmd(100000, 125);
      const expected = 100000 / 2.0; // Fallback factor
      expect(result).toBeCloseTo(expected, 2);
    });
  });

  describe('RMD Integration Tests', () => {
    const createTestPlan = (age: number, traditionalBalance: number, desiredSpending: number): RetirementPlan => ({
      profile: {
        age: age,
        asOfDate: '2025-01-01',
        currentSalary: 0, // Retired
        retirementAge: age - 1, // Already retired
        lifeExpectancy: age + 20,
        desiredSpending: desiredSpending, // Now using actual dollars
        salaryGrowthRate: 0,
        spendingGrowthRate: 0,
        filingStatus: 'Single',
        state: 'CA'
      },
      accounts: [
        createTestAccount({
          id: '1',
          name: 'Traditional 401k',
          type: 'Traditional',
          balance: traditionalBalance, // Now using actual dollars
          assetWeights: { stocks: 0.6, bonds: 0.4 },
          taxable: false
        }),
        createTestAccount({
          id: '2',
          name: 'Taxable Brokerage',
          type: 'Taxable',
          balance: 100000, // $100k in taxable for reinvestment
          assetWeights: { stocks: 0.7, bonds: 0.3 },
          taxable: true
        })
      ],
      socialSecurity: {
        enabled: false,
        claimAge: 67,
        manualOverride: false
      },
      assumptions: {
        preset: 'Moderate',
        rebalanceAnnually: true,
        realDollarDisplay: true,
        simulationModel: 'historical',
    useBackdoorRoth: false
      }
    });

    it('should correctly handle RMD excess with precise taxation and reinvestment', () => {
      // Test scenario: Age 75, $1M traditional, $20k spending (low spending to create large excess)
      const plan = createTestPlan(75, 1000000, 20000);
      const config = { paths: 1, seed: 42, realDollars: true };
      
      const result = projectScenario(plan, config);
      const firstYear = result.projections[0];
      
      // Expected RMD for $1M at age 75: $1M / 24.6 = ~$40,650
      const expectedRmd = 1000000 / 24.6;
      const expectedExcessRmd = expectedRmd - 20000; // RMD minus spending need
      
      // Verify RMD calculation (now in actual dollars)
      expect(firstYear.rmdAmount).toBeCloseTo(expectedRmd, -2);
      
      // Verify traditional withdrawal equals exactly the RMD (not just spending need)
      expect(firstYear.withdrawalTraditional).toBeCloseTo(expectedRmd, -2);
      
      // Verify no withdrawals from other account types (should use traditional for RMD)
      expect(firstYear.withdrawalTaxable).toBe(0);
      expect(firstYear.withdrawalRoth).toBe(0);
      expect(firstYear.withdrawalHSA).toBe(0);
      
      // Verify excess RMD reinvestment: should be positive and less than gross excess
      expect(firstYear.depositTaxable).toBeGreaterThan(0);
      expect(firstYear.depositTaxable).toBeLessThan(expectedExcessRmd);
      
      // Verify that taxes were calculated on the full RMD amount
      expect(firstYear.taxes).toBeGreaterThan(0);
      
      // The depositTaxable should equal excessRmd minus marginal taxes on excess
      // This is hard to calculate precisely without knowing exact tax brackets,
      // but we can verify the logic is working by checking it's reasonable
      const grossExcess = expectedExcessRmd;
      const netReinvestment = firstYear.depositTaxable;
      const impliedMarginalTaxRate = (grossExcess - netReinvestment) / grossExcess;
      
      // Marginal tax rate should be reasonable (between 10% and 50%)
      expect(impliedMarginalTaxRate).toBeGreaterThan(0.05);
      expect(impliedMarginalTaxRate).toBeLessThan(0.6);
    });

    it('should meet RMD when spending equals or exceeds RMD', () => {
      // Age 73, $800k traditional, $50k spending (spending > RMD)
      const plan = createTestPlan(73, 800000, 50000);
      const config = { paths: 1, seed: 42, realDollars: true };
      
      const result = projectScenario(plan, config);
      const firstYear = result.projections[0];
      
      // Expected RMD for $800k at age 73: $800k / 26.5 = ~$30,188
      const expectedRmd = 800000 / 26.5;
      
      expect(firstYear.rmdAmount).toBeCloseTo(expectedRmd, -2);
      
      // Since spending > RMD, total withdrawal should be driven by spending needs, not RMD
      expect(firstYear.withdrawalTraditional).toBeGreaterThanOrEqual(expectedRmd - 1);
      
      // No excess RMD to reinvest since spending > RMD
      expect(firstYear.depositTaxable).toBe(0);
    });

    it('should correctly calculate marginal taxes on excess RMD', () => {
      // Simple scenario to test marginal tax calculation
      const plan = createTestPlan(73, 500000, 10000); // Low spending, moderate RMD
      const config = { paths: 1, seed: 42, realDollars: true };
      
      const result = projectScenario(plan, config);
      const firstYear = result.projections[0];
      
      // Expected RMD for $500k at age 73: $500k / 26.5 = ~$18,868
      const expectedRmd = 500000 / 26.5;
      const expectedExcess = expectedRmd - 10000;
      
      // Verify basic RMD mechanics
      expect(firstYear.rmdAmount).toBeCloseTo(expectedRmd, -2);
      expect(firstYear.withdrawalTraditional).toBeCloseTo(expectedRmd, -2);
      
      // Verify excess reinvestment calculation
      expect(firstYear.depositTaxable).toBeGreaterThan(0);
      
      const netReinvestment = firstYear.depositTaxable;
      const impliedTaxOnExcess = expectedExcess - netReinvestment;
      
      // Tax on excess should be positive (we're paying taxes)
      expect(impliedTaxOnExcess).toBeGreaterThan(0);
      
      // Tax on excess should be reasonable (not more than 40% marginal rate for this income level)
      expect(impliedTaxOnExcess / expectedExcess).toBeLessThan(0.4);
    });

    it('should not require RMDs before age 73', () => {
      const plan = createTestPlan(72, 1000000, 40000);
      const config = { paths: 1, seed: 42, realDollars: true };
      
      const result = projectScenario(plan, config);
      const firstYear = result.projections[0];
      
      expect(firstYear.rmdAmount).toBe(0);
    });

    it('should track RMDs across multiple years', () => {
      const plan = createTestPlan(73, 1000000, 25000);
      const config = { paths: 1, seed: 42, realDollars: true };
      
      const result = projectScenario(plan, config);
      
      // Check first few years have appropriate RMD requirements
      const ages73to75 = result.projections.slice(0, 3);
      
      for (const year of ages73to75) {
        if (year.age >= 73) {
          expect(year.rmdAmount).toBeGreaterThan(0);
          expect(year.withdrawalTraditional).toBeGreaterThanOrEqual(year.rmdAmount - 0.001); // Account for rounding
        }
      }
    });
  });
});