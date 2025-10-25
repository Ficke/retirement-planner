/**
 * Shared risk categorization logic for all financial analyses.
 * Ensures consistent risk thresholds across retirement age, spending, and SS analyses.
 * Based on financial planning best practices from literature.
 */

export type RiskCategory = 'Conservative' | 'Moderate' | 'Aggressive' | 'High Risk';

export interface RiskCategoryInfo {
  category: RiskCategory;
  color: string;
  bg: string;
  emoji: string;
  description: string;
}

/**
 * Categorize risk level based on risk of ruin percentage.
 * Uses consistent thresholds across all analyses:
 * - Conservative: 0-5% (Excellent safety margin)
 * - Moderate: 5-10% (Standard planning threshold)
 * - Aggressive: 10-20% (Higher risk, consider backups)
 * - High Risk: >20% (Significant probability of failure)
 */
export function categorizeRisk(riskOfRuin: number): RiskCategoryInfo {
  if (riskOfRuin <= 0.05) {
    return {
      category: 'Conservative',
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
      emoji: '🛡️',
      description: 'Excellent safety margin'
    };
  }

  if (riskOfRuin <= 0.10) {
    return {
      category: 'Moderate',
      color: 'text-blue-600',
      bg: 'bg-blue-50',
      emoji: '⚖️',
      description: 'Standard planning threshold'
    };
  }

  if (riskOfRuin <= 0.20) {
    return {
      category: 'Aggressive',
      color: 'text-amber-600',
      bg: 'bg-amber-50',
      emoji: '🚀',
      description: 'Higher risk, consider backup plans'
    };
  }

  return {
    category: 'High Risk',
    color: 'text-red-600',
    bg: 'bg-red-50',
    emoji: '⚠️',
    description: 'Significant probability of failure'
  };
}

/**
 * Find the maximum value (spending, age, etc.) that stays within specified risk threshold.
 * Used for spending analyses where we want the highest spending within risk tolerance.
 */
export function findMaxValueForRiskLevel<T extends { result: { riskOfRuin: number } }>(
  analyses: T[],
  maxRisk: number
): T | null {
  const acceptable = analyses.filter(a => a.result.riskOfRuin <= maxRisk);
  return acceptable.length > 0 ? acceptable[acceptable.length - 1] : null;
}

/**
 * Find the minimum value (earliest age) that stays within specified risk threshold.
 * Used for retirement age analyses where we want the earliest retirement age within risk tolerance.
 */
export function findMinValueForRiskLevel<T extends { result: { riskOfRuin: number } }>(
  analyses: T[],
  maxRisk: number
): T | null {
  const acceptable = analyses.filter(a => a.result.riskOfRuin <= maxRisk);
  return acceptable.length > 0 ? acceptable[0] : null;
}

/**
 * Risk thresholds for consistent categorization across analyses.
 */
export const RISK_THRESHOLDS = {
  CONSERVATIVE: 0.05,  // 5%
  MODERATE: 0.10,      // 10%
  AGGRESSIVE: 0.20,    // 20%
} as const;