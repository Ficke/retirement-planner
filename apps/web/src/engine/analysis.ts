import { runMonteCarloSimulation } from '@/engine/mc';
import type {
  RetirementPlan,
  SSAnalysisResult,
  SpendingAnalysisResult,
  RetirementAgeAnalysisResult
} from '@/domain/types';

/**
 * Run Social Security claiming age analysis.
 * Executes parallel Monte Carlo simulations for claim ages 62-70.
 *
 * @param plan - Base retirement plan
 * @returns Array of results for each claiming age
 */
export async function runSocialSecurityAnalysis(plan: RetirementPlan): Promise<SSAnalysisResult[]> {
  const ages = Array.from({ length: 9 }, (_, i) => 62 + i);

  const simulations = ages.map(async (age) => {
    // Create a deep copy to prevent state mutation
    const cleanPlan = JSON.parse(JSON.stringify(plan));

    const modifiedPlan: RetirementPlan = {
      ...cleanPlan,
      socialSecurity: {
        ...cleanPlan.socialSecurity,
        enabled: true,
        claimAge: age,
      },
    };

    const result = await runMonteCarloSimulation(modifiedPlan, {
      paths: 1000, // Optimized for interactive analysis
      seed: 42 + age * 1000, // Offset seed by retirement age to ensure different random sequences
      realDollars: cleanPlan.assumptions.realDollarDisplay,
    });
    return { claimAge: age, result };
  });

  return Promise.all(simulations);
}

/**
 * Run annual spending analysis.
 * Tests a range of spending levels to find the optimal balance.
 *
 * @param plan - Base retirement plan
 * @param spendingRange - Optional custom spending range, defaults to ±50% of current
 * @returns Array of results for each spending level
 */
export async function runSpendingAnalysis(
  plan: RetirementPlan,
  spendingRange?: { min: number; max: number; steps: number }
): Promise<SpendingAnalysisResult[]> {
  const current = plan.profile.desiredSpending;
  const range = spendingRange || {
    min: Math.max(50000, Math.round(current * 0.5)),
    max: Math.round(current * 1.5),
    steps: 11
  };

  const step = (range.max - range.min) / (range.steps - 1);
  const spendingLevels = Array.from({ length: range.steps }, (_, i) =>
    Math.round(range.min + i * step)
  );

  const simulations = spendingLevels.map(async (spending) => {
    // Create a deep copy to prevent state mutation
    const cleanPlan = JSON.parse(JSON.stringify(plan));

    const modifiedPlan: RetirementPlan = {
      ...cleanPlan,
      profile: {
        ...cleanPlan.profile,
        desiredSpending: spending,
      },
    };

    const result = await runMonteCarloSimulation(modifiedPlan, {
      paths: 1000, // Optimized for interactive analysis
      seed: 42, // Same seed across all scenarios for pure sensitivity analysis
      realDollars: cleanPlan.assumptions.realDollarDisplay,
    });
    return { annualSpending: spending, result };
  });

  return Promise.all(simulations);
}

/**
 * Run retirement age analysis with parallel fan-out optimization.
 * Starts from middle of viable range and fans out in both directions.
 *
 * @param plan - Base retirement plan
 * @param ageRange - Optional custom age range, defaults to reasonable bounds
 * @returns Array of results for each retirement age
 */
export async function runRetirementAgeAnalysis(
  plan: RetirementPlan,
  ageRange?: { min: number; max: number; step: number }
): Promise<RetirementAgeAnalysisResult[]> {
  // Calculate reasonable age bounds
  const minAge = Math.max(plan.profile.age + 1, 45);
  const maxAge = Math.min(75, plan.profile.age + 30);

  const range = ageRange || {
    min: minAge,
    max: maxAge,
    step: 1
  };

  // Start from middle of range - virtually guaranteed to be useful
  const baseline = Math.floor((range.min + range.max) / 2);

  // Test baseline first to establish reference point
  const baselineResult = await testRetirementAge(plan, baseline);
  const results: RetirementAgeAnalysisResult[] = [baselineResult];

  // Launch parallel fan-out in both directions with smarter bounds
  const maxFanOutDistance = 8; // Don't test more than 8 years from baseline
  const smartMinAge = Math.max(range.min, baseline - maxFanOutDistance);

  const [earlierResults, laterResults] = await Promise.all([
    fanOutEarlier(plan, baseline - 1, smartMinAge),
    fanOutLater(plan, baseline + 1, range.max)
  ]);

  // Combine all results and sort by age
  return [...earlierResults, ...results, ...laterResults]
    .sort((a, b) => a.retirementAge - b.retirementAge);
}

/**
 * Test a single retirement age scenario
 */
async function testRetirementAge(
  plan: RetirementPlan,
  age: number
): Promise<RetirementAgeAnalysisResult> {
  // Create a deep copy to prevent state mutation
  const cleanPlan = JSON.parse(JSON.stringify(plan));

  const modifiedPlan: RetirementPlan = {
    ...cleanPlan,
    profile: {
      ...cleanPlan.profile,
      retirementAge: age,
    },
  };

  const result = await runMonteCarloSimulation(modifiedPlan, {
    paths: 1000, // Optimized for interactive analysis
    seed: 42, // Same seed across all scenarios for pure sensitivity analysis
    realDollars: cleanPlan.assumptions.realDollarDisplay,
  });

  return { retirementAge: age, result };
}

/**
 * Fan out to earlier ages with early termination
 */
async function fanOutEarlier(
  plan: RetirementPlan,
  startAge: number,
  minAge: number
): Promise<RetirementAgeAnalysisResult[]> {
  const results: RetirementAgeAnalysisResult[] = [];

  for (let age = startAge; age >= minAge; age--) {
    const result = await testRetirementAge(plan, age);
    results.unshift(result); // Add to beginning to maintain order

    // Stop if clearly unviable (>50% risk of ruin)
    if (result.result.riskOfRuin > 0.5) {
      break;
    }
  }

  return results;
}

/**
 * Fan out to later ages with early termination
 */
async function fanOutLater(
  plan: RetirementPlan,
  startAge: number,
  maxAge: number
): Promise<RetirementAgeAnalysisResult[]> {
  const results: RetirementAgeAnalysisResult[] = [];

  for (let age = startAge; age <= maxAge; age++) {
    const result = await testRetirementAge(plan, age);
    results.push(result);

    // Stop if very safe (low risk + high p10 wealth)
    if (result.result.riskOfRuin < 0.05 && result.result.percentile10TerminalWealth > 1000000) {
      break;
    }
  }

  return results;
}
