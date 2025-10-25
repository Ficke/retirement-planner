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

    const quote = await service.getQuote('VTI');

    expect(quote.symbol).toBe('VTI');
    expect(quote.price).toBeGreaterThan(0);
    expect(quote.marketStatus).toMatch(/^(open|closed|extended_hours)$/);
    expect(quote.timestamp).toBeInstanceOf(Date);

    console.log('✅ VTI Quote:', {
      symbol: quote.symbol,
      price: `$${quote.price}`,
      marketStatus: quote.marketStatus,
      timestamp: quote.timestamp.toISOString()
    });
  }, 10000); // 10 second timeout

  it('should get historical price for NTSX', async () => {
    const service = getMarketDataService();

    const price = await service.getPriceAtDate('NTSX', new Date('2024-01-01'));

    expect(price).toBeGreaterThan(0);
    expect(price).toBeLessThan(1000); // Sanity check

    console.log('✅ NTSX Historical Price (2024-01-01):', `$${price}`);
  }, 15000); // 15 second timeout for historical data

  it('should batch multiple historical price requests efficiently', async () => {
    const service = getMarketDataService();

    const requests = [
      { symbol: 'VTI', dates: ['2024-01-01'] },
      { symbol: 'NTSX', dates: ['2024-01-01'] }
    ];

    const startTime = Date.now();
    const results = await service.getBatchPricesAtDates(requests);
    const duration = Date.now() - startTime;

    expect(results).toHaveLength(2);
    expect(results[0].price).toBeGreaterThan(0);
    expect(results[1].price).toBeGreaterThan(0);

    console.log('✅ Batch Historical Prices:', results.map((r: any) => ({
      symbol: r.symbol,
      date: r.date.toISOString().split('T')[0],
      price: `$${r.price}`
    })));
    console.log(`⚡ Batch request completed in ${duration}ms`);
  }, 20000); // 20 second timeout for batch requests

  it('should search for securities', async () => {
    const service = getMarketDataService();

    const results = await service.searchTickers('VT');

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('symbol');
    expect(results[0]).toHaveProperty('name');

    console.log('✅ Search Results for "VT":', results.slice(0, 3).map((s: any) => ({
      symbol: s.symbol,
      name: s.name
    })));
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