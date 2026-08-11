import { accountSchema, isoDateSchema, retirementPlanSchema } from '@/domain/schemas';
import { createTestAccount, createTestProjectionSettings } from './test-helpers';
import { AccountIdSchema, CreateAccountSchema, UpdateAccountSchema } from '@/lib/validation';

describe('Domain Schemas', () => {
  it('rejects impossible calendar dates and numerically unsafe balances', () => {
    expect(isoDateSchema.safeParse('2026-02-29').success).toBe(false);
    expect(accountSchema.safeParse(createTestAccount({
      type: 'Taxable',
      balance: 1_000_000_000_000_001,
    })).success).toBe(false);
  });

  it('normalizes the redundant taxable flag from account type', () => {
    const parsed = accountSchema.parse(createTestAccount({
      type: 'Roth',
      balance: 10_000,
      taxable: true,
    }));
    expect(parsed.taxable).toBe(false);
  });

  it('enforces account API invariants and rejects ignored fields', () => {
    expect(CreateAccountSchema.safeParse({
      name: 'Brokerage',
      institution: '',
      type: 'Taxable',
      balance: 10_000,
      stocksPct: 0.6,
      bondsPct: 0.4,
      ignored: true,
    }).success).toBe(false);
    expect(UpdateAccountSchema.safeParse({
      assetWeights: { stocks: 0.8, bonds: 0.3 },
    }).success).toBe(false);
    expect(UpdateAccountSchema.safeParse({ stocksPct: 0.8 }).success).toBe(false);
    expect(AccountIdSchema.safeParse('not-a-uuid').success).toBe(false);
    expect(AccountIdSchema.safeParse('550e8400-e29b-41d4-a716-446655440000').success).toBe(true);
  });

  it('should accept valid default retirement plan', () => {
    const defaultPlan = {
      profile: {
        age: 35,
        state: 'CA',
        filingStatus: 'Single',
        retirementAge: 65,
        currentSalary: 100000,
        salaryGrowthRate: 0.03,
        currentSpending: 80000,
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

  it('accepts a plan with no investment accounts', () => {
    const plan = {
      profile: {
        age: 67,
        birthYear: 1958,
        state: 'TX',
        filingStatus: 'Single',
        retirementAge: 65,
        currentSalary: 0,
        salaryGrowthRate: 0,
        currentSpending: 40_000,
        desiredSpending: 40_000,
        spendingGrowthRate: 0,
        lifeExpectancy: 90,
        asOfDate: '2025-01-01',
      },
      accounts: [],
      socialSecurity: { enabled: true, claimAge: 67, manualOverride: true, estimatedBenefit: 30_000 },
      assumptions: createTestProjectionSettings(),
    };
    expect(retirementPlanSchema.safeParse(plan).success).toBe(true);
  });

  it('allows retiring in the current modeled year', () => {
    const plan = {
      profile: {
        age: 67,
        birthYear: 1958,
        state: 'TX',
        filingStatus: 'Single',
        retirementAge: 67,
        currentSalary: 0,
        salaryGrowthRate: 0,
        currentSpending: 50_000,
        desiredSpending: 50_000,
        spendingGrowthRate: 0,
        lifeExpectancy: 90,
        asOfDate: '2025-06-30',
      },
      accounts: [createTestAccount({ type: 'Traditional', balance: 500_000 })],
      socialSecurity: { enabled: true, claimAge: 67, manualOverride: true, estimatedBenefit: 30_000 },
      assumptions: createTestProjectionSettings(),
    };
    expect(retirementPlanSchema.safeParse(plan).success).toBe(true);
  });

  it('allows an already-retired plan and requires a future life expectancy', () => {
    const plan = {
      profile: {
        age: 73,
        birthYear: 1952,
        state: 'TX',
        filingStatus: 'Single',
        retirementAge: 65,
        currentSalary: 0,
        salaryGrowthRate: 0,
        currentSpending: 50_000,
        desiredSpending: 50_000,
        spendingGrowthRate: 0,
        lifeExpectancy: 90,
        asOfDate: '2025-06-30',
      },
      accounts: [createTestAccount({ type: 'Traditional', balance: 500_000 })],
      socialSecurity: { enabled: true, claimAge: 67, manualOverride: true, estimatedBenefit: 30_000 },
      assumptions: createTestProjectionSettings(),
    };
    expect(retirementPlanSchema.safeParse(plan).success).toBe(true);
    expect(retirementPlanSchema.safeParse({
      ...plan,
      profile: { ...plan.profile, lifeExpectancy: 72 },
    }).success).toBe(false);
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
        currentSpending: 80000,
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
