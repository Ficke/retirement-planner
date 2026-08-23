/**
 * Market model statistics and Monte Carlo orchestration defaults.
 *
 * All statistics are DERIVED from the canonical historical dataset
 * (market-history-annual.ts, 1928–2025) — real (inflation-adjusted) annual
 * returns. There are no hand-maintained market constants; edit the dataset
 * and every consumer (parametric model, Assumptions page) follows.
 */

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

// Long enough to carry a multi-year regime rather than a single crash year.
// Longer blocks trade sampling diversity for that, so this sits near the
// n^(1/3) heuristic for a 98-year dataset.
export const MONTE_CARLO_BLOCK_SIZE = 5;
