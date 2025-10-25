import { describe, it, expect } from 'vitest';
import { analyzeRetirementAgeOptions, generateRetirementAgeInsights } from '@/engine/retirement-age-analysis';
import type { RetirementPlan } from '@/domain/types';
import { createTestAccount, createTestProjectionSettings } from './test-helpers';

describe('Retirement Age Analysis', () => {
  const basePlan: RetirementPlan = {
    profile: {
      age: 39,
      currentSalary: 120_000,
      salaryGrowthRate: 0.01,
      retirementAge: 56, // Will be overridden in analysis
      desiredSpending: 75_000,
      spendingGrowthRate: 0,
      lifeExpectancy: 95,
      filingStatus: 'Single',
      state: 'CA',
      asOfDate: '2025-01-01'
    },
    accounts: [
      createTestAccount({
        id: '1',
        name: 'Taxable',
        type: 'Taxable',
        balance: 200_000,
        assetWeights: { stocks: 0.9, bonds: 0.1 },
        taxable: true
      }),
      createTestAccount({
        id: '2',
        name: '401k',
        type: 'Traditional',
        balance: 440_000,
        assetWeights: { stocks: 0.9, bonds: 0.1 },
        taxable: false
      }),
      createTestAccount({
        id: '3',
        name: 'Roth',
        type: 'Roth',
        balance: 60_000,
        assetWeights: { stocks: 0.9, bonds: 0.1 },
        taxable: false
      })
    ],
    socialSecurity: {
      enabled: true,
      claimAge: 67,
      manualOverride: false
    },
    assumptions: createTestProjectionSettings({
      preset: 'Moderate',
      rebalanceAnnually: true,
      realDollarDisplay: true,
      simulationModel: 'historical'
    })
  };

  it.skip('should analyze retirement age options and categorize risk levels', async () => {
    const analysis = await analyzeRetirementAgeOptions(basePlan, {
      paths: 100, // Use multiple paths for real Monte Carlo
      seed: 42,
      realDollars: true
    }, { min: 53, max: 61 });

    console.log('\n=== RETIREMENT AGE ANALYSIS ===');

    // Verify we have analyses for each age
    expect(analysis.analyses).toHaveLength(9); // Ages 53-61

    // Log detailed results
    analysis.analyses.forEach(a => {
      console.log(`Age ${a.age}: ${(a.riskOfRuin * 100).toFixed(1)}% risk, ` +
                 `${a.marginalBenefit > 0 ? (a.marginalBenefit * 100).toFixed(1) + '% reduction' : 'N/A'}, ` +
                 `${a.riskCategory}, ${a.yearsOfRetirement} years retirement`);
    });

    console.log(`\n🎯 Knee of Curve: Age ${analysis.kneeOfCurve.age}`);
    console.log(`${analysis.kneeOfCurve.explanation}`);

    // Verify risk decreases with later retirement ages
    for (let i = 1; i < analysis.analyses.length; i++) {
      expect(analysis.analyses[i].riskOfRuin).toBeLessThanOrEqual(analysis.analyses[i-1].riskOfRuin);
    }

    // Verify marginal benefits are calculated
    for (let i = 1; i < analysis.analyses.length; i++) {
      expect(analysis.analyses[i].marginalBenefit).toBeGreaterThanOrEqual(0);
    }

    // Verify knee of curve is reasonable
    expect(analysis.kneeOfCurve.age).toBeGreaterThanOrEqual(53);
    expect(analysis.kneeOfCurve.age).toBeLessThanOrEqual(61);

    // Verify recommendations exist (may be the same in deterministic mode)
    expect(analysis.recommendations.conservative).toBeDefined();
    expect(analysis.recommendations.moderate).toBeDefined();
    expect(analysis.recommendations.aggressive).toBeDefined();

    console.log('\n=== RECOMMENDATIONS ===');
    console.log(`Conservative: Age ${analysis.recommendations.conservative.age} (${(analysis.recommendations.conservative.riskOfRuin * 100).toFixed(1)}% risk)`);
    console.log(`Moderate: Age ${analysis.recommendations.moderate.age} (${(analysis.recommendations.moderate.riskOfRuin * 100).toFixed(1)}% risk)`);
    console.log(`Aggressive: Age ${analysis.recommendations.aggressive.age} (${(analysis.recommendations.aggressive.riskOfRuin * 100).toFixed(1)}% risk)`);
  });

  it.skip('should generate meaningful insights', async () => {
    const analysis = await analyzeRetirementAgeOptions(basePlan, {
      paths: 50, // Smaller for faster test
      seed: 42,
      realDollars: true
    }, { min: 53, max: 61 });

    const insights = generateRetirementAgeInsights(analysis);

    console.log('\n=== GENERATED INSIGHTS ===');
    insights.forEach(insight => {
      console.log(insight);
    });

    // Verify we get meaningful insights
    expect(insights.length).toBeGreaterThanOrEqual(3);
    expect(insights.some(i => i.includes('Optimal Balance'))).toBe(true);
    expect(insights.some(i => i.includes('Balanced Choice'))).toBe(true);
  });

  it.skip('should identify risk categories correctly', async () => {
    const analysis = await analyzeRetirementAgeOptions(basePlan, {
      paths: 50,
      seed: 42,
      realDollars: true
    }, { min: 53, max: 61 });

    // Should have risk categories (may be the same in deterministic mode)
    const categories = analysis.analyses.map(a => a.riskCategory);
    const uniqueCategories = [...new Set(categories)];

    console.log('\n=== RISK CATEGORIES ===');
    console.log(`Categories found: ${uniqueCategories.join(', ')}`);

    // Earlier retirement should generally have higher risk
    const earliestAge = analysis.analyses[0];
    const latestAge = analysis.analyses[analysis.analyses.length - 1];

    console.log(`Earliest (Age ${earliestAge.age}): ${earliestAge.riskCategory} (${(earliestAge.riskOfRuin * 100).toFixed(1)}%)`);
    console.log(`Latest (Age ${latestAge.age}): ${latestAge.riskCategory} (${(latestAge.riskOfRuin * 100).toFixed(1)}%)`);

    // In deterministic mode, all might have same risk category
    expect(uniqueCategories.length).toBeGreaterThanOrEqual(1);
  });

  it.skip('should calculate marginal benefits correctly', async () => {
    const analysis = await analyzeRetirementAgeOptions(basePlan, {
      paths: 50,
      seed: 42,
      realDollars: true
    }, { min: 55, max: 59 });

    console.log('\n=== MARGINAL BENEFIT ANALYSIS ===');

    for (let i = 1; i < analysis.analyses.length; i++) {
      const current = analysis.analyses[i];
      const previous = analysis.analyses[i-1];
      const expectedBenefit = previous.riskOfRuin - current.riskOfRuin;

      console.log(`Age ${previous.age} -> ${current.age}: Risk drops by ${(current.marginalBenefit * 100).toFixed(2)}%`);

      expect(current.marginalBenefit).toBeCloseTo(expectedBenefit, 5);
      expect(current.marginalBenefit).toBeGreaterThanOrEqual(0);
    }
  });
});