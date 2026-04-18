import { describe, it, expect } from 'vitest';
import { projectScenario } from '@/engine/projection';
import type { RetirementPlan } from '@/domain/types';

describe('HSA Withdrawal Logic Fix', () => {
  // Create a test plan with high spending that should trigger withdrawal priority issues
  const createTestPlan = (): RetirementPlan => ({
    profile: {
      age: 75, // Start well after RMD age
      state: 'CA',
      filingStatus: 'Single',
      retirementAge: 65, // Already retired
      currentSalary: 0, // Retired
      salaryGrowthRate: 0,
      desiredSpending: 120000, // High spending to force withdrawals
      spendingGrowthRate: 0,
      lifeExpectancy: 90,
      asOfDate: '2024-01-01',
    },
    accounts: [
      // Large Traditional account (will have RMDs)
      {
        id: 'traditional-1',
        name: '401(k)',
        institution: 'Test Brokerage',
        type: 'Traditional',
        balance: 1000000,
        assetWeights: { stocks: 0.6, bonds: 0.4 },
        taxable: false,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
      // Moderate Roth account
      {
        id: 'roth-1',
        name: 'Roth IRA',
        institution: 'Test Brokerage',
        type: 'Roth',
        balance: 300000,
        assetWeights: { stocks: 0.6, bonds: 0.4 },
        taxable: false,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
      // Small HSA that should NOT be hit hard early
      {
        id: 'hsa-1',
        name: 'HSA',
        institution: 'Test Brokerage',
        type: 'HSA',
        balance: 50000,
        assetWeights: { stocks: 0.6, bonds: 0.4 },
        taxable: false,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
      // Small taxable account
      {
        id: 'taxable-1',
        name: 'Taxable',
        institution: 'Test Brokerage',
        type: 'Taxable',
        balance: 100000,
        assetWeights: { stocks: 0.6, bonds: 0.4 },
        taxable: true,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    ],
    socialSecurity: {
      enabled: true,
      claimAge: 67,
      manualOverride: false,
    },
    assumptions: {
      preset: 'Conservative', // Use conservative to minimize volatility
      rebalanceAnnually: true,
      simulationModel: 'historical',
      useBackdoorRoth: false,
    },
  });

  it('should not heavily rely on HSA withdrawals when Traditional accounts are available', () => {
    const plan = createTestPlan();
    const result = projectScenario(plan, { paths: 1, seed: 42 });

    // Check the first few years of retirement
    const firstYear = result.projections[0]; // Age 75
    const secondYear = result.projections[1]; // Age 76

    // HSA withdrawals should be 0 or minimal in early years when other accounts have funds
    expect(firstYear.withdrawalHSA).toBeLessThan(10000); // Should be very small or 0
    expect(secondYear.withdrawalHSA).toBeLessThan(10000); // Should be very small or 0

    // Traditional withdrawals should be substantial (at least the RMD amount)
    expect(firstYear.withdrawalTraditional).toBeGreaterThan(30000); // Adjusted expectation
    expect(secondYear.withdrawalTraditional).toBeGreaterThan(30000);
  });

  it('should use proper withdrawal order: Taxable → Traditional (including beyond RMD) → Roth → HSA', () => {
    const plan = createTestPlan();
    const result = projectScenario(plan, { paths: 1, seed: 42 });

    // Look at early retirement years
    const earlyYears = result.projections.slice(0, 5);

    for (const year of earlyYears) {
      // If HSA is being withdrawn from, then Taxable, Traditional, and Roth should be heavily used first
      if (year.withdrawalHSA > 1000) {
        // Taxable should be substantially depleted first (since it starts small)
        expect(year.withdrawalTaxable + year.withdrawalTraditional + year.withdrawalRoth)
          .toBeGreaterThan(year.withdrawalHSA * 3); // Other accounts used much more
      }
    }
  });

  it('should maintain consistent withdrawal patterns without sudden spikes', () => {
    const plan = createTestPlan();
    const result = projectScenario(plan, { paths: 1, seed: 42 });

    const hsaWithdrawals = result.projections.map(year => year.withdrawalHSA);

    // Check for sudden spikes (more than 5x increase year-over-year)
    for (let i = 1; i < Math.min(hsaWithdrawals.length, 10); i++) {
      const currentYear = hsaWithdrawals[i];
      const previousYear = hsaWithdrawals[i - 1];

      if (previousYear > 0) {
        const ratio = currentYear / previousYear;
        expect(ratio).toBeLessThan(5); // No more than 5x increase
      }
    }

    // Total HSA withdrawals in first 10 years should be reasonable
    const totalHSAWithdrawals = hsaWithdrawals.slice(0, 10).reduce((sum: number, w: number) => sum + w, 0);
    expect(totalHSAWithdrawals).toBeLessThan(200000); // Shouldn't exhaust HSA quickly
  });
});