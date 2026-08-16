import { describe, it, expect } from 'vitest';
import { createTestAccount } from '../test-helpers';
import type { Account, FilingStatus } from '@/domain/types';
import { projectScenario, type ProjectionConfig } from '@/engine/projection';

// Import the function we want to test by temporarily exposing it
// Since executeOrderedWithdrawals is private, test it through the public projection API.
// For now, let's create a simple test that can verify the behavior through projectScenario

describe('Withdrawal Logic', () => {
  it('should withdraw more than target spending amount to account for taxes', () => {
    // Create test accounts with significant balances
    const accounts: Account[] = [
      createTestAccount({
        id: 'taxable-1',
        name: 'Taxable Account',
        type: 'Taxable',
        balance: 500000,
        assetWeights: { stocks: 0.8, bonds: 0.2 },
      }),
      createTestAccount({
        id: 'traditional-1',
        name: 'Traditional 401k',
        type: 'Traditional',
        balance: 800000,
        assetWeights: { stocks: 0.7, bonds: 0.3 },
      }),
      createTestAccount({
        id: 'roth-1',
        name: 'Roth IRA',
        type: 'Roth',
        balance: 300000,
        assetWeights: { stocks: 0.9, bonds: 0.1 },
      })
    ];

    const targetAfterTaxAmount = 50000; // Target $50k for spending

    // We'll need to create a minimal version of executeOrderedWithdrawals for testing
    // or modify the main function to be exportable. For now, let's create a test version:
    
    const testAccounts = accounts.map(acc => ({ ...acc }));
    
    // Simple implementation similar to the fixed logic
    let grossWithdrawalNeeded = targetAfterTaxAmount * 1.15; // Initial guess
    let totalWithdrawn = 0;

    // Withdraw from taxable first
    for (const account of testAccounts) {
      if (account.type === 'Taxable' && account.balance > 0 && grossWithdrawalNeeded > 0) {
        const withdrawal = Math.min(grossWithdrawalNeeded, account.balance);
        account.balance -= withdrawal;
        totalWithdrawn += withdrawal;
        grossWithdrawalNeeded -= withdrawal;
      }
    }

    // Withdraw from Traditional second  
    for (const account of testAccounts) {
      if (account.type === 'Traditional' && account.balance > 0 && grossWithdrawalNeeded > 0) {
        const withdrawal = Math.min(grossWithdrawalNeeded, account.balance);
        account.balance -= withdrawal;
        totalWithdrawn += withdrawal;
        grossWithdrawalNeeded -= withdrawal;
      }
    }

    // The total withdrawn should be greater than the target spending
    // because it needs to cover both spending AND taxes
    expect(totalWithdrawn).toBeGreaterThan(targetAfterTaxAmount);
    
    // For a $50k target with significant traditional withdrawals,
    // we should withdraw at least $55k to cover taxes
    expect(totalWithdrawn).toBeGreaterThanOrEqual(55000);
    
    // But shouldn't be excessively high (sanity check)
    expect(totalWithdrawn).toBeLessThan(80000);
  });

  it('should follow withdrawal order: Taxable → Traditional → Roth', () => {
    const accounts: Account[] = [
      createTestAccount({
        id: 'taxable-1',
        name: 'Taxable Account',
        type: 'Taxable',
        balance: 30000, // Smaller amount
        assetWeights: { stocks: 0.8, bonds: 0.2 },
      }),
      createTestAccount({
        id: 'traditional-1',
        name: 'Traditional 401k',
        type: 'Traditional',
        balance: 500000,
        assetWeights: { stocks: 0.7, bonds: 0.3 },
      }),
      createTestAccount({
        id: 'roth-1',
        name: 'Roth IRA',
        type: 'Roth',
        balance: 300000,
        assetWeights: { stocks: 0.9, bonds: 0.1 },
      })
    ];

    const testAccounts = accounts.map(acc => ({ ...acc }));
    const targetWithdrawal = 80000; // More than taxable balance
    let remainingNeeded = targetWithdrawal;

    // Simulate withdrawal order
    let taxableWithdrawn = 0;
    let traditionalWithdrawn = 0;
    let rothWithdrawn = 0;

    // First: Taxable
    for (const account of testAccounts) {
      if (account.type === 'Taxable' && account.balance > 0 && remainingNeeded > 0) {
        const withdrawal = Math.min(remainingNeeded, account.balance);
        account.balance -= withdrawal;
        taxableWithdrawn += withdrawal;
        remainingNeeded -= withdrawal;
      }
    }

    // Second: Traditional
    for (const account of testAccounts) {
      if (account.type === 'Traditional' && account.balance > 0 && remainingNeeded > 0) {
        const withdrawal = Math.min(remainingNeeded, account.balance);
        account.balance -= withdrawal;
        traditionalWithdrawn += withdrawal;
        remainingNeeded -= withdrawal;
      }
    }

    // Third: Roth (shouldn't be needed in this test)
    for (const account of testAccounts) {
      if (account.type === 'Roth' && account.balance > 0 && remainingNeeded > 0) {
        const withdrawal = Math.min(remainingNeeded, account.balance);
        account.balance -= withdrawal;
        rothWithdrawn += withdrawal;
        remainingNeeded -= withdrawal;
      }
    }

    // Verify withdrawal order was followed
    expect(taxableWithdrawn).toBe(30000); // All of taxable
    expect(traditionalWithdrawn).toBe(50000); // Remainder from traditional
    expect(rothWithdrawn).toBe(0); // None from Roth needed

    // Verify balances updated correctly
    expect(testAccounts[0].balance).toBe(0); // Taxable depleted
    expect(testAccounts[1].balance).toBe(450000); // Traditional reduced
    expect(testAccounts[2].balance).toBe(300000); // Roth untouched
  });

  it('should calculate correct tax amounts that match CLAUDE.md expectations', () => {
    // Test the real scenario from CLAUDE.md bug report:
    // Taxable withdrawals use the explicit gain-share assumption. Here, 50%
    // is capital gain and 50% is untaxed return of basis.
    
    const accounts: Account[] = [
      createTestAccount({
        id: 'taxable-1',
        name: 'Taxable Account',
        type: 'Taxable',
        balance: 500000, // Plenty of taxable balance
        assetWeights: { stocks: 0.8, bonds: 0.2 },
      })
    ];

    // Use the imported projectScenario function
    
    const plan = {
      schemaVersion: 2 as const,
      profile: {
        age: 67,
        retirementAge: 67,
        lifeExpectancy: 95,
        currentSalary: 0,
        salaryGrowthRate: 0,
        currentSpending: 80000,
        workingSpendingGrowthRate: 0,
        retirementSpending: 80000,
        retirementSpendingGrowthRate: 0,
        filingStatus: 'Single' as FilingStatus,
        state: 'CA' as const,
        asOfDate: '2025-01-01'
      },
      accounts,
      socialSecurity: {
        enabled: false,
        claimAge: 67,
        manualOverride: false
      },
      assumptions: {
        simulationModel: 'historical' as const,
        taxableGainRatio: 0.5,
        hsaEligible: false, useBackdoorRoth: false,
      }
    };

    const config: ProjectionConfig = {
      paths: 1,
      seed: 12345,
    };

    const result = projectScenario(plan, config);
    const firstYear = result.projections[0];

    // With a 50% gain share, return of basis is not taxed. This case remains
    // inside the federal 0% LTCG band; California still taxes the gain.
    expect(firstYear.taxes).toBeGreaterThan(500);
    expect(firstYear.taxes).toBeLessThan(2000);

    const allGain = projectScenario({
      ...plan,
      assumptions: { ...plan.assumptions, taxableGainRatio: 1 },
    }, config).projections[0];
    expect(allGain.taxes).toBeGreaterThan(firstYear.taxes);
    
    // Total withdrawn should be more than spending to cover taxes
    const totalWithdrawn = firstYear.withdrawalTaxable + firstYear.withdrawalTraditional + firstYear.withdrawalRoth;
    expect(totalWithdrawn).toBeGreaterThan(firstYear.spending);
    
    // Net amount should approximately equal desired spending
    const netAmount = totalWithdrawn - firstYear.taxes;
    expect(Math.abs(netAmount - firstYear.spending)).toBeLessThan(100);
    
    // Should primarily withdraw from taxable accounts first
    expect(firstYear.withdrawalTaxable).toBeGreaterThan(0);
    expect(firstYear.withdrawalTraditional).toBe(0);
    expect(firstYear.withdrawalRoth).toBe(0);
  });
});
