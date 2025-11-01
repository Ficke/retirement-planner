/**
 * Client-side compatibility layer for market data.
 * Forwards all calls to the HTTP client service.
 */

import { getMarketDataClient } from './client/market-data-client';

export interface MarketDataService {
  getPrice(symbol: string, date: string): Promise<number | null>;
  getPriceAtDate(symbol: string, date: Date): Promise<number | null>;
}

class ClientMarketDataService implements MarketDataService {
  private client = getMarketDataClient();

  async getPrice(symbol: string, date: string): Promise<number | null> {
    return this.client.getPrice(symbol, date);
  }

  async getPriceAtDate(symbol: string, date: Date): Promise<number | null> {
    const dateStr = date.toISOString().split('T')[0]; // Convert to YYYY-MM-DD
    return this.client.getPrice(symbol, dateStr);
  }
}

// Service factory
let marketDataService: MarketDataService | null = null;

export function getMarketDataService(): MarketDataService {
  if (!marketDataService) {
    marketDataService = new ClientMarketDataService();
  }
  return marketDataService;
}

export function setMarketDataService(service: MarketDataService): void {
  marketDataService = service;
}

export function resetMarketDataService(): void {
  marketDataService = null;
}