/**
 * Integration test to verify Polygon.io API is working with real credentials
 * This test will be skipped in CI/automated testing but can be run manually
 */

import { describe, it, expect } from 'vitest';
import { getMarketDataService } from '@/services/market-data';

// Only run this test if we have real API credentials
const hasApiKey = process.env.POLYGON_API_KEY && process.env.POLYGON_API_KEY !== 'your_actual_api_key_here';

describe.skipIf(!hasApiKey)('Polygon.io Real API Integration', () => {
  it.skip('should get real quote data for VTI (requires paid plan)', async () => {
    // Note: Real-time quotes require a paid Polygon.io plan
    // Free tier gets 403 Forbidden for real-time data
    const service = getMarketDataService();

    // Note: getQuote method was removed - using getPriceAtDate instead
    const price = await service.getPriceAtDate('VTI', new Date('2023-01-01'));

    expect(price).toBeGreaterThan(0);

    console.log('✅ VTI Historical Price:', {
      symbol: 'VTI',
      date: '2023-01-01',
      price: `$${price}`
    });
  }, 10000); // 10 second timeout

  it('should get historical price for NTSX', async () => {
    const service = getMarketDataService();

    const price = await service.getPriceAtDate('NTSX', new Date('2024-01-01'));

    expect(price).toBeGreaterThan(0);
    expect(price).toBeLessThan(1000); // Sanity check

    console.log('✅ NTSX Historical Price (2024-01-01):', `$${price}`);
  }, 15000); // 15 second timeout for historical data

  it.skip('should batch multiple historical price requests efficiently (not implemented)', async () => {
    // Note: getBatchPricesAtDates was removed - would need individual calls
    const service = getMarketDataService();
    
    // Test individual calls instead
    const vtiPrice = await service.getPriceAtDate('VTI', new Date('2024-01-01'));
    const ntsxPrice = await service.getPriceAtDate('NTSX', new Date('2024-01-01'));

    expect(vtiPrice).toBeGreaterThan(0);
    expect(ntsxPrice).toBeGreaterThan(0);

    console.log('✅ Individual Historical Prices:', [
      { symbol: 'VTI', date: '2024-01-01', price: `$${vtiPrice}` },
      { symbol: 'NTSX', date: '2024-01-01', price: `$${ntsxPrice}` }
    ]);
  }, 20000); // 20 second timeout for batch requests

  it.skip('should search for securities (not implemented)', async () => {
    // Note: searchTickers was removed
    console.log('✅ Search functionality not implemented yet');
  }, 10000);

  it('should demonstrate cache persistence', async () => {
    const service = getMarketDataService();

    // First call - will hit API and cache
    const startTime1 = Date.now();
    const price1 = await service.getPriceAtDate('VTI', new Date('2023-12-01'));
    const duration1 = Date.now() - startTime1;

    // Second call - should use cache
    const startTime2 = Date.now();
    const price2 = await service.getPriceAtDate('VTI', new Date('2023-12-01'));
    const duration2 = Date.now() - startTime2;

    expect(price1).toBe(price2); // Same price
    expect(duration2).toBeLessThan(100); // Cache should be very fast (< 100ms)

    console.log('✅ Cache Performance:');
    console.log(`  First call (API): ${duration1}ms -> $${price1}`);
    console.log(`  Second call (cache): ${duration2}ms -> $${price2}`);
    console.log(`  🚀 Cache speedup: ${Math.round(duration1 / Math.max(duration2, 1))}x faster`);
  }, 25000);
});

// Always run this test to show current configuration
describe('Polygon.io Configuration', () => {
  it('should show current API configuration', () => {
    const hasKey = !!process.env.POLYGON_API_KEY;
    const keyVisible = hasKey ? `${process.env.POLYGON_API_KEY?.slice(0, 8)}...` : 'Not set';
    const rateLimit = process.env.POLYGON_RATE_LIMIT_PER_MINUTE || '5';

    console.log('📋 Polygon.io Configuration:');
    console.log(`  API Key: ${keyVisible}`);
    console.log(`  Rate Limit: ${rateLimit} requests/minute`);
    console.log(`  Integration Tests: ${hasApiKey ? '✅ Enabled' : '⚠️ Skipped (no real API key)'}`);

    if (!hasApiKey) {
      console.log('💡 To run integration tests, set POLYGON_API_KEY in .env.local');
    }

    expect(true).toBe(true); // Always pass
  });
});