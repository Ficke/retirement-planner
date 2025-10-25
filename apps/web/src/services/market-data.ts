/**
 * Client-side compatibility layer for market data.
 * Forwards all calls to the HTTP client service.
 */

import { getMarketDataClient } from './client/market-data-client';

export interface MarketDataService {
  getPrice(symbol: string, date: string): Promise<number | null>;
  getPriceAtDate(symbol: string, date: Date): Promise<number | null>;
  // Placeholder methods - not fully implemented yet
  getQuote(symbol: string): Promise<any>;
  getQuotes(symbols: string[]): Promise<any>;
  getSecurityDetails(symbol: string): Promise<any>;
  getHistoricalPrices(symbol: string, startDate: Date, endDate: Date): Promise<any>;
  getLatestPrices(symbols: string[]): Promise<any>;
  getBatchPricesAtDates(requests: Array<{ symbol: string; dates: string[] }>): Promise<any>;
  searchTickers(query: string): Promise<any>;
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

  // Placeholder implementations - throw meaningful errors
  async getQuote(symbol: string): Promise<any> {
    throw new Error('getQuote not implemented yet - use getPriceAtDate for basic price data');
  }

  async getQuotes(symbols: string[]): Promise<any> {
    throw new Error('getQuotes not implemented yet - use getPriceAtDate for individual symbols');
  }

  async getSecurityDetails(symbol: string): Promise<any> {
    throw new Error('getSecurityDetails not implemented yet - API route needed');
  }

  async getHistoricalPrices(symbol: string, startDate: Date, endDate: Date): Promise<any> {
    throw new Error('getHistoricalPrices not implemented yet - API route needed');
  }

  async getLatestPrices(symbols: string[]): Promise<any> {
    throw new Error('getLatestPrices not implemented yet - API route needed');
  }

  async getBatchPricesAtDates(requests: Array<{ symbol: string; dates: string[] }>): Promise<any> {
    throw new Error('getBatchPricesAtDates not implemented yet - API route needed');
  }

  async searchTickers(query: string): Promise<any> {
    throw new Error('searchTickers not implemented yet - API route needed');
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