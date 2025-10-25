import type { RetirementPlan } from '@/domain/types';
import { runMonteCarloSimulation, type MCConfig } from './mc';

export interface RetirementAgeAnalysis {
  age: number;
  successProbability: number;
  riskOfRuin: number;
  marginalBenefit: number; // Reduction in risk from previous age
  riskCategory: 'Conservative' | 'Moderate' | 'Aggressive' | 'High Risk';
  recommendation: string;
  yearsOfRetirement: number;
  medianTerminalWealth: number;
}

export interface RetirementAgeOptimization {
  analyses: RetirementAgeAnalysis[];
  kneeOfCurve: {
    age: number;
    explanation: string;
  };
  recommendations: {
    conservative: RetirementAgeAnalysis;
    moderate: RetirementAgeAnalysis;
    aggressive: RetirementAgeAnalysis;
  };
}

/**
 * Analyze retirement age options based on risk of ruin and marginal benefits.
 * Implements best practices for retirement planning risk assessment.
 */
export async function analyzeRetirementAgeOptions(
  basePlan: RetirementPlan,
  config: MCConfig,
  ageRange: { min: number; max: number } = { min: 45, max: 65 }
): Promise<RetirementAgeOptimization> {
  const analyses: RetirementAgeAnalysis[] = [];

  // Run projections for each retirement age
  for (let age = ageRange.min; age <= ageRange.max; age++) {
    const planVariant = {
      ...basePlan,
      profile: {
        ...basePlan.profile,
        retirementAge: age
      }
    };

    const result = await runMonteCarloSimulation(planVariant, config);
    const riskOfRuin = result.riskOfRuin;
    const yearsOfRetirement = basePlan.profile.lifeExpectancy - age;

    analyses.push({
      age,
      successProbability: result.successProbability,
      riskOfRuin,
      marginalBenefit: 0, // Will calculate after all analyses
      riskCategory: categorizeRisk(riskOfRuin),
      recommendation: generateRecommendation(riskOfRuin, yearsOfRetirement),
      yearsOfRetirement,
      medianTerminalWealth: result.medianTerminalWealth
    });
  }

  // Calculate marginal benefits (reduction in risk from previous age)
  for (let i = 1; i < analyses.length; i++) {
    analyses[i].marginalBenefit = analyses[i-1].riskOfRuin - analyses[i].riskOfRuin;
  }

  // Find knee of the curve (point of diminishing returns)
  const kneeOfCurve = findKneeOfCurve(analyses);

  // Find best options for each risk tolerance
  const recommendations = {
    conservative: analyses.find(a => a.riskCategory === 'Conservative') || analyses[analyses.length - 1],
    moderate: analyses.find(a => a.riskCategory === 'Moderate') || analyses.find(a => a.riskOfRuin <= 0.10) || analyses[Math.floor(analyses.length / 2)],
    aggressive: analyses.find(a => a.riskCategory === 'Aggressive') || analyses.find(a => a.riskOfRuin <= 0.20) || analyses[0]
  };

  return {
    analyses,
    kneeOfCurve,
    recommendations
  };
}

/**
 * Categorize risk level based on risk of ruin percentage.
 * Based on financial planning best practices.
 */
function categorizeRisk(riskOfRuin: number): 'Conservative' | 'Moderate' | 'Aggressive' | 'High Risk' {
  if (riskOfRuin <= 0.05) return 'Conservative';      // 0-5%
  if (riskOfRuin <= 0.10) return 'Moderate';          // 5-10%
  if (riskOfRuin <= 0.20) return 'Aggressive';        // 10-20%
  return 'High Risk';                                  // >20%
}

/**
 * Generate recommendation text based on risk level and retirement length.
 */
function generateRecommendation(riskOfRuin: number, yearsOfRetirement: number): string {
  const riskPercent = (riskOfRuin * 100).toFixed(1);

  if (riskOfRuin <= 0.05) {
    return `Excellent safety margin (${riskPercent}% risk). Enjoy ${yearsOfRetirement} years of retirement with high confidence.`;
  } else if (riskOfRuin <= 0.10) {
    return `Good safety margin (${riskPercent}% risk). Standard retirement planning threshold with ${yearsOfRetirement} years of retirement.`;
  } else if (riskOfRuin <= 0.20) {
    return `Moderate risk (${riskPercent}% risk). Consider backup plans or flexible spending for ${yearsOfRetirement} years of retirement.`;
  } else {
    return `High risk (${riskPercent}% risk). Strong likelihood of plan failure over ${yearsOfRetirement} years. Consider working longer.`;
  }
}

/**
 * Find the "knee of the curve" - the point where marginal benefit drops significantly.
 * This represents the optimal balance between additional work years and risk reduction.
 */
function findKneeOfCurve(analyses: RetirementAgeAnalysis[]): { age: number; explanation: string } {
  if (analyses.length < 3) {
    return {
      age: analyses[0]?.age || 65,
      explanation: "Insufficient data points for knee analysis"
    };
  }

  // Find the age where marginal benefit drops most significantly
  let maxDropIndex = 1;
  let maxDrop = 0;

  for (let i = 2; i < analyses.length; i++) {
    const currentBenefit = analyses[i].marginalBenefit;
    const previousBenefit = analyses[i-1].marginalBenefit;
    const drop = previousBenefit - currentBenefit;

    if (drop > maxDrop) {
      maxDrop = drop;
      maxDropIndex = i;
    }
  }

  // Also consider where marginal benefit becomes very small (< 1%)
  const lowBenefitAge = analyses.find(a => a.marginalBenefit < 0.01 && a.marginalBenefit > 0);

  const kneeAge = lowBenefitAge ? Math.min(analyses[maxDropIndex].age, lowBenefitAge.age) : analyses[maxDropIndex].age;
  const kneeAnalysis = analyses.find(a => a.age === kneeAge)!;

  return {
    age: kneeAge,
    explanation: `Diminishing returns beyond age ${kneeAge}. Marginal risk reduction drops to ${(kneeAnalysis.marginalBenefit * 100).toFixed(1)}% per additional year.`
  };
}

/**
 * Generate summary insights for retirement age optimization.
 */
export function generateRetirementAgeInsights(optimization: RetirementAgeOptimization): string[] {
  const insights: string[] = [];

  // Knee of curve insight
  insights.push(`🎯 **Optimal Balance**: ${optimization.kneeOfCurve.explanation}`);

  // Risk category insights
  const conservative = optimization.recommendations.conservative;
  const moderate = optimization.recommendations.moderate;
  const aggressive = optimization.recommendations.aggressive;

  if (conservative && moderate && conservative.age !== moderate.age) {
    insights.push(`🛡️ **Conservative Choice**: Age ${conservative.age} (${(conservative.riskOfRuin * 100).toFixed(1)}% risk, ${conservative.yearsOfRetirement} years retirement)`);
  }

  if (moderate) {
    insights.push(`⚖️ **Balanced Choice**: Age ${moderate.age} (${(moderate.riskOfRuin * 100).toFixed(1)}% risk, ${moderate.yearsOfRetirement} years retirement)`);
  }
  if (aggressive) {
    insights.push(`🚀 **Aggressive Choice**: Age ${aggressive.age} (${(aggressive.riskOfRuin * 100).toFixed(1)}% risk, ${aggressive.yearsOfRetirement} years retirement)`);
  }

  // Years of retirement trade-off
  if (conservative && aggressive) {
    const yearsDiff = conservative.yearsOfRetirement - aggressive.yearsOfRetirement;
    if (yearsDiff > 0) {
      insights.push(`⏳ **Trade-off**: Retiring ${yearsDiff} years earlier increases risk by ${((aggressive.riskOfRuin - conservative.riskOfRuin) * 100).toFixed(1)} percentage points`);
    }
  }

  return insights;
}