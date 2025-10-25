/**
 * Historical US Market Returns (1926-2024)
 * Source: Ibbotson SBBI, Federal Reserve, Robert Shiller data
 * Real returns (inflation-adjusted) for Monte Carlo simulation
 */

// Import SeededRNG for proper random number generation
import type { SeededRNG } from '@/engine/projection';

// Historical US Stock Market Real Returns (1926-2024)
// Source: S&P 500 total return index, inflation-adjusted
export const US_STOCK_REAL_RETURNS_1926_2024 = {
  mean: 0.071, // 7.1% real return
  volatility: 0.201, // 20.1% standard deviation
  distribution: 'normal', // Approximate distribution for Monte Carlo
  
  // Key statistics from 98-year period
  worst_year: -0.4281, // 1931: -42.81%
  best_year: 0.5736, // 1935: +57.36%
  worst_decade: -0.0049, // 1930s: -0.49% annualized
  best_decade: 0.1716, // 1950s: +17.16% annualized
  
  // Percentile data for validation
  p10: -0.123, // 10th percentile return
  p25: -0.047, // 25th percentile return
  p50: 0.085, // Median return
  p75: 0.204, // 75th percentile return
  p90: 0.329, // 90th percentile return
} as const;

// Historical US Bond Real Returns (1926-2024)
// Source: Long-term government bonds, inflation-adjusted
export const US_BOND_REAL_RETURNS_1926_2024 = {
  mean: 0.025, // 2.5% real return
  volatility: 0.079, // 7.9% standard deviation
  distribution: 'normal',
  
  // Key statistics
  worst_year: -0.1584, // 1967: -15.84%
  best_year: 0.3508, // 1982: +35.08%
  worst_decade: -0.0334, // 1970s: -3.34% annualized
  best_decade: 0.0889, // 1980s: +8.89% annualized
  
  // Percentile data
  p10: -0.067,
  p25: -0.025,
  p50: 0.031,
  p75: 0.081,
  p90: 0.134,
} as const;

// Stock-Bond Correlation Matrix (1926-2024)
export const ASSET_CORRELATION_MATRIX_1926_2024 = {
  stocks_bonds: 0.12, // Low positive correlation historically
  stocks_inflation: -0.05, // Slight negative correlation
  bonds_inflation: -0.35, // Moderate negative correlation
} as const;

// Inflation Statistics (1926-2024)
export const US_INFLATION_1926_2024 = {
  mean: 0.029, // 2.9% average inflation
  volatility: 0.042, // 4.2% standard deviation
  worst_year: -0.1029, // 1932: -10.29% (deflation)
  best_year: 0.1979, // 1946: +19.79%
} as const;

// Monte Carlo Simulation Parameters
export const MONTE_CARLO_DEFAULTS = {
  paths: 5000, // Professional-grade simulation paths (was 10000 for research, 5000 optimal for production)
  years_to_simulate: 50, // Maximum projection horizon
  rebalance_frequency: 1, // Annual rebalancing
  sequence_risk_adjustment: true, // Account for early retirement risk

  // Bootstrap vs parametric sampling
  use_historical_bootstrap: true, // Use block bootstrap (well-regarded approach)
  block_size: 3, // For block bootstrap if enabled
} as const;

/**
 * Generate correlated annual returns for stocks and bonds
 * Uses Cholesky decomposition for proper correlation structure
 */
export function generateCorrelatedReturns(rng: SeededRNG): { stockReturn: number; bondReturn: number } {
  try {
    // Generate independent shocks using proper distributions
    const stockShock = rng.studentT(6); // Student-t with df=6 for equities per CLAUDE.md
    const bondShock = rng.normal(); // Normal for bonds

    // Apply Cholesky transformation for correlation
    const correlation = [[1.0, ASSET_CORRELATION_MATRIX_1926_2024.stocks_bonds],
                        [ASSET_CORRELATION_MATRIX_1926_2024.stocks_bonds, 1.0]];
    const L = choleskyDecomposition(correlation);

    const correlatedShocks = [
      L[0][0] * stockShock,
      L[1][0] * stockShock + L[1][1] * bondShock
    ];

    const stockReturn = US_STOCK_REAL_RETURNS_1926_2024.mean +
      correlatedShocks[0] * US_STOCK_REAL_RETURNS_1926_2024.volatility;

    const bondReturn = US_BOND_REAL_RETURNS_1926_2024.mean +
      correlatedShocks[1] * US_BOND_REAL_RETURNS_1926_2024.volatility;

    // Bound returns to prevent unrealistic values
    // Historical worst year was -42.81% for stocks, -15.84% for bonds
    // Allow 50% buffer for extreme cases
    const maxStockReturn = 0.80; // 80% max gain
    const minStockReturn = -0.60; // -60% max loss
    const maxBondReturn = 0.50; // 50% max gain
    const minBondReturn = -0.25; // -25% max loss

    const boundedStockReturn = Math.max(minStockReturn, Math.min(maxStockReturn, stockReturn));
    const boundedBondReturn = Math.max(minBondReturn, Math.min(maxBondReturn, bondReturn));

    // Warn if bounds were applied (indicates potential issue)
    if (boundedStockReturn !== stockReturn || boundedBondReturn !== bondReturn) {
      console.warn('Return bounds applied:', {
        stockReturn,
        boundedStockReturn,
        bondReturn,
        boundedBondReturn
      });
    }

    return {
      stockReturn: boundedStockReturn,
      bondReturn: boundedBondReturn
    };
  } catch (error) {
    // Fallback to historical mean returns if generation fails
    console.error('Failed to generate correlated returns, using mean returns:', error);
    return {
      stockReturn: US_STOCK_REAL_RETURNS_1926_2024.mean,
      bondReturn: US_BOND_REAL_RETURNS_1926_2024.mean
    };
  }
}

/**
 * Get expected returns based on asset allocation
 * Uses historical data to estimate portfolio returns
 */
export function getExpectedPortfolioReturn(stockWeight: number, bondWeight: number): {
  expectedReturn: number;
  expectedVolatility: number;
} {
  const expectedReturn = 
    stockWeight * US_STOCK_REAL_RETURNS_1926_2024.mean +
    bondWeight * US_BOND_REAL_RETURNS_1926_2024.mean;
    
  // Simplified volatility calculation (should use full covariance matrix)
  const expectedVolatility = Math.sqrt(
    Math.pow(stockWeight * US_STOCK_REAL_RETURNS_1926_2024.volatility, 2) +
    Math.pow(bondWeight * US_BOND_REAL_RETURNS_1926_2024.volatility, 2) +
    2 * stockWeight * bondWeight * 
    US_STOCK_REAL_RETURNS_1926_2024.volatility * 
    US_BOND_REAL_RETURNS_1926_2024.volatility * 
    ASSET_CORRELATION_MATRIX_1926_2024.stocks_bonds
  );
  
  return { expectedReturn, expectedVolatility };
}

/**
 * Perform Cholesky decomposition on correlation matrix.
 * Returns lower triangular matrix L such that L * L^T = correlation matrix.
 */
function choleskyDecomposition(correlation: number[][]): number[][] {
  const n = correlation.length;
  const L: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      if (i === j) {
        // Diagonal elements
        let sum = 0;
        for (let k = 0; k < j; k++) {
          sum += L[i][k] * L[i][k];
        }
        L[i][j] = Math.sqrt(correlation[i][i] - sum);
      } else {
        // Off-diagonal elements
        let sum = 0;
        for (let k = 0; k < j; k++) {
          sum += L[i][k] * L[j][k];
        }
        L[i][j] = (correlation[i][j] - sum) / L[j][j];
      }
    }
  }
  
  return L;
}