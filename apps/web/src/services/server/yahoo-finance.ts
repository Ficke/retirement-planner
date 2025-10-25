/**
 * Yahoo Finance service for fetching mutual fund NAV prices.
 *
 * Yahoo Finance provides accurate NAV (Net Asset Value) prices for mutual funds,
 * which are not available through Polygon API.
 */

import yahooFinance from 'yahoo-finance2';

export interface YahooQuote {
  symbol: string;
  regularMarketPrice: number;
  regularMarketTime: Date;
}

export class YahooFinanceService {
  /**
   * Get the NAV price for a mutual fund on a specific date.
   *
   * @param symbol - Mutual fund symbol (e.g., VTSAX)
   * @param date - Date to fetch price for
   * @returns Price on that date, or null if not available
   */
  async getPriceAtDate(symbol: string, date: Date): Promise<number | null> {
    try {
      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);

      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);

      // Fetch historical data for the specific date
      const result = await yahooFinance.historical(symbol, {
        period1: startDate,
        period2: endDate,
        interval: '1d',
      });

      if (result.length === 0) {
        console.warn(`No Yahoo Finance data found for ${symbol} on ${date.toISOString().split('T')[0]}`);
        return null;
      }

      // Use the close price from the historical data
      const price = result[0].close;

      console.log(`📊 Yahoo Finance: ${symbol} on ${date.toISOString().split('T')[0]} = $${price}`);
      return price;
    } catch (error) {
      console.error(`Failed to fetch Yahoo Finance data for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Get the current NAV price for a mutual fund.
   *
   * @param symbol - Mutual fund symbol
   * @returns Current price, or null if not available
   */
  async getCurrentPrice(symbol: string): Promise<number | null> {
    try {
      const quote = await yahooFinance.quote(symbol);

      if (!quote || !quote.regularMarketPrice) {
        console.warn(`No current price found for ${symbol}`);
        return null;
      }

      console.log(`📊 Yahoo Finance (current): ${symbol} = $${quote.regularMarketPrice}`);
      return quote.regularMarketPrice;
    } catch (error) {
      console.error(`Failed to fetch current Yahoo Finance price for ${symbol}:`, error);
      return null;
    }
  }
}

// Singleton instance
let yahooFinanceService: YahooFinanceService | null = null;

export function getYahooFinanceService(): YahooFinanceService {
  if (!yahooFinanceService) {
    yahooFinanceService = new YahooFinanceService();
  }
  return yahooFinanceService;
}
