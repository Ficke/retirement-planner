import { accountSchema, isoDateSchema, retirementPlanSchema } from '@/domain/schemas';
import { createTestAccount, createTestProjectionSettings } from './test-helpers';
import {
  AccountIdSchema,
  CreateAccountSchema,
  SaveProfileSchema,
  UpdateAccountSchema,
} from '@/lib/validation';
import { loadLocalAccounts, saveLocalAccounts } from '@/lib/persistence';

describe('Domain Schemas', () => {
  it('rejects impossible calendar dates and numerically unsafe balances', () => {
    expect(isoDateSchema.safeParse('2026-02-29').success).toBe(false);
    expect(accountSchema.safeParse(createTestAccount({
      type: 'Taxable',
      balance: 1_000_000_000_000_001,
    })).success).toBe(false);
  });

  it('strips retired account persistence and balance-history fields', () => {
    const parsed = accountSchema.parse({
      ...createTestAccount({ type: 'Roth', balance: 10_000 }),
      taxable: true,
      balanceAsOf: '2026-05-16T07:00:00.000Z',
      user_id: 'owner-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(parsed).toEqual(createTestAccount({
      id: parsed.id,
      type: 'Roth',
      balance: 10_000,
    }));
  });

  it('migrates legacy browser accounts into the versioned canonical shape', () => {
    const values = new Map<string, string>();
    const storage: Storage = {
      get length() { return values.size; },
      clear: () => values.clear(),
      getItem: (key) => values.get(key) ?? null,
      key: (index) => [...values.keys()][index] ?? null,
      removeItem: (key) => { values.delete(key); },
      setItem: (key, value) => { values.set(key, value); },
    };
    Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
    const account = createTestAccount({ type: 'Taxable', balance: 25_000 });
    window.localStorage.setItem('retireplan:accounts:anonymous', JSON.stringify([{
      ...account,
      taxable: true,
      balanceAsOf: '2026-05-16T07:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }]));

    const migrated = loadLocalAccounts(null);
    expect(migrated).toEqual([account]);
    saveLocalAccounts(migrated!, null);
    expect(JSON.parse(window.localStorage.getItem('retireplan:accounts:anonymous')!)).toEqual({
      schemaVersion: 4,
      accounts: [account],
    });
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

  it('normalizes a legacy profile save before it is persisted as schema v2', () => {
    const saved = SaveProfileSchema.parse({
      profile: {
        birthDate: '1986-01-01',
        state: 'CA',
        filingStatus: 'Single',
        retirementAge: 65,
        currentSalary: 100_000,
        salaryGrowthRate: 0.02,
        currentSpending: 48_000,
        desiredSpending: 60_000,
        spendingGrowthRate: 0.01,
        lifeExpectancy: 90,
        retirementHealthcare: { preMedicarePremium: 0, medicarePremium: 0, outOfPocket: 0, realGrowthRate: 0 },
        asOfDate: '2026-01-01',
      },
      socialSecurity: { enabled: true, claimAge: 67, manualOverride: false },
      assumptions: createTestProjectionSettings(),
      revision: 0,
    });

    expect(saved.profile).toMatchObject({
      currentSpending: 48_000,
      workingSpendingGrowthRate: 0,
      // $60k target on $48k of working-year spending.
      retirementSpendingMultiplier: 1.25,
      retirementSpendingGrowthRate: 0.01,
    });
    expect(saved.profile).not.toHaveProperty('desiredSpending');
  });

  it('should accept valid default retirement plan', () => {
    const defaultPlan = {
      profile: {
        birthDate: '1990-01-01',
        state: 'CA',
        filingStatus: 'Single',
        retirementAge: 65,
        currentSalary: 100000,
        salaryGrowthRate: 0.03,
        currentSpending: 80000,
        workingSpendingGrowthRate: 0,
        retirementSpendingMultiplier: 1,
        retirementSpendingGrowthRate: 0.02,
        lifeExpectancy: 95,
        retirementHealthcare: { preMedicarePremium: 0, medicarePremium: 0, outOfPocket: 0, realGrowthRate: 0 },
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
        birthDate: '1957-01-01',
        state: 'TX',
        filingStatus: 'Single',
        retirementAge: 65,
        currentSalary: 0,
        salaryGrowthRate: 0,
        currentSpending: 40_000,
        workingSpendingGrowthRate: 0,
        retirementSpendingMultiplier: 1,
        retirementSpendingGrowthRate: 0,
        lifeExpectancy: 90,
        retirementHealthcare: { preMedicarePremium: 0, medicarePremium: 0, outOfPocket: 0, realGrowthRate: 0 },
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
        birthDate: '1957-01-01',
        state: 'TX',
        filingStatus: 'Single',
        retirementAge: 67,
        currentSalary: 0,
        salaryGrowthRate: 0,
        currentSpending: 50_000,
        workingSpendingGrowthRate: 0,
        retirementSpendingMultiplier: 1,
        retirementSpendingGrowthRate: 0,
        lifeExpectancy: 90,
        retirementHealthcare: { preMedicarePremium: 0, medicarePremium: 0, outOfPocket: 0, realGrowthRate: 0 },
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
        birthDate: '1951-01-01',
        state: 'TX',
        filingStatus: 'Single',
        retirementAge: 65,
        currentSalary: 0,
        salaryGrowthRate: 0,
        currentSpending: 50_000,
        workingSpendingGrowthRate: 0,
        retirementSpendingMultiplier: 1,
        retirementSpendingGrowthRate: 0,
        lifeExpectancy: 90,
        retirementHealthcare: { preMedicarePremium: 0, medicarePremium: 0, outOfPocket: 0, realGrowthRate: 0 },
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
        birthDate: '1990-01-01',
        state: 'CA',
        filingStatus: 'Single',
        retirementAge: 65,
        currentSalary: 100000,
        salaryGrowthRate: 0.03,
        currentSpending: 80000,
        workingSpendingGrowthRate: 0,
        retirementSpendingMultiplier: 1,
        retirementSpendingGrowthRate: 0.02,
        lifeExpectancy: 95,
        retirementHealthcare: { preMedicarePremium: 0, medicarePremium: 0, outOfPocket: 0, realGrowthRate: 0 },
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
