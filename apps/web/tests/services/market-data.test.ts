import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getMarketDataService,
  setMarketDataService,
  resetMarketDataService,
  type MarketDataService
} from '@/services/market-data';

// Mock the client instead of fetch for more reliable testing
vi.mock('@/services/client/market-data-client', () => ({
  getMarketDataClient: () => mockClient,
}));

const mockClient = {
  getPrice: vi.fn(),
};

describe('Market Data Service - Implemented Features', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMarketDataService();
  });

  describe('getPriceAtDate (Core Functionality)', () => {
    it('should get price for a given date', async () => {
      mockClient.getPrice.mockResolvedValue(250.00);
      
      const service = getMarketDataService();
      const price = await service.getPriceAtDate('VTI', new Date('2023-01-01'));

      expect(price).toBe(250.00);
      expect(mockClient.getPrice).toHaveBeenCalledWith('VTI', '2023-01-01');
    });

    it('should handle errors gracefully', async () => {
      mockClient.getPrice.mockRejectedValue(new Error('Price not available'));
      
      const service = getMarketDataService();
      
      await expect(service.getPriceAtDate('INVALID', new Date('2023-01-01')))
        .rejects.toThrow('Price not available');
    });
  });

  describe('getPrice (Legacy API)', () => {
    it('should get price using string date format', async () => {
      mockClient.getPrice.mockResolvedValue(150.00);
      
      const service = getMarketDataService();
      const price = await service.getPrice('AAPL', '2023-01-01');

      expect(price).toBe(150.00);
      expect(mockClient.getPrice).toHaveBeenCalledWith('AAPL', '2023-01-01');
    });
  });

  describe('Service Factory', () => {
    it('should return singleton instance', () => {
      const service1 = getMarketDataService();
      const service2 = getMarketDataService();
      
      expect(service1).toBe(service2);
    });

    it('should allow service injection for testing', () => {
      const mockService: MarketDataService = {
        getPrice: vi.fn(),
        getPriceAtDate: vi.fn(),
      };

      setMarketDataService(mockService);
      const service = getMarketDataService();

      expect(service).toBe(mockService);
    });
  });
});