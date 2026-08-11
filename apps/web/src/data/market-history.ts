/**
 * Market model statistics and parametric return generation.
 *
 * All statistics are DERIVED from the canonical historical dataset
 * (market-history-annual.ts, 1928–2024) — real (inflation-adjusted) annual
 * returns. There are no hand-maintained market constants; edit the dataset
 * and every consumer (parametric model, Assumptions page) follows.
 */

import type { SeededRNG } from '@/engine/projection';
import { HISTORICAL_RETURNS } from '@/data/market-history-annual';

function mean(xs: number[]): number {
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

function stdDev(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((v) => (v - m) ** 2)));
}

function correlation(xs: number[], ys: number[]): number {
  const mx = mean(xs);
  const my = mean(ys);
  const cov = mean(xs.map((v, i) => (v - mx) * (ys[i] - my)));
  return cov / (stdDev(xs) * stdDev(ys));
}

const realStock = HISTORICAL_RETURNS.map(
  (r) => (1 + r.stock_return) / (1 + r.inflation_rate) - 1,
);
const realBond = HISTORICAL_RETURNS.map(
  (r) => (1 + r.bond_return) / (1 + r.inflation_rate) - 1,
);
const inflation = HISTORICAL_RETURNS.map((r) => r.inflation_rate);

export const DATA_FIRST_YEAR = HISTORICAL_RETURNS[0].year;
export const DATA_LAST_YEAR = HISTORICAL_RETURNS[HISTORICAL_RETURNS.length - 1].year;

/** Real (after-inflation) US stock statistics derived from the dataset. */
export const US_STOCK_REAL_RETURNS = {
  mean: mean(realStock),
  volatility: stdDev(realStock),
} as const;

/** Real (after-inflation) US 10-year Treasury statistics derived from the dataset. */
export const US_BOND_REAL_RETURNS = {
  mean: mean(realBond),
  volatility: stdDev(realBond),
} as const;

/** Stock/bond correlation of real annual returns. */
export const STOCK_BOND_CORRELATION = correlation(realStock, realBond);

/** CPI-U statistics (context only — the engines work in real dollars). */
export const US_INFLATION = {
  mean: mean(inflation),
  volatility: stdDev(inflation),
} as const;

export const MONTE_CARLO_DEFAULTS = {
  paths: 5000,
  // Block bootstrap preserves multi-year sequences (e.g. 2008 → 2009)
  use_historical_bootstrap: true,
  block_size: 3,
} as const;

/**
 * Convert arithmetic mean/vol to log-space parameters so that:
 *   exp(mu_log + sigma_log * Z) - 1
 * has the given arithmetic mean and volatility (Z ~ N(0,1)).
 */
function toLogParams(m: number, vol: number): { muLog: number; sigmaLog: number } {
  const sigmaLog = Math.sqrt(Math.log(1 + (vol / (1 + m)) ** 2));
  const muLog = Math.log(1 + m) - 0.5 * sigmaLog * sigmaLog;
  return { muLog, sigmaLog };
}

const STOCK_LOG = toLogParams(US_STOCK_REAL_RETURNS.mean, US_STOCK_REAL_RETURNS.volatility);
const BOND_LOG = toLogParams(US_BOND_REAL_RETURNS.mean, US_BOND_REAL_RETURNS.volatility);

/**
 * Generate correlated annual real returns for stocks and bonds.
 *
 * Sampling is done in log-return space — equities use Student-t (df=6) shocks
 * for fat tails; bonds use Normal shocks. A 2x2 Cholesky transform preserves
 * the dataset's stock/bond correlation. The final simple return
 *   R = exp(mu_log + sigma_log * Z) - 1
 * is bounded below by -1 (total loss) by construction; no artificial clamps.
 */
export function generateCorrelatedReturns(rng: SeededRNG): { stockReturn: number; bondReturn: number } {
  const degreesOfFreedom = 6;
  // Student-t(df) has variance df/(df-2); standardize it before applying
  // volatility calibrated from historical unit-variance shocks.
  const stockShock = rng.studentT(degreesOfFreedom) / Math.sqrt(degreesOfFreedom / (degreesOfFreedom - 2));
  const bondShock = rng.normal();

  // Cholesky for [[1, r], [r, 1]]: L = [[1, 0], [r, sqrt(1 - r^2)]]
  const r = STOCK_BOND_CORRELATION;
  const correlatedStock = stockShock;
  const correlatedBond = r * stockShock + Math.sqrt(1 - r * r) * bondShock;

  return {
    stockReturn: Math.exp(STOCK_LOG.muLog + correlatedStock * STOCK_LOG.sigmaLog) - 1,
    bondReturn: Math.exp(BOND_LOG.muLog + correlatedBond * BOND_LOG.sigmaLog) - 1,
  };
}
