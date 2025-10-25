/**
 * Client-side HTTP service for market data operations.
 * This service runs in the browser and communicates with API routes.
 */

import { authenticatedFetch } from '@/lib/firebase/api-client';

export interface MarketDataResponse {
  symbol: string;
  date: string;
  price: number | null;
  isMutualFund?: boolean;
  pricingSymbol?: string;
  securityName?: string;
}

/**
 * Error thrown when attempting to fetch price data for a mutual fund.
 * Mutual funds require special handling and ETF equivalents.
 */
export class MutualFundError extends Error {
  constructor(
    message: string,
    public mutualFundName: string,
    public suggestedETF: string,
    public etfName: string,
    public suggestion: string,
    public symbol: string,
    public date: string
  ) {
    super(message);
    this.name = 'MutualFundError';
  }
}

export class MarketDataClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string = '/api') {
    this.baseUrl = baseUrl;
  }

  async getPrice(symbol: string, date: string): Promise<number | null> {
    const response = await authenticatedFetch(
      `${this.baseUrl}/market-data/${encodeURIComponent(symbol)}?date=${encodeURIComponent(date)}`
    );

    if (!response.ok) {
      const errorData = await response.json();

      // Check if this is a mutual fund error
      if (errorData.isMutualFund) {
        throw new MutualFundError(
          errorData.message,
          errorData.mutualFundName,
          errorData.suggestedETF,
          errorData.etfName,
          errorData.suggestion,
          errorData.symbol,
          errorData.date
        );
      }

      throw new Error(errorData.message || `Failed to fetch price: ${response.statusText}`);
    }

    const data: MarketDataResponse = await response.json();
    return data.price;
  }

  async fetchPrice(symbol: string, date: string): Promise<number | null> {
    const response = await authenticatedFetch(
      `${this.baseUrl}/market-data/${encodeURIComponent(symbol)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || `Failed to fetch price: ${response.statusText}`);
    }

    const data: MarketDataResponse = await response.json();

    // Log mutual fund conversions for transparency
    if (data.isMutualFund && data.pricingSymbol) {
      console.log(`📊 Mutual fund ${symbol} priced using ${data.pricingSymbol}: $${data.price}`);
    }

    return data.price;
  }
}

// Singleton instance
let marketDataClient: MarketDataClient | null = null;

export function getMarketDataClient(): MarketDataClient {
  if (!marketDataClient) {
    marketDataClient = new MarketDataClient();
  }
  return marketDataClient;
}

export function setMarketDataClient(client: MarketDataClient): void {
  marketDataClient = client;
}

export function resetMarketDataClient(): void {
  marketDataClient = null;
}