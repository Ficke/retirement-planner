import { retirementPlanSchema } from '@/domain/schemas';
import { createTestAccount, createTestProjectionSettings } from './test-helpers';

describe('Domain Schemas', () => {
  it('should accept valid default retirement plan', () => {
    const defaultPlan = {
      profile: {
        age: 35,
        state: 'CA',
        filingStatus: 'Single',
        retirementAge: 65,
        currentSalary: 100000,
        salaryGrowthRate: 0.03,
        desiredSpending: 80000,
        spendingGrowthRate: 0.02,
        lifeExpectancy: 95,
        asOfDate: '2025-01-01',
      },
      accounts: [
        createTestAccount({
          id: 'taxable-1',
          name: 'Taxable Brokerage',
          type: 'Taxable',
          balance: 100000,
          assetWeights: {
            stocks: 0.7,
            bonds: 0.3,
          },
          taxable: true,
        }),
      ],
      socialSecurity: {
        enabled: true,
        claimAge: 67,
        manualOverride: false,
      },
      assumptions: createTestProjectionSettings({
        simulationModel: 'historical',
      }),
    };

    const result = retirementPlanSchema.safeParse(defaultPlan);
    expect(result.success).toBe(true);
  });

  it('should reject invalid asset weights that do not sum to 1', () => {
    const invalidPlan = {
      profile: {
        age: 35,
        state: 'CA',
        filingStatus: 'Single',
        retirementAge: 65,
        currentSalary: 100000,
        salaryGrowthRate: 0.03,
        desiredSpending: 80000,
        spendingGrowthRate: 0.02,
        lifeExpectancy: 95,
        asOfDate: '2025-01-01',
      },
      accounts: [
        createTestAccount({
          id: 'invalid-1',
          name: 'Invalid Account',
          type: 'Taxable',
          balance: 100000,
          assetWeights: {
            stocks: 0.6,
            bonds: 0.5, // Sum = 1.1, should fail
          },
          taxable: true,
        }),
      ],
      socialSecurity: {
        enabled: true,
        claimAge: 67,
        manualOverride: false,
      },
      assumptions: createTestProjectionSettings({
        simulationModel: 'historical',
      }),
    };

    const result = retirementPlanSchema.safeParse(invalidPlan);
    expect(result.success).toBe(false);
  });
});