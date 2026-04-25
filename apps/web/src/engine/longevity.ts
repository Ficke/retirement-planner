/**
 * Longevity modeling using Gompertz mortality.
 * Parameters loaded from apps/web/src/data/mortality/soagompertz.json.
 */

import mortalityData from '@/data/mortality/soagompertz.json';

export interface GompertzParameters {
  alpha: number;
  beta: number;
}

export interface SurvivalResult {
  probabilityToAge: number;
  lifeExpectancy: number;
  probabilityOfSuccess: number;
}

type Gender = 'male' | 'female' | 'unisex';

const GOMPERTZ: Record<Gender, GompertzParameters> = mortalityData.gompertzParameters;
const LIFE_EXP_AT_65: Record<Gender, number> = mortalityData.lifeExpectancyAt65;

export function calculateSurvivalProbability(
  currentAge: number,
  targetAge: number,
  gender: Gender = 'unisex'
): SurvivalResult {
  const params = getGompertzParameters(gender);

  const survivalProb = Math.exp(
    (-params.alpha / params.beta) *
      (Math.exp(params.beta * targetAge) - Math.exp(params.beta * currentAge))
  );

  const lifeExpectancy = estimateLifeExpectancy(currentAge, gender);

  return {
    probabilityToAge: survivalProb,
    lifeExpectancy,
    probabilityOfSuccess: survivalProb,
  };
}

export function getGompertzParameters(gender: Gender): GompertzParameters {
  return GOMPERTZ[gender];
}

/**
 * Life expectancy (age at which cumulative survival ≈ 0.5), anchored on the
 * SOA table values at 65 and extrapolated linearly for other ages. Good enough
 * for planning display; projection uses the full survival curve.
 */
export function estimateLifeExpectancy(currentAge: number, gender: Gender = 'unisex'): number {
  const leAt65 = LIFE_EXP_AT_65[gender];
  // Linear adjustment: each year lived past 65 shifts LE by ~0.5 years for adults.
  const delta = (currentAge - 65) * 0.5;
  return Math.max(currentAge + 1, leAt65 + Math.max(0, delta));
}

export function generateSurvivalCurve(
  currentAge: number,
  maxAge: number,
  gender: Gender = 'unisex'
): number[] {
  const curve: number[] = [];

  for (let age = currentAge; age <= maxAge; age++) {
    const survival = calculateSurvivalProbability(currentAge, age, gender);
    curve.push(survival.probabilityToAge);
  }

  return curve;
}
