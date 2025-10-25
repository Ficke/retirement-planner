import type { RetirementPlan } from '@/domain/types';
import { runMonteCarloSimulation, type MCConfig } from './mc';
import { categorizeRisk, RISK_THRESHOLDS } from '@/lib/risk-categories';

export interface SpendingAnalysis {
  annualSpending: number;
  successProbability: number;
  riskOfRuin: number;
  marginalImpact: number; // Risk increase from previous spending level
  riskCategory: 'Conservative' | 'Moderate' | 'Aggressive' | 'High Risk';
  recommendation: string;
  medianTerminalWealth: number;
  yearsOfRetirement: number;
}

export interface SpendingOptimization {
  analyses: SpendingAnalysis[];
  currentSpendingAnalysis: SpendingAnalysis | null;
  recommendations: {
    conservative: SpendingAnalysis;
    moderate: SpendingAnalysis;
    aggressive: SpendingAnalysis;
  };
  insights: {
    maxSafeSpending: number;
    currentVsOptimal: string;
    diminishingReturnsPoint: number | null;
  };
}

/**
 * Analyze spending levels based on risk of ruin and financial planning best practices.
 * Similar to retirement age analysis but for spending capacity.
 */
export async function analyzeSpendingLevels(
  basePlan: RetirementPlan,
  config: MCConfig,
  spendingRange?: { min: number; max: number; steps: number }
): Promise<SpendingOptimization> {
  const current = basePlan.profile.desiredSpending;
  const range = spendingRange || {
    min: Math.max(50000, Math.round(current * 0.5)),
    max: Math.round(current * 1.5),
    steps: 11
  };

  const step = (range.max - range.min) / (range.steps - 1);
  const spendingLevels = Array.from({ length: range.steps }, (_, i) =>
    Math.round(range.min + i * step)
  );

  const analyses: SpendingAnalysis[] = [];

  // Run Monte Carlo for each spending level
  for (let i = 0; i < spendingLevels.length; i++) {
    const spending = spendingLevels[i];
    const planVariant = {
      ...basePlan,
      profile: {
        ...basePlan.profile,
        desiredSpending: spending
      }
    };

    const result = await runMonteCarloSimulation(planVariant, config);
    const riskOfRuin = result.riskOfRuin;
    const yearsOfRetirement = basePlan.profile.lifeExpectancy - basePlan.profile.retirementAge;

    analyses.push({
      annualSpending: spending,
      successProbability: result.successProbability,
      riskOfRuin,
      marginalImpact: 0, // Will calculate after all analyses
      riskCategory: categorizeRisk(riskOfRuin).category,
      recommendation: generateSpendingRecommendation(riskOfRuin, spending, current),
      medianTerminalWealth: result.medianTerminalWealth,
      yearsOfRetirement
    });
  }

  // Calculate marginal impacts (risk increase from previous spending level)
  for (let i = 1; i < analyses.length; i++) {
    analyses[i].marginalImpact = analyses[i].riskOfRuin - analyses[i-1].riskOfRuin;
  }

  // Find current spending analysis
  const currentSpendingAnalysis = analyses.find(a => a.annualSpending === current) || null;

  // Find best options for each risk tolerance
  const recommendations = {
    conservative: findMaxSpendingForRiskLevel(analyses, RISK_THRESHOLDS.CONSERVATIVE) || analyses[0],
    moderate: findMaxSpendingForRiskLevel(analyses, RISK_THRESHOLDS.MODERATE) || analyses[0],
    aggressive: findMaxSpendingForRiskLevel(analyses, RISK_THRESHOLDS.AGGRESSIVE) || analyses[0]
  };

  // Generate insights
  const maxSafeSpending = recommendations.moderate.annualSpending;
  const currentVsOptimal = generateCurrentVsOptimalInsight(current, maxSafeSpending);
  const diminishingReturnsPoint = findDiminishingReturnsPoint(analyses);

  return {
    analyses,
    currentSpendingAnalysis,
    recommendations,
    insights: {
      maxSafeSpending,
      currentVsOptimal,
      diminishingReturnsPoint
    }
  };
}


/**
 * Generate recommendation text based on risk level and spending vs current.
 */
function generateSpendingRecommendation(riskOfRuin: number, spending: number, current: number): string {
  const riskPercent = (riskOfRuin * 100).toFixed(1);
  const difference = spending - current;

  if (riskOfRuin <= RISK_THRESHOLDS.CONSERVATIVE) {
    if (difference > 0) {
      return `Very safe to spend $${spending.toLocaleString()} (${riskPercent}% risk) - ${formatCurrency(difference)} more than current`;
    } else {
      return `Very conservative spending level (${riskPercent}% risk)`;
    }
  } else if (riskOfRuin <= RISK_THRESHOLDS.MODERATE) {
    if (difference > 0) {
      return `Safe spending level (${riskPercent}% risk) - standard planning threshold`;
    } else {
      return `Good safety margin (${riskPercent}% risk)`;
    }
  } else if (riskOfRuin <= RISK_THRESHOLDS.AGGRESSIVE) {
    return `Higher risk spending (${riskPercent}% risk) - consider backup plans or flexibility`;
  } else {
    return `High risk spending (${riskPercent}% risk) - likely to deplete assets`;
  }
}

/**
 * Find the maximum spending level that stays within the specified risk threshold.
 */
function findMaxSpendingForRiskLevel(analyses: SpendingAnalysis[], maxRisk: number): SpendingAnalysis | null {
  // Find all spending levels within risk tolerance
  const acceptableSpending = analyses.filter(a => a.riskOfRuin <= maxRisk);

  // Return the highest spending level within tolerance
  return acceptableSpending.length > 0
    ? acceptableSpending[acceptableSpending.length - 1]
    : null;
}

/**
 * Generate insight comparing current spending to optimal.
 */
function generateCurrentVsOptimalInsight(current: number, maxSafe: number): string {
  const difference = maxSafe - current;

  if (difference > 5000) {
    return `You could safely spend ${formatCurrency(difference)} more annually`;
  } else if (difference < -5000) {
    return `Consider reducing spending by ${formatCurrency(Math.abs(difference))} for better outcomes`;
  } else {
    return 'Your current spending level is well-positioned';
  }
}

/**
 * Find the point where spending increases start having diminishing returns on lifestyle
 * vs dramatically increasing risk.
 */
function findDiminishingReturnsPoint(analyses: SpendingAnalysis[]): number | null {
  if (analyses.length < 3) return null;

  // Look for the spending level where risk starts accelerating rapidly
  let maxAcceleration = 0;
  let diminishingPoint = null;

  for (let i = 2; i < analyses.length; i++) {
    const currentImpact = analyses[i].marginalImpact;
    const previousImpact = analyses[i-1].marginalImpact;
    const acceleration = currentImpact - previousImpact;

    if (acceleration > maxAcceleration && currentImpact > 0.02) { // 2% risk increase threshold
      maxAcceleration = acceleration;
      diminishingPoint = analyses[i].annualSpending;
    }
  }

  return diminishingPoint;
}

/**
 * Format currency for display.
 */
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.abs(amount));
}

/**
 * Generate summary insights for spending optimization.
 */
export function generateSpendingInsights(optimization: SpendingOptimization): string[] {
  const insights: string[] = [];

  // Current vs optimal insight
  insights.push(`💰 **${optimization.insights.currentVsOptimal}**`);

  // Risk category insights
  const conservative = optimization.recommendations.conservative;
  const moderate = optimization.recommendations.moderate;
  const aggressive = optimization.recommendations.aggressive;

  insights.push(`🛡️ **Conservative**: ${formatCurrency(conservative.annualSpending)} annually (${(conservative.riskOfRuin * 100).toFixed(1)}% risk)`);
  insights.push(`⚖️ **Moderate**: ${formatCurrency(moderate.annualSpending)} annually (${(moderate.riskOfRuin * 100).toFixed(1)}% risk)`);
  insights.push(`🚀 **Aggressive**: ${formatCurrency(aggressive.annualSpending)} annually (${(aggressive.riskOfRuin * 100).toFixed(1)}% risk)`);

  // Diminishing returns insight
  if (optimization.insights.diminishingReturnsPoint) {
    insights.push(`📊 **Diminishing Returns**: Risk accelerates significantly beyond ${formatCurrency(optimization.insights.diminishingReturnsPoint)} annually`);
  }

  // Range insight
  const rangeSpread = aggressive.annualSpending - conservative.annualSpending;
  if (rangeSpread > 0) {
    insights.push(`📈 **Spending Flexibility**: ${formatCurrency(rangeSpread)} range between conservative and aggressive approaches`);
  }

  return insights;
}