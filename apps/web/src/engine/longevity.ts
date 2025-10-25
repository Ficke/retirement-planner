/**
 * Longevity modeling using SOA mortality tables and Gompertz distribution.
 * Provides survival probability calculations for retirement planning.
 */

export interface GompertzParameters {
  alpha: number;
  beta: number;
}

export interface SurvivalResult {
  probabilityToAge: number;
  lifeExpectancy: number;
  probabilityOfSuccess: number;
}

/**
 * Calculate survival probability using Gompertz mortality model.
 * Based on SOA mortality tables with gender-specific parameters.
 * 
 * @param currentAge - Current age of the individual
 * @param targetAge - Target age for survival probability
 * @param gender - Gender for mortality parameters ('male' | 'female' | 'unisex')
 * @returns Survival probability and life expectancy
 */
export function calculateSurvivalProbability(
  currentAge: number,
  targetAge: number,
  gender: 'male' | 'female' | 'unisex' = 'unisex'
): SurvivalResult {
  // TODO: Load actual Gompertz parameters from soagompertz.json
  const params = getGompertzParameters(gender);
  
  const survivalProb = Math.exp(-params.alpha / params.beta * 
    (Math.exp(params.beta * targetAge) - Math.exp(params.beta * currentAge)));
  
  const lifeExpectancy = estimateLifeExpectancy(currentAge, params);
  
  return {
    probabilityToAge: survivalProb,
    lifeExpectancy,
    probabilityOfSuccess: survivalProb,
  };
}

/**
 * Get Gompertz parameters for mortality modeling.
 * 
 * @param gender - Gender for parameter selection
 * @returns Gompertz alpha and beta parameters
 */
export function getGompertzParameters(gender: 'male' | 'female' | 'unisex'): GompertzParameters {
  // TODO: Load from mortality data JSON
  const defaultParams = {
    male: { alpha: 0.0003, beta: 0.09 },
    female: { alpha: 0.0002, beta: 0.085 },
    unisex: { alpha: 0.00025, beta: 0.0875 },
  };
  
  return defaultParams[gender];
}

/**
 * Estimate life expectancy from current age using Gompertz model.
 * 
 * @param currentAge - Current age
 * @param params - Gompertz parameters
 * @returns Estimated life expectancy in years
 */
export function estimateLifeExpectancy(
  currentAge: number,
  params: GompertzParameters
): number {
  // Simplified estimation - in practice this involves integration
  // TODO: Implement proper Gompertz life expectancy calculation
  if (currentAge >= 65) {
    return currentAge + (params.alpha < 0.00025 ? 22 : 20); // Female vs male approximation
  }
  return currentAge + (params.alpha < 0.00025 ? 25 : 23);
}

/**
 * Generate survival curve for planning horizon.
 * Used to define "success" probability based on chosen longevity assumptions.
 * 
 * @param currentAge - Starting age
 * @param maxAge - Maximum age to model (planning horizon)
 * @param gender - Gender for mortality parameters
 * @returns Array of survival probabilities by age
 */
export function generateSurvivalCurve(
  currentAge: number,
  maxAge: number,
  gender: 'male' | 'female' | 'unisex' = 'unisex'
): number[] {
  const curve: number[] = [];
  
  for (let age = currentAge; age <= maxAge; age++) {
    const survival = calculateSurvivalProbability(currentAge, age, gender);
    curve.push(survival.probabilityToAge);
  }
  
  return curve;
}