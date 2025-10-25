import { describe, it, expect } from 'vitest';
import { HistoricalReturnsServiceImpl, HISTORICAL_ANNUAL_RETURNS } from '@/services/historical-returns';

describe('Historical Returns Service', () => {
  let service: HistoricalReturnsServiceImpl;

  beforeEach(() => {
    service = new HistoricalReturnsServiceImpl();
  });

  describe('calculateCatchUp', () => {
    it('should return zero returns when snapshot date is current', async () => {
      const today = new Date().toISOString().split('T')[0];
      const result = await service.calculateCatchUp(
        today,
        today,
        0.7, // 70% stocks
        0.3, // 30% bonds
        10000
      );

      expect(result.finalBalance).toBe(10000);
      expect(result.returnsApplied.totalReturn).toBe(0);
      expect(result.methodology).toBe('no-catchup-needed');
    });

    it('should return zero returns when snapshot date is after target', async () => {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      const result = await service.calculateCatchUp(
        today.toISOString().split('T')[0],
        yesterday.toISOString().split('T')[0],
        0.7,
        0.3,
        10000
      );

      expect(result.finalBalance).toBe(10000);
      expect(result.returnsApplied.totalReturn).toBe(0);
      expect(result.methodology).toBe('no-catchup-needed');
    });

    it('should calculate returns for partial year within same year', async () => {
      // Test with a known year that has data
      const startDate = '2023-01-01';
      const endDate = '2023-06-30'; // Half year

      const result = await service.calculateCatchUp(
        startDate,
        endDate,
        1.0, // 100% stocks for easier calculation
        0.0, // 0% bonds
        10000
      );

      // For partial year, should get a fraction of annual return
      expect(result.returnsApplied.stocksReturn).toBeGreaterThan(0);
      expect(result.returnsApplied.bondsReturn).toBeCloseTo(0, 1); // Should be close to 0 for 0% allocation
      expect(result.returnsApplied.totalReturn).toBeCloseTo(result.returnsApplied.stocksReturn, 2);
      expect(result.finalBalance).toBeGreaterThan(10000); // Should grow
      expect(result.methodology).toBe('historical-returns');
    });

    it('should calculate weighted returns for mixed allocation', async () => {
      const startDate = '2023-01-01';
      const endDate = '2023-12-31';

      const result = await service.calculateCatchUp(
        startDate,
        endDate,
        0.6, // 60% stocks
        0.4, // 40% bonds
        10000
      );

      // Verify returns are reasonable and properly weighted
      expect(result.returnsApplied.stocksReturn).toBeGreaterThan(0);
      expect(result.returnsApplied.bondsReturn).toBeGreaterThan(0);
      expect(result.returnsApplied.totalReturn).toBeGreaterThan(0);
      expect(result.finalBalance).toBeGreaterThan(10000);

      // Total return should be between stocks and bonds return (weighted average)
      expect(result.returnsApplied.totalReturn).toBeGreaterThan(Math.min(result.returnsApplied.stocksReturn * 0.6, result.returnsApplied.bondsReturn * 0.4));
    });

    it('should use fallback returns for unknown years', async () => {
      const startDate = '2030-01-01'; // Future year not in historical data
      const endDate = '2030-06-30';

      const result = await service.calculateCatchUp(
        startDate,
        endDate,
        1.0, // 100% stocks
        0.0, // 0% bonds
        10000
      );

      // Should use fallback 10% annual return for stocks
      const expectedHalfYearReturn = 0.10 * 0.5;
      expect(result.returnsApplied.stocksReturn).toBeCloseTo(expectedHalfYearReturn, 2);
    });

    it('should handle multi-year calculations', async () => {
      const startDate = '2022-01-01';
      const endDate = '2023-12-31'; // Two full years

      const result = await service.calculateCatchUp(
        startDate,
        endDate,
        1.0, // 100% stocks for simplicity
        0.0, // 0% bonds
        10000
      );

      // Should compound returns over multiple years
      expect(result.returnsApplied.stocksReturn).not.toBe(0);
      expect(result.returnsApplied.bondsReturn).not.toBe(0); // Bonds return is actual historical, not weighted
      expect(result.finalBalance).not.toBe(10000); // Should be different from initial
      expect(result.methodology).toBe('historical-returns');
    });

    it('should set metadata correctly', async () => {
      const startDate = '2023-01-01';
      const endDate = '2023-06-30';
      const targetDate = '2024-09-14';

      const result = await service.calculateCatchUp(
        startDate,
        targetDate,
        0.7,
        0.3,
        10000
      );

      expect(result.snapshotId).toBe(''); // Should be empty (set by caller)
      expect(result.targetDate).toBe(targetDate);
      expect(result.methodology).toBe('historical-returns');
      expect(result.calculatedAt).toBeDefined();
      expect(new Date(result.calculatedAt)).toBeInstanceOf(Date);
    });

    it('should handle edge case of same start and end date', async () => {
      const date = '2023-06-15';

      const result = await service.calculateCatchUp(
        date,
        date,
        0.7,
        0.3,
        10000
      );

      expect(result.finalBalance).toBe(10000);
      expect(result.returnsApplied.totalReturn).toBe(0);
    });

    it('should handle bonds-only allocation', async () => {
      const startDate = '2023-01-01';
      const endDate = '2023-12-31';

      const result = await service.calculateCatchUp(
        startDate,
        endDate,
        0.0, // 0% stocks
        1.0, // 100% bonds
        10000
      );

      // Returns show actual historical data, but final balance uses allocation weighting
      expect(result.returnsApplied.stocksReturn).not.toBe(0); // Shows actual historical stock return
      expect(result.returnsApplied.bondsReturn).toBeGreaterThan(0);
      expect(result.returnsApplied.totalReturn).toBeCloseTo(result.returnsApplied.bondsReturn, 2); // Should equal bonds return for 100% bonds
    });

    it('should validate that final balance is reasonable', async () => {
      const startDate = '2020-01-01';
      const endDate = '2023-12-31';

      const result = await service.calculateCatchUp(
        startDate,
        endDate,
        0.7,
        0.3,
        10000
      );

      // Final balance should be positive and greater than initial
      expect(result.finalBalance).toBeGreaterThan(0);
      expect(result.finalBalance).toBeGreaterThan(10000); // Assuming positive long-term returns
    });
  });

  describe('historical data integrity', () => {
    it('should have valid stock return data', () => {
      expect(HISTORICAL_ANNUAL_RETURNS.stocks).toBeDefined();
      expect(HISTORICAL_ANNUAL_RETURNS.stocks.length).toBeGreaterThan(0);

      HISTORICAL_ANNUAL_RETURNS.stocks.forEach(data => {
        expect(data.year).toBeGreaterThan(2000);
        expect(typeof data.return).toBe('number');
        expect(data.return).toBeGreaterThan(-1); // No 100% losses
        expect(data.return).toBeLessThan(5); // No 500% gains (sanity check)
      });
    });

    it('should have valid bond return data', () => {
      expect(HISTORICAL_ANNUAL_RETURNS.bonds).toBeDefined();
      expect(HISTORICAL_ANNUAL_RETURNS.bonds.length).toBeGreaterThan(0);

      HISTORICAL_ANNUAL_RETURNS.bonds.forEach(data => {
        expect(data.year).toBeGreaterThan(2000);
        expect(typeof data.return).toBe('number');
        expect(data.return).toBeGreaterThan(-1); // No 100% losses
        expect(data.return).toBeLessThan(1); // No 100% gains for bonds
      });
    });

    it('should have matching years for stocks and bonds', () => {
      const stockYears = HISTORICAL_ANNUAL_RETURNS.stocks.map(d => d.year).sort();
      const bondYears = HISTORICAL_ANNUAL_RETURNS.bonds.map(d => d.year).sort();

      expect(stockYears).toEqual(bondYears);
    });
  });
});