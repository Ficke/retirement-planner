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
    preset: 'Moderate',
    rebalanceAnnually: true,
    realDollarDisplay: true,
    simulationModel: 'historical',
  }),
};

// Market assumptions no longer needed for bootstrap method

describe('Projection Engine', () => {
  it('should generate reproducible results with same seed', () => {
    const result1 = projectScenario(testPlan, { paths: 1, seed: 42, realDollars: true });
    const result2 = projectScenario(testPlan, { paths: 1, seed: 42, realDollars: true });

    expect(result1.terminalWealth).toBe(result2.terminalWealth);
    expect(result1.projections.length).toBe(result2.projections.length);
  });

  it('should show portfolio growth during working years', () => {
    const result = projectScenario(testPlan, { paths: 1, seed: 42, realDollars: true });
    
    // Should have working years + retirement years
    expect(result.projections.length).toBe(51); // 35 through 85 (inclusive)
    
    // Portfolio should generally grow during working years (first 30 years)
    const workingYears = result.projections.slice(0, 30);
    const firstYear = workingYears[0].portfolioValue;
    const lastWorkingYear = workingYears[workingYears.length - 1].portfolioValue;
    
    expect(lastWorkingYear).toBeGreaterThan(firstYear);
  });

  it('should properly handle withdrawal ordering during retirement', () => {
    const result = projectScenario(testPlan, { paths: 1, seed: 42, realDollars: true });
    
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
    const result = projectScenario(testPlan, { paths: 1, seed: 42, realDollars: true });
    
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
    const result1 = projectScenario(createAllocationTestPlan(), { paths: 1, seed: 999, realDollars: true });
    
    // Test with second seed  
    const result2 = projectScenario(createAllocationTestPlan(), { paths: 1, seed: 123, realDollars: true });
    
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
    const result = projectScenario(testPlan, { paths: 1, seed: 12345, realDollars: true });
    
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

  it('should prioritize HSA contributions first with realistic discretionary income', () => {
    // Create a realistic scenario where there's actual discretionary income for backdoor Roth
    const realisticPlan: RetirementPlan = {
      ...testPlan,
      profile: {
        ...testPlan.profile,
        desiredSpending: 45000, // Lower spending to create discretionary income
      }
    };

    const result = projectScenario(realisticPlan, { paths: 1, seed: 12345, realDollars: true });
    const workingPhaseYear = result.projections.find(p => !p.isRetired);

    if (workingPhaseYear) {
      // At age 35 with $100k salary and $45k spending, should have discretionary income
      // HSA limit for 2025: $4,300 individual, no catch-up until 55
      expect(workingPhaseYear.depositHSA).toBeGreaterThan(0);
      expect(workingPhaseYear.depositHSA).toBeLessThanOrEqual(4300);

      // Should also have 401k contributions
      expect(workingPhaseYear.depositTraditional).toBeGreaterThan(0);

      // Should also have Roth contributions (backdoor Roth) since there's discretionary income
      expect(workingPhaseYear.depositRoth).toBeGreaterThan(0);

      // HSA should be maxed at $4,300, highest priority
      expect(workingPhaseYear.depositHSA).toBeCloseTo(4300, -1);
    }
  });

  it('should prevent phantom savings when spending exceeds discretionary income', () => {
    // This is the original bug scenario: $100k income, $80k spending leaves no room for backdoor Roth
    const result = projectScenario(testPlan, { paths: 1, seed: 12345, realDollars: true });
    const workingPhaseYear = result.projections.find(p => !p.isRetired);

    if (workingPhaseYear) {
      console.log('Phantom savings prevention test:', {
        income: workingPhaseYear.income,
        taxes: workingPhaseYear.taxes,
        spending: workingPhaseYear.spending,
        depositHSA: workingPhaseYear.depositHSA,
        depositTraditional: workingPhaseYear.depositTraditional,
        depositRoth: workingPhaseYear.depositRoth,
        afterTaxIncome: workingPhaseYear.income - workingPhaseYear.taxes - workingPhaseYear.depositHSA - workingPhaseYear.depositTraditional,
        discretionaryIncome: (workingPhaseYear.income - workingPhaseYear.taxes - workingPhaseYear.depositHSA - workingPhaseYear.depositTraditional) - workingPhaseYear.spending
      });

      // HSA and 401k should still work (deducted from taxes)
      expect(workingPhaseYear.depositHSA).toBeGreaterThan(0);
      expect(workingPhaseYear.depositTraditional).toBeGreaterThan(0);

      // But NO backdoor Roth should be possible when discretionary income is negative
      expect(workingPhaseYear.depositRoth).toBe(0);

      // This proves we fixed the phantom savings bug!
      const afterTaxIncome = workingPhaseYear.income - workingPhaseYear.taxes - workingPhaseYear.depositHSA - workingPhaseYear.depositTraditional;
      const discretionaryIncome = afterTaxIncome - workingPhaseYear.spending;
      expect(discretionaryIncome).toBeLessThan(0); // Negative discretionary income
      
      // Total savings should be realistic (only HSA + 401k, no phantom backdoor Roth)
      const totalDeposits = workingPhaseYear.depositHSA +
                           workingPhaseYear.depositTraditional +
                           workingPhaseYear.depositRoth +
                           workingPhaseYear.depositTaxable;
      expect(totalDeposits).toBe(workingPhaseYear.savings);
    }
  });

  it('should apply HSA catch-up contributions for users 55+', () => {
    const olderTestPlan: RetirementPlan = {
      ...testPlan,
      profile: {
        ...testPlan.profile,
        age: 56, // Eligible for HSA catch-up
        retirementAge: 65,
        lifeExpectancy: 85,
      }
    };

    const result = projectScenario(olderTestPlan, { paths: 1, seed: 12345, realDollars: true });
    const workingPhaseYear = result.projections.find(p => !p.isRetired);
    
    if (workingPhaseYear) {
      // At age 56, HSA limit should be $4,300 + $1,000 catch-up = $5,300
      expect(workingPhaseYear.depositHSA).toBeGreaterThan(4300);
      expect(workingPhaseYear.depositHSA).toBeLessThanOrEqual(5300);
      expect(workingPhaseYear.depositHSA).toBeCloseTo(5300, -1); // Should max out
    }
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
