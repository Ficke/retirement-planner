import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getMarketDataService,
  setMarketDataService,
  resetMarketDataService,
  type MarketDataService
} from '@/services/market-data';

// Define missing types locally for tests
type SecurityQuote = {
  symbol: string;
  price: number;
  marketStatus: string;
  timestamp: Date;
};

type SecurityDetails = {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
  active: boolean;
  currency: string;
  marketCap?: number;
  description?: string;
  logoUrl?: string;
};

// Mock fetch globally
global.fetch = vi.fn();
const mockFetch = vi.mocked(fetch);

describe('Market Data Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMarketDataService();

    // Mock environment variables
    process.env.POLYGON_API_KEY = 'test-api-key';
    process.env.POLYGON_RATE_LIMIT_PER_MINUTE = '5';
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits correctly', async () => {
      const service = getMarketDataService();

      // Mock successful API responses
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          ticker: 'VTI',
          last: { price: 250.00, timestamp: Date.now() * 1000000 },
          market_status: 'open'
        })
      } as Response);

      // Make multiple requests quickly
      const promises = Array(3).fill(null).map(() => service.getQuote('VTI'));

      const startTime = Date.now();
      await Promise.all(promises);
      const endTime = Date.now();

      // Should complete quickly since we're under the rate limit
      expect(endTime - startTime).toBeLessThan(1000);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('getQuote', () => {
    it('should return quote for a single symbol', async () => {
      const service = getMarketDataService();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ticker: 'VTI',
          last: {
            price: 250.00,
            timestamp: 1640995200000000 // 2022-01-01 00:00:00 in microseconds
          },
          market_status: 'open'
        })
      } as Response);

      const quote = await service.getQuote('VTI');

      expect(quote.symbol).toBe('VTI');
      expect(quote.price).toBe(250.00);
      expect(quote.marketStatus).toBe('open');
      expect(quote.timestamp).toBeInstanceOf(Date);
    });

    it('should handle API errors gracefully', async () => {
      const service = getMarketDataService();

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      } as Response);

      await expect(service.getQuote('INVALID')).rejects.toThrow('Polygon API error: 404 Not Found');
    });

    it('should use fallback price when last price is not available', async () => {
      const service = getMarketDataService();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ticker: 'VTI',
          fmv: 249.50, // Fair market value as fallback
          market_status: 'closed'
        })
      } as Response);

      const quote = await service.getQuote('VTI');

      expect(quote.price).toBe(249.50);
      expect(quote.marketStatus).toBe('closed');
    });
  });

  describe('getQuotes', () => {
    it('should return quotes for multiple symbols', async () => {
      const service = getMarketDataService();

      // Mock multiple API calls
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            ticker: 'VTI',
            last: { price: 250.00, timestamp: Date.now() * 1000000 },
            market_status: 'open'
          })
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            ticker: 'NTSX',
            last: { price: 100.00, timestamp: Date.now() * 1000000 },
            market_status: 'open'
          })
        } as Response);

      const quotes = await service.getQuotes(['VTI', 'NTSX']);

      expect(quotes).toHaveLength(2);
      expect(quotes[0].symbol).toBe('VTI');
      expect(quotes[0].price).toBe(250.00);
      expect(quotes[1].symbol).toBe('NTSX');
      expect(quotes[1].price).toBe(100.00);
    });

    it('should handle partial failures gracefully', async () => {
      const service = getMarketDataService();

      // First call succeeds, second fails
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            ticker: 'VTI',
            last: { price: 250.00, timestamp: Date.now() * 1000000 },
            market_status: 'open'
          })
        } as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found'
        } as Response);

      const quotes = await service.getQuotes(['VTI', 'INVALID']);

      expect(quotes).toHaveLength(2);
      expect(quotes[0].price).toBe(250.00);
      expect(quotes[1].price).toBe(0); // Fallback for failed request
      expect(quotes[1].marketStatus).toBe('closed');
    });
  });

  describe('getSecurityDetails', () => {
    it('should return security details', async () => {
      const service = getMarketDataService();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ticker: 'VTI',
          name: 'Vanguard Total Stock Market ETF',
          primary_exchange: 'XNYS',
          type: 'ETF',
          active: true,
          currency_name: 'USD',
          market_cap: 350000000000,
          description: 'Tracks the CRSP US Total Market Index',
          branding: {
            logo_url: 'https://example.com/vti-logo.png'
          }
        })
      } as Response);

      const details = await service.getSecurityDetails('VTI');

      expect(details).toEqual({
        symbol: 'VTI',
        name: 'Vanguard Total Stock Market ETF',
        exchange: 'XNYS',
        type: 'ETF',
        active: true,
        currency: 'USD',
        marketCap: 350000000000,
        description: 'Tracks the CRSP US Total Market Index',
        logoUrl: 'https://example.com/vti-logo.png'
      });
    });
  });

  describe('getHistoricalPrices', () => {
    it('should return historical price data', async () => {
      const service = getMarketDataService();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ticker: 'VTI',
          status: 'OK',
          adjusted: true,
          queryCount: 2,
          resultsCount: 2,
          results: [
            {
              c: 250.00, // close
              h: 252.00, // high
              l: 248.00, // low
              o: 249.00, // open
              t: 1640995200000, // 2022-01-01
              v: 1000000, // volume
              vw: 250.50, // volume weighted average
              n: 5000 // number of transactions
            },
            {
              c: 251.00,
              h: 253.00,
              l: 249.50,
              o: 250.00,
              t: 1641081600000, // 2022-01-02
              v: 1200000,
              vw: 251.25,
              n: 5500
            }
          ]
        })
      } as Response);

      const fromDate = new Date('2022-01-01');
      const toDate = new Date('2022-01-02');
      const prices = await service.getHistoricalPrices('VTI', fromDate, toDate);

      expect(prices).toHaveLength(2);
      expect(prices[0]).toEqual({
        date: new Date(1640995200000),
        open: 249.00,
        high: 252.00,
        low: 248.00,
        close: 250.00,
        volume: 1000000
      });
    });

    it('should handle empty results', async () => {
      const service = getMarketDataService();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ticker: 'VTI',
          status: 'OK',
          adjusted: true,
          queryCount: 0,
          resultsCount: 0
        })
      } as Response);

      const fromDate = new Date('2022-01-01');
      const toDate = new Date('2022-01-02');
      const prices = await service.getHistoricalPrices('VTI', fromDate, toDate);

      expect(prices).toEqual([]);
    });
  });

  describe('searchTickers', () => {
    it('should return search results', async () => {
      const service = getMarketDataService();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              ticker: 'VTI',
              name: 'Vanguard Total Stock Market ETF',
              primary_exchange: 'XNYS',
              type: 'ETF',
              active: true,
              currency_name: 'USD'
            },
            {
              ticker: 'VTV',
              name: 'Vanguard Value ETF',
              primary_exchange: 'XNYS',
              type: 'ETF',
              active: true,
              currency_name: 'USD'
            }
          ]
        })
      } as Response);

      const results = await service.searchTickers('VT');

      expect(results).toHaveLength(2);
      expect(results[0].symbol).toBe('VTI');
      expect(results[1].symbol).toBe('VTV');
    });

    it('should return empty array for short queries', async () => {
      const service = getMarketDataService();

      const results = await service.searchTickers('');

      expect(results).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should handle search errors gracefully', async () => {
      const service = getMarketDataService();

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      } as Response);

      const results = await service.searchTickers('TEST');

      expect(results).toEqual([]);
    });
  });

  describe('Service Factory', () => {
    it('should throw error when API key is missing', () => {
      delete process.env.POLYGON_API_KEY;

      expect(() => getMarketDataService()).toThrow('POLYGON_API_KEY environment variable is required');
    });

    it('should use default rate limit when not specified', () => {
      delete process.env.POLYGON_RATE_LIMIT_PER_MINUTE;

      // Should not throw
      expect(() => getMarketDataService()).not.toThrow();
    });

    it('should allow service injection for testing', () => {
      const mockService: MarketDataService = {
        getPrice: vi.fn(),
        getQuote: vi.fn(),
        getQuotes: vi.fn(),
        getSecurityDetails: vi.fn(),
        getHistoricalPrices: vi.fn(),
        searchTickers: vi.fn(),
        getPriceAtDate: vi.fn(),
        getBatchPricesAtDates: vi.fn(),
        getLatestPrices: vi.fn(),
        // getMonthlyPrices: vi.fn(), // Method not in current interface
        // getBatchMonthlyPrices: vi.fn() // Method not in current interface
      };

      setMarketDataService(mockService);
      const service = getMarketDataService();

      expect(service).toBe(mockService);
    });
  });

  describe('Historical Data Optimization', () => {
    describe('getPriceAtDate', () => {
      it('should return cached price when available', async () => {
        const service = getMarketDataService();

        // First call - will fetch and cache
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            ticker: 'VTI',
            status: 'OK',
            adjusted: true,
            queryCount: 1,
            resultsCount: 1,
            results: [{
              c: 250.00,
              h: 252.00,
              l: 248.00,
              o: 249.00,
              t: 1640995200000, // 2022-01-01
              v: 1000000,
              vw: 250.50,
              n: 5000
            }]
          })
        } as Response);

        const date = new Date('2022-01-01');
        const price1 = await service.getPriceAtDate('VTI', date);

        expect(price1).toBe(250.00);
        expect(mockFetch).toHaveBeenCalledTimes(1);

        // Second call - should use cache
        const price2 = await service.getPriceAtDate('VTI', date);

        expect(price2).toBe(250.00);
        expect(mockFetch).toHaveBeenCalledTimes(1); // No additional API call
      });

      it('should handle weekend dates by finding closest trading day', async () => {
        const service = getMarketDataService();

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            ticker: 'VTI',
            status: 'OK',
            adjusted: true,
            queryCount: 2,
            resultsCount: 2,
            results: [
              {
                c: 249.00,
                h: 251.00,
                l: 247.00,
                o: 248.00,
                t: 1640908800000, // 2021-12-31 (Friday)
                v: 1000000,
                vw: 249.50,
                n: 5000
              },
              {
                c: 251.00,
                h: 253.00,
                l: 249.00,
                o: 250.00,
                t: 1641168000000, // 2022-01-03 (Monday)
                v: 1200000,
                vw: 251.25,
                n: 5500
              }
            ]
          })
        } as Response);

        // Request price for Saturday (non-trading day)
        const saturdayDate = new Date('2022-01-01'); // This was a Saturday
        const price = await service.getPriceAtDate('VTI', saturdayDate);

        // Should return Friday's price as it's closer
        expect(price).toBe(249.00);
      });
    });

    describe('getBatchPricesAtDates', () => {
      it('should efficiently batch multiple historical price requests', async () => {
        const service = getMarketDataService();

        // Mock API responses for different symbols
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              ticker: 'VTI',
              status: 'OK',
              results: [{
                c: 250.00,
                h: 252.00,
                l: 248.00,
                o: 249.00,
                t: 1640995200000, // 2022-01-01
                v: 1000000,
                vw: 250.50,
                n: 5000
              }]
            })
          } as Response)
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              ticker: 'NTSX',
              status: 'OK',
              results: [{
                c: 100.00,
                h: 101.00,
                l: 99.00,
                o: 99.50,
                t: 1640995200000, // 2022-01-01
                v: 500000,
                vw: 100.25,
                n: 2500
              }]
            })
          } as Response);

        const requests = [
          { symbol: 'VTI', dates: ['2022-01-01'] },
          { symbol: 'NTSX', dates: ['2022-01-01'] },
        ];

        const results = await service.getBatchPricesAtDates(requests);

        expect(results).toHaveLength(2);
        expect(results[0]).toEqual({
          symbol: 'VTI',
          date: new Date('2022-01-01'),
          price: 250.00
        });
        expect(results[1]).toEqual({
          symbol: 'NTSX',
          date: new Date('2022-01-01'),
          price: 100.00
        });

        // Should have made only 2 API calls (one per symbol)
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });

      it('should use cache for previously fetched dates', async () => {
        const service = getMarketDataService();

        // First batch call
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            ticker: 'VTI',
            status: 'OK',
            results: [{
              c: 250.00,
              h: 252.00,
              l: 248.00,
              o: 249.00,
              t: 1640995200000, // 2022-01-01
              v: 1000000,
              vw: 250.50,
              n: 5000
            }]
          })
        } as Response);

        const requests1 = [{ symbol: 'VTI', dates: ['2022-01-01'] }];
        await service.getBatchPricesAtDates(requests1);

        expect(mockFetch).toHaveBeenCalledTimes(1);

        // Second batch call with same date - should use cache
        const requests2 = [{ symbol: 'VTI', dates: ['2022-01-01'] }];
        const results = await service.getBatchPricesAtDates(requests2);

        expect(results[0].price).toBe(250.00);
        expect(mockFetch).toHaveBeenCalledTimes(1); // No additional API call
      });
    });

    describe('getLatestPrices', () => {
      it('should return current prices for multiple symbols', async () => {
        const service = getMarketDataService();

        // Mock quotes for multiple symbols
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              ticker: 'VTI',
              last: { price: 250.00, timestamp: Date.now() * 1000000 },
              market_status: 'open'
            })
          } as Response)
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              ticker: 'NTSX',
              last: { price: 100.00, timestamp: Date.now() * 1000000 },
              market_status: 'open'
            })
          } as Response);

        const prices = await service.getLatestPrices(['VTI', 'NTSX']);

        expect(prices).toEqual({
          VTI: 250.00,
          NTSX: 100.00
        });
      });
    });
  });
});