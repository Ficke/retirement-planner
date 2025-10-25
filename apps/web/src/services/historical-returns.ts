/**
 * Historical returns service for calculating real market performance
 * between snapshot dates and current date for catch-up calculations.
 */

import type { CatchUpCalculation } from '@/domain/types';

export interface HistoricalReturnsService {
  calculateCatchUp(
    snapshotDate: string,
    targetDate: string,
    stocksWeight: number,
    bondsWeight: number,
    initialBalance: number
  ): Promise<CatchUpCalculation>;
}

// Simple historical returns data (annual returns)
// TODO: Replace with actual historical data or API
const HISTORICAL_ANNUAL_RETURNS = {
  // S&P 500 annual returns (simplified for MVP)
  stocks: [
    { year: 2024, return: 0.15 }, // Estimate for partial year
    { year: 2023, return: 0.242 },
    { year: 2022, return: -0.182 },
    { year: 2021, return: 0.287 },
    { year: 2020, return: 0.184 },
    { year: 2019, return: 0.315 },
    { year: 2018, return: -0.044 },
    { year: 2017, return: 0.217 },
    { year: 2016, return: 0.120 },
    { year: 2015, return: 0.014 },
  ],
  // Aggregate bond index returns (simplified)
  bonds: [
    { year: 2024, return: 0.02 }, // Estimate for partial year
    { year: 2023, return: 0.054 },
    { year: 2022, return: -0.130 },
    { year: 2021, return: -0.015 },
    { year: 2020, return: 0.074 },
    { year: 2019, return: 0.087 },
    { year: 2018, return: 0.001 },
    { year: 2017, return: 0.035 },
    { year: 2016, return: 0.026 },
    { year: 2015, return: 0.006 },
  ],
};

class HistoricalReturnsServiceImpl implements HistoricalReturnsService {
  async calculateCatchUp(
    snapshotDate: string,
    targetDate: string,
    stocksWeight: number,
    bondsWeight: number,
    initialBalance: number
  ): Promise<CatchUpCalculation> {
    const snapshot = new Date(snapshotDate);
    const target = new Date(targetDate);

    if (snapshot >= target) {
      // No catch-up needed if snapshot is current
      return {
        snapshotId: '', // Will be set by caller
        targetDate,
        finalBalance: initialBalance,
        returnsApplied: {
          stocksReturn: 0,
          bondsReturn: 0,
          totalReturn: 0,
        },
        methodology: 'no-catchup-needed',
        calculatedAt: new Date().toISOString(),
      };
    }

    // Calculate returns for the period
    const returns = this.calculatePeriodReturns(snapshot, target);

    // Apply weighted returns
    const stocksReturn = returns.stocks;
    const bondsReturn = returns.bonds;
    const totalReturn = (stocksReturn * stocksWeight) + (bondsReturn * bondsWeight);

    // Calculate final balance
    const finalBalance = initialBalance * (1 + totalReturn);

    return {
      snapshotId: '', // Will be set by caller
      targetDate,
      finalBalance,
      returnsApplied: {
        stocksReturn,
        bondsReturn,
        totalReturn,
      },
      methodology: 'historical-returns',
      calculatedAt: new Date().toISOString(),
    };
  }

  private calculatePeriodReturns(startDate: Date, endDate: Date): { stocks: number; bonds: number } {
    const startYear = startDate.getFullYear();
    const endYear = endDate.getFullYear();

    // For simplicity, use annual returns
    // TODO: Implement more sophisticated daily/monthly interpolation

    if (startYear === endYear) {
      // Same year - calculate partial year return
      const dayOfYear = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      const yearFraction = dayOfYear / 365;

      const stocksAnnualReturn = this.getReturnForYear(startYear, 'stocks');
      const bondsAnnualReturn = this.getReturnForYear(startYear, 'bonds');

      return {
        stocks: stocksAnnualReturn * yearFraction,
        bonds: bondsAnnualReturn * yearFraction,
      };
    }

    // Multi-year calculation
    let cumulativeStocksReturn = 1;
    let cumulativeBondsReturn = 1;

    // Partial first year
    const startOfStartYear = new Date(startYear, 0, 1);
    const endOfStartYear = new Date(startYear, 11, 31);
    const daysRemainingInStartYear = Math.floor(
      (endOfStartYear.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    const startYearFraction = daysRemainingInStartYear / 365;

    const startYearStocksReturn = this.getReturnForYear(startYear, 'stocks') * startYearFraction;
    const startYearBondsReturn = this.getReturnForYear(startYear, 'bonds') * startYearFraction;

    cumulativeStocksReturn *= (1 + startYearStocksReturn);
    cumulativeBondsReturn *= (1 + startYearBondsReturn);

    // Full intermediate years
    for (let year = startYear + 1; year < endYear; year++) {
      const stocksReturn = this.getReturnForYear(year, 'stocks');
      const bondsReturn = this.getReturnForYear(year, 'bonds');

      cumulativeStocksReturn *= (1 + stocksReturn);
      cumulativeBondsReturn *= (1 + bondsReturn);
    }

    // Partial end year
    if (endYear > startYear) {
      const startOfEndYear = new Date(endYear, 0, 1);
      const daysInEndYear = Math.floor(
        (endDate.getTime() - startOfEndYear.getTime()) / (1000 * 60 * 60 * 24)
      );
      const endYearFraction = daysInEndYear / 365;

      const endYearStocksReturn = this.getReturnForYear(endYear, 'stocks') * endYearFraction;
      const endYearBondsReturn = this.getReturnForYear(endYear, 'bonds') * endYearFraction;

      cumulativeStocksReturn *= (1 + endYearStocksReturn);
      cumulativeBondsReturn *= (1 + endYearBondsReturn);
    }

    return {
      stocks: cumulativeStocksReturn - 1,
      bonds: cumulativeBondsReturn - 1,
    };
  }

  private getReturnForYear(year: number, assetClass: 'stocks' | 'bonds'): number {
    const returns = HISTORICAL_ANNUAL_RETURNS[assetClass];
    const yearData = returns.find(r => r.year === year);

    if (yearData) {
      return yearData.return;
    }

    // Fallback to long-term averages if year not found
    if (assetClass === 'stocks') {
      return 0.10; // 10% long-term average
    } else {
      return 0.04; // 4% long-term average for bonds
    }
  }
}

// Singleton service
let historicalReturnsService: HistoricalReturnsService | null = null;

export function getHistoricalReturnsService(): HistoricalReturnsService {
  if (!historicalReturnsService) {
    historicalReturnsService = new HistoricalReturnsServiceImpl();
  }
  return historicalReturnsService;
}

// Export for testing
export { HistoricalReturnsServiceImpl, HISTORICAL_ANNUAL_RETURNS };