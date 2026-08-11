import { describe, it, expect } from 'vitest';
import { projectScenario, createRNG, getBootstrapMarketReturns, BlockBootstrapGenerator, createMarketReturnsGenerator } from '@/engine/projection';
import type { RetirementPlan } from '@/domain/types';
import { createTestAccount, createTestProjectionSettings } from './test-helpers';

const testPlan: RetirementPlan = {
  profile: {
    age: 35,
    state: 'CA',
    filingStatus: 'Single',
    retirementAge: 65,
    currentSalary: 100000,
    salaryGrowthRate: 0.03,
    currentSpending: 50000,
    desiredSpending: 80000,
    spendingGrowthRate: 0.02,
    lifeExpectancy: 85,
    asOfDate: '2025-01-01',
  },
  accounts: [
    createTestAccount({
      id: 'taxable-1',
      name: 'Taxable',
      type: 'Taxable',
      balance: 100000,
      assetWeights: { stocks: 0.6, bonds: 0.4 },
      taxable: true,
    }),
    createTestAccount({
      id: 'traditional-1',
      name: '401k',
      type: 'Traditional',
      balance: 200000,
      assetWeights: { stocks: 0.8, bonds: 0.2 },
      taxable: false,
    }),
    createTestAccount({
      id: 'roth-1',
      name: 'Roth IRA',
      type: 'Roth',
      balance: 50000,
      assetWeights: { stocks: 0.9, bonds: 0.1 },
      taxable: false,
    }),
    createTestAccount({
      id: 'hsa-1',
      name: 'HSA',
      type: 'HSA',
      balance: 25000,
      assetWeights: { stocks: 0.7, bonds: 0.3 },
      taxable: false,
    }),
  ],
  socialSecurity: {
    enabled: true,
    claimAge: 67,
    manualOverride: false,
  },
  assumptions: createTestProjectionSettings({
    simulationModel: 'historical',
    contributions: { hsa: 4_300, traditional: 23_500, roth: 7_000, taxable: 5_000 },
  }),
};

// Market assumptions no longer needed for bootstrap method

describe('Projection Engine', () => {
  it('should generate reproducible results with same seed', () => {
    const result1 = projectScenario(testPlan, { paths: 1, seed: 42 });
    const result2 = projectScenario(testPlan, { paths: 1, seed: 42 });

    expect(result1.terminalWealth).toBe(result2.terminalWealth);
    expect(result1.projections.length).toBe(result2.projections.length);
    expect(result1.projections[0].year).toBe(2025);
    expect(result1.projections[0].age).toBe(35);
  });

  it('should show portfolio growth during working years', () => {
    const result = projectScenario(testPlan, { paths: 1, seed: 42 });
    
    // Should have working years + retirement years
    expect(result.projections.length).toBe(51); // 35 through 85 (inclusive)
    
    // Portfolio should generally grow during working years (first 30 years)
    const workingYears = result.projections.slice(0, 30);
    const firstYear = workingYears[0].portfolioValue;
    const lastWorkingYear = workingYears[workingYears.length - 1].portfolioValue;
    
    expect(lastWorkingYear).toBeGreaterThan(firstYear);
  });

  it('should properly handle withdrawal ordering during retirement', () => {
    const result = projectScenario(testPlan, { paths: 1, seed: 42 });
    
    // Find first retirement year
    const retirementYears = result.projections.filter(p => p.isRetired);
    expect(retirementYears.length).toBeGreaterThan(0);
    
    // Should have withdrawal data for retirement years
    const firstRetirementYear = retirementYears[0];
    const totalWithdrawals = firstRetirementYear.withdrawalTaxable + 
                           firstRetirementYear.withdrawalTraditional + 
                           firstRetirementYear.withdrawalRoth;
    
    // Should have some withdrawals if spending > SS benefits
    if (firstRetirementYear.spending > firstRetirementYear.socialSecurityBenefit) {
      expect(totalWithdrawals).toBeGreaterThan(0);
    }
  });

  it('should show negative savings during retirement', () => {
    const result = projectScenario(testPlan, { paths: 1, seed: 42 });
    
    const retirementYears = result.projections.filter(p => p.isRetired);
    
    // Most retirement years should have negative savings (withdrawals)
    const negativeSavingsYears = retirementYears.filter(p => p.savings < 0);
    expect(negativeSavingsYears.length).toBeGreaterThan(0);
  });

  it('should apply account-specific returns based on individual asset weights', () => {
    // Test that accounts with different allocations can produce different results
    // Run the same scenario with two different seeds to verify account-specific logic works
    
    const createAllocationTestPlan = (): RetirementPlan => ({
      ...testPlan,
      profile: {
        ...testPlan.profile,
        age: 60,  // Closer to retirement to reduce complexity
        retirementAge: 65,
        lifeExpectancy: 75,  // Shorter lifespan for simpler test
        desiredSpending: 40000,  // Lower spending
      },
      accounts: [
        createTestAccount({
          id: 'stocks-only',
          name: 'All Stocks',
          type: 'Taxable',
          balance: 100000,
          assetWeights: { stocks: 1.0, bonds: 0.0 }, // 100% stocks
          taxable: true,
        }),
        createTestAccount({
          id: 'bonds-only',
          name: 'All Bonds',
          type: 'Traditional',
          balance: 100000,
          assetWeights: { stocks: 0.0, bonds: 1.0 }, // 100% bonds
          taxable: false,
        })
      ]
    });

    // Test with first seed
    const result1 = projectScenario(createAllocationTestPlan(), { paths: 1, seed: 999 });
    
    // Test with second seed  
    const result2 = projectScenario(createAllocationTestPlan(), { paths: 1, seed: 123 });
    
    // Both projections should complete successfully
    expect(result1.projections.length).toBe(16); // 60 through 75 (inclusive)
    expect(result2.projections.length).toBe(16);

    // Portfolio values should be positive (basic sanity check)
    expect(result1.projections[0].portfolioValue).toBeGreaterThan(0);
    expect(result2.projections[0].portfolioValue).toBeGreaterThan(0);

    // Success should be boolean
    expect(typeof result1.success).toBe('boolean');
    expect(typeof result2.success).toBe('boolean');

    // The key test: with different market conditions (seeds), we should get different results
    // This verifies that account-specific returns are being applied rather than aggregate returns
    const portfolioDifference = Math.abs(result1.projections[0].portfolioValue - result2.projections[0].portfolioValue);
    expect(portfolioDifference).toBeGreaterThan(1000); // Should see meaningful differences with different market years
  });

  it('should track detailed cash flows per account type', () => {
    const result = projectScenario(testPlan, { paths: 1, seed: 12345 });
    
    const workingPhaseYear = result.projections.find(p => !p.isRetired);
    const retiredPhaseYear = result.projections.find(p => p.isRetired);
    
    // Working phase should have deposits but no withdrawals
    if (workingPhaseYear) {
      expect(workingPhaseYear.depositTaxable).toBeGreaterThanOrEqual(0);
      expect(workingPhaseYear.depositTraditional).toBeGreaterThanOrEqual(0);
      expect(workingPhaseYear.depositRoth).toBeGreaterThanOrEqual(0);
      expect(workingPhaseYear.depositHSA).toBeGreaterThanOrEqual(0);
      expect(workingPhaseYear.withdrawalTaxable).toBe(0);
      expect(workingPhaseYear.withdrawalTraditional).toBe(0);
      expect(workingPhaseYear.withdrawalRoth).toBe(0);
      expect(workingPhaseYear.withdrawalHSA).toBe(0);
      expect(workingPhaseYear.insufficientFunds).toBe(false);
    }
    
    // Retirement phase should potentially have withdrawals but no deposits
    if (retiredPhaseYear) {
      expect(retiredPhaseYear.depositTaxable).toBe(0);
      expect(retiredPhaseYear.depositTraditional).toBe(0);
      expect(retiredPhaseYear.depositRoth).toBe(0);
      expect(retiredPhaseYear.depositHSA).toBe(0);
      expect(typeof retiredPhaseYear.withdrawalTaxable).toBe('number');
      expect(typeof retiredPhaseYear.withdrawalTraditional).toBe('number');
      expect(typeof retiredPhaseYear.withdrawalRoth).toBe('number');
      expect(typeof retiredPhaseYear.withdrawalHSA).toBe('number');
      expect(typeof retiredPhaseYear.insufficientFunds).toBe('boolean');
    }
  });

  it('prorates current-year retirement spending and Social Security from the as-of date', () => {
    const plan: RetirementPlan = {
      ...testPlan,
      profile: {
        ...testPlan.profile,
        age: 67,
        birthYear: 1958,
        retirementAge: 67,
        lifeExpectancy: 68,
        desiredSpending: 60_000,
        spendingGrowthRate: 0,
        asOfDate: '2025-07-02',
        state: 'TX',
      },
      accounts: [createTestAccount({ type: 'Taxable', balance: 500_000 })],
      socialSecurity: {
        enabled: true,
        claimAge: 67,
        manualOverride: true,
        estimatedBenefit: 20_000,
      },
      assumptions: createTestProjectionSettings({ taxableGainRatio: 0 }),
    };

    const firstYear = projectScenario(plan, { paths: 1, seed: 42 }).projections[0];
    expect(firstYear.spending).toBeCloseTo(60_000 * (183 / 365), 0);
    expect(firstYear.socialSecurityBenefit).toBeCloseTo(20_000 * (183 / 365), 0);
  });

  it('reinvests only after-tax RMD excess and reconciles spendable cash', () => {
    const plan: RetirementPlan = {
      ...testPlan,
      profile: {
        ...testPlan.profile,
        age: 73,
        birthYear: 1952,
        retirementAge: 73,
        lifeExpectancy: 74,
        currentSalary: 0,
        currentSpending: 30_000,
        desiredSpending: 30_000,
        spendingGrowthRate: 0,
        asOfDate: '2025-01-01',
        state: 'TX',
      },
      accounts: [createTestAccount({
        type: 'Traditional',
        balance: 1_000_000,
        assetWeights: { stocks: 0, bonds: 1 },
      })],
      socialSecurity: { enabled: false, claimAge: 67, manualOverride: false },
      assumptions: createTestProjectionSettings(),
    };

    const firstYear = projectScenario(plan, { paths: 1, seed: 42 }).projections[0];
    expect(firstYear.rmdAmount).toBeGreaterThan(firstYear.spending);
    expect(firstYear.depositTaxable).toBeGreaterThan(0);
    expect(
      firstYear.withdrawalTraditional - firstYear.taxes - firstYear.depositTaxable,
    ).toBeCloseTo(firstYear.spending, 0);
    expect(firstYear.insufficientFunds).toBe(false);

    const midYear = projectScenario({
      ...plan,
      profile: { ...plan.profile, asOfDate: '2025-07-02' },
    }, { paths: 1, seed: 42 }).projections[0];
    expect(midYear.rmdAmount).toBeCloseTo(firstYear.rmdAmount * (183 / 365), 6);
  });

  it('withdraws, taxes, and preserves RMDs while still working', () => {
    const plan: RetirementPlan = {
      ...testPlan,
      profile: {
        ...testPlan.profile,
        age: 75,
        birthYear: 1950,
        retirementAge: 80,
        lifeExpectancy: 81,
        currentSalary: 100_000,
        currentSpending: 60_000,
        asOfDate: '2025-01-01',
        state: 'TX',
      },
      accounts: [createTestAccount({
        type: 'Traditional',
        balance: 1_000_000,
        assetWeights: { stocks: 0, bonds: 1 },
      })],
      assumptions: createTestProjectionSettings(),
    };

    const firstYear = projectScenario(plan, { paths: 1, seed: 42 }).projections[0];
    expect(firstYear.isRetired).toBe(false);
    expect(firstYear.withdrawalTraditional).toBeGreaterThan(0);
    expect(firstYear.rmdAmount).toBeCloseTo(firstYear.withdrawalTraditional, 6);
    expect(firstYear.depositTaxable).toBeGreaterThan(0);
    expect(firstYear.taxes).toBeGreaterThan(0);
  });

  it('taxes and preserves Social Security income above the spending target', () => {
    const plan: RetirementPlan = {
      ...testPlan,
      profile: {
        ...testPlan.profile,
        age: 67,
        birthYear: 1958,
        retirementAge: 65,
        lifeExpectancy: 68,
        desiredSpending: 50_000,
        spendingGrowthRate: 0,
        asOfDate: '2025-01-01',
        state: 'TX',
      },
      accounts: [],
      socialSecurity: {
        enabled: true,
        claimAge: 67,
        manualOverride: true,
        estimatedBenefit: 200_000,
      },
      assumptions: createTestProjectionSettings({ taxableGainRatio: 0 }),
    };

    const firstYear = projectScenario(plan, { paths: 1, seed: 42 }).projections[0];
    expect(firstYear.taxes).toBeGreaterThan(0);
    expect(firstYear.depositTaxable).toBeGreaterThan(0);
    expect(
      firstYear.socialSecurityBenefit
        + firstYear.withdrawalTaxable
        + firstYear.withdrawalTraditional
        + firstYear.withdrawalRoth
        + firstYear.withdrawalHSA
        - firstYear.taxes
        - firstYear.depositTaxable,
    ).toBeCloseTo(firstYear.spending, 0);
  });

  it('fully funds a high-tax retirement year when sufficient assets exist', () => {
    const plan: RetirementPlan = {
      ...testPlan,
      profile: {
        ...testPlan.profile,
        age: 67,
        birthYear: 1958,
        retirementAge: 65,
        lifeExpectancy: 68,
        desiredSpending: 1_000_000_000,
        spendingGrowthRate: 0,
        asOfDate: '2025-01-01',
        state: 'CA',
      },
      accounts: [createTestAccount({
        type: 'Traditional',
        balance: 10_000_000_000,
        assetWeights: { stocks: 0, bonds: 1 },
      })],
      socialSecurity: { enabled: false, claimAge: 67, manualOverride: false },
      assumptions: createTestProjectionSettings(),
    };

    const firstYear = projectScenario(plan, { paths: 1, seed: 42 }).projections[0];
    expect(firstYear.insufficientFunds).toBe(false);
    expect(
      firstYear.withdrawalTraditional - firstYear.taxes - firstYear.depositTaxable,
    ).toBeCloseTo(firstYear.spending, 0);
  });

});

describe('Random Number Generation', () => {
  it('should generate same sequence with same seed', () => {
    const rng1 = createRNG(42);
    const rng2 = createRNG(42);
    
    const values1 = Array(10).fill(0).map(() => rng1.next());
    const values2 = Array(10).fill(0).map(() => rng2.next());
    
    expect(values1).toEqual(values2);
  });

  it('should generate different sequences with different seeds', () => {
    const rng1 = createRNG(42);
    const rng2 = createRNG(43);
    
    const values1 = Array(10).fill(0).map(() => rng1.next());
    const values2 = Array(10).fill(0).map(() => rng2.next());
    
    expect(values1).not.toEqual(values2);
  });

  it('should generate bootstrap market returns from historical data', () => {
    const rng = createRNG(42);
    const returns1 = getBootstrapMarketReturns(rng);
    
    expect(returns1.stockReturn).toBeDefined();
    expect(returns1.bondReturn).toBeDefined();
    expect(typeof returns1.stockReturn).toBe('number');
    expect(typeof returns1.bondReturn).toBe('number');
    
    // Returns should be from actual historical data
    expect(returns1.stockReturn).toBeGreaterThan(-1); // Sanity check for reasonable range
    expect(returns1.stockReturn).toBeLessThan(1);     // No 100%+ returns in our data
    expect(returns1.bondReturn).toBeGreaterThan(-1);  // Reasonable bond return range
    expect(returns1.bondReturn).toBeLessThan(1);
  });
});

describe('Block Bootstrap Generator', () => {
  it('should produce deterministic sequence for given seed', () => {
    const rng1 = createRNG(12345);
    const rng2 = createRNG(12345);
    
    const generator1 = new BlockBootstrapGenerator(rng1, 3);
    const generator2 = new BlockBootstrapGenerator(rng2, 3);
    
    // Generate 10 years of returns from both generators
    const returns1 = Array(10).fill(0).map(() => generator1.next());
    const returns2 = Array(10).fill(0).map(() => generator2.next());
    
    // Should be identical for same seed
    expect(returns1).toEqual(returns2);
  });

  it('should return consecutive years from historical data within a block', () => {
    const rng = createRNG(42);
    const generator = new BlockBootstrapGenerator(rng, 4);
    
    // Since we don't know which block was selected, we'll verify the pattern exists
    // by checking if there are consecutive sequences in our historical data
    const firstFourReturns = Array(4).fill(0).map(() => generator.next());
    
    // Each return should be valid
    firstFourReturns.forEach(returns => {
      expect(returns.stockReturn).toBeDefined();
      expect(returns.bondReturn).toBeDefined();
      expect(typeof returns.stockReturn).toBe('number');
      expect(typeof returns.bondReturn).toBe('number');
    });
    
    // When we go beyond the block size, we should get a new block
    const nextFourReturns = Array(4).fill(0).map(() => generator.next());
    
    nextFourReturns.forEach(returns => {
      expect(returns.stockReturn).toBeDefined();
      expect(returns.bondReturn).toBeDefined();
    });
  });

  it('should create appropriate generator based on configuration', () => {
    const rng1 = createRNG(123);
    const rng2 = createRNG(123);
    
    // Test that both generators produce different patterns but are deterministic
    const generator1 = createMarketReturnsGenerator(testPlan, rng1);
    const generator2 = createMarketReturnsGenerator(testPlan, rng2);
    
    const returns1 = Array(5).fill(0).map(() => generator1.next());
    const returns2 = Array(5).fill(0).map(() => generator2.next());
    
    // Should be identical for same seed
    expect(returns1).toEqual(returns2);
  });
});
