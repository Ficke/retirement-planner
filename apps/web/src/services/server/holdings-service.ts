/**
 * HoldingsService - Smart caching for holdings-based single source of truth
 *
 * Implements the optimal strategy for holdings calculation:
 * 1. Use recent cached snapshots when available
 * 2. Calculate incrementally from latest snapshot + new transactions
 * 3. Fall back to full calculation from all transactions when needed
 * 4. Pre-calculate monthly snapshots for efficiency
 */

import type {
  AccountTransaction,
  HoldingsSnapshot,
  CreateHoldingsSnapshotData,
  SecurityHolding,
} from '@/domain/types';
import { getUnifiedDatabaseService } from './database';
import { getMarketDataService, type MarketDataService } from './market-data';

interface HoldingCalculation {
  symbol: string;
  shares: number;
  averageCostBasis: number;
  lastTransactionId?: string;
}

interface CacheStrategy {
  useCache: boolean;
  latestSnapshot?: HoldingsSnapshot;
  missingTransactions: AccountTransaction[];
  calculationMethod: 'full_calc' | 'incremental';
}

export class HoldingsService {
  private database = getUnifiedDatabaseService();
  private marketData?: MarketDataService;

  private getMarketData(): MarketDataService {
    if (!this.marketData) {
      this.marketData = getMarketDataService();
    }
    return this.marketData;
  }

  /**
   * Get current holdings for an account, using optimal caching strategy
   */
  async getCurrentHoldings(accountId: string, asOfDate: string = new Date().toISOString().split('T')[0]): Promise<SecurityHolding[]> {
    // Determine optimal calculation strategy
    const strategy = await this.determineCacheStrategy(accountId, asOfDate);

    let holdings: Map<string, HoldingCalculation>;

    if (strategy.useCache && strategy.latestSnapshot) {
      // Incremental calculation from latest snapshot
      holdings = await this.calculateIncrementalHoldings(
        strategy.latestSnapshot,
        strategy.missingTransactions,
        asOfDate
      );
    } else {
      // Full calculation from all transactions
      holdings = await this.calculateFullHoldings(accountId, asOfDate);
    }

    // Convert to SecurityHolding with current market values
    return this.enrichWithMarketData(Array.from(holdings.values()), asOfDate);
  }

  /**
   * Create a holdings snapshot for caching
   */
  async createSnapshot(accountId: string, asOfDate: string): Promise<HoldingsSnapshot[]> {
    const holdings = await this.calculateFullHoldings(accountId, asOfDate);
    const snapshots: HoldingsSnapshot[] = [];

    for (const [symbol, holding] of holdings) {
      const data: CreateHoldingsSnapshotData = {
        accountId,
        symbol,
        shares: holding.shares,
        averageCostBasis: holding.averageCostBasis,
        asOfDate,
        lastTransactionId: holding.lastTransactionId,
        calculationMethod: 'full_calc',
      };

      const snapshot = await this.database.createHoldingsSnapshot(data);
      snapshots.push(snapshot);
    }

    return snapshots;
  }

  /**
   * Invalidate cache for an account when new transactions are added
   */
  async invalidateCache(accountId: string, fromDate?: string): Promise<void> {
    // Delete snapshots from the invalidation date forward
    if (fromDate) {
      // More granular invalidation would require a WHERE clause with date comparison
      // For now, we'll delete all snapshots for the account to be safe
      await this.database.deleteHoldingsSnapshots(accountId);
    } else {
      await this.database.deleteHoldingsSnapshots(accountId);
    }
  }

  /**
   * Pre-calculate monthly snapshots for performance
   * This can be run as a background job
   */
  async preCalculateMonthlySnapshots(accountId: string): Promise<void> {
    const transactions = await this.database.getAccountTransactions(accountId);
    if (transactions.length === 0) return;

    // Find date range
    const dates = transactions.map(t => new Date(t.transactionDate)).sort();
    const startDate = dates[0];
    const endDate = new Date(); // Today

    // Generate monthly snapshot dates
    const snapshotDates = this.generateMonthlyDates(startDate, endDate);

    for (const date of snapshotDates) {
      const dateString = date.toISOString().split('T')[0];

      // Check if snapshot already exists
      const existing = await this.database.getHoldingsSnapshots(accountId, dateString);
      if (existing.length > 0) continue;

      // Create snapshot
      await this.createSnapshot(accountId, dateString);
    }
  }

  /**
   * Determine the optimal calculation strategy
   */
  private async determineCacheStrategy(accountId: string, asOfDate: string): Promise<CacheStrategy> {
    // Get latest snapshots before the target date
    const latestSnapshots = await this.database.getLatestHoldingsSnapshots(accountId, asOfDate);

    if (latestSnapshots.length === 0) {
      // No cache available, full calculation required
      const allTransactions = await this.database.getAccountTransactions(accountId);
      return {
        useCache: false,
        missingTransactions: allTransactions,
        calculationMethod: 'full_calc',
      };
    }

    // Find the latest snapshot date
    const latestSnapshotDate = latestSnapshots.reduce((latest, snapshot) => {
      return snapshot.asOfDate > latest ? snapshot.asOfDate : latest;
    }, latestSnapshots[0].asOfDate);

    // Get transactions since the latest snapshot
    const recentTransactions = await this.getTransactionsSince(accountId, latestSnapshotDate);

    // Decide whether to use cache based on number of recent transactions
    const transactionThreshold = 50; // Arbitrary threshold - tune based on performance
    const useCache = recentTransactions.length < transactionThreshold;

    if (useCache) {
      return {
        useCache: true,
        latestSnapshot: latestSnapshots[0], // Use the first one as representative
        missingTransactions: recentTransactions,
        calculationMethod: 'incremental',
      };
    } else {
      // Too many transactions to calculate incrementally, do full calc
      const allTransactions = await this.database.getAccountTransactions(accountId);
      return {
        useCache: false,
        missingTransactions: allTransactions,
        calculationMethod: 'full_calc',
      };
    }
  }

  /**
   * Calculate holdings incrementally from a snapshot
   */
  private async calculateIncrementalHoldings(
    baseSnapshot: HoldingsSnapshot,
    newTransactions: AccountTransaction[],
    asOfDate: string
  ): Promise<Map<string, HoldingCalculation>> {
    // Start with snapshot data for the symbol
    const holdings = new Map<string, HoldingCalculation>();

    // Get all snapshots for the base date to initialize holdings
    const accountId = baseSnapshot.accountId;
    const baseDate = baseSnapshot.asOfDate;
    const allBaseSnapshots = await this.database.getHoldingsSnapshots(accountId, baseDate);

    // Initialize holdings from snapshots
    for (const snapshot of allBaseSnapshots) {
      holdings.set(snapshot.symbol, {
        symbol: snapshot.symbol,
        shares: snapshot.shares,
        averageCostBasis: snapshot.averageCostBasis,
        lastTransactionId: snapshot.lastTransactionId,
      });
    }

    // Apply new transactions
    const asOfDateObj = new Date(asOfDate + 'T23:59:59'); // End of day to include same-day transactions
    const relevantTransactions = newTransactions
      .filter(t => new Date(t.transactionDate) <= asOfDateObj)
      .sort((a, b) => new Date(a.transactionDate).getTime() - new Date(b.transactionDate).getTime());

    for (const transaction of relevantTransactions) {
      this.applyTransaction(holdings, transaction);
    }

    return holdings;
  }

  /**
   * Calculate holdings from all transactions (full calculation)
   */
  private async calculateFullHoldings(accountId: string, asOfDate: string): Promise<Map<string, HoldingCalculation>> {
    const transactions = await this.database.getAccountTransactions(accountId);
    const holdings = new Map<string, HoldingCalculation>();

    // Filter and sort transactions
    const asOfDateObj = new Date(asOfDate + 'T23:59:59'); // End of day to include same-day transactions
    const relevantTransactions = transactions
      .filter(t => new Date(t.transactionDate) <= asOfDateObj)
      .sort((a, b) => new Date(a.transactionDate).getTime() - new Date(b.transactionDate).getTime());

    // Apply each transaction
    for (const transaction of relevantTransactions) {
      this.applyTransaction(holdings, transaction);
    }

    return holdings;
  }

  /**
   * Apply a single transaction to holdings
   */
  private applyTransaction(holdings: Map<string, HoldingCalculation>, transaction: AccountTransaction): void {
    const existing = holdings.get(transaction.symbol) || {
      symbol: transaction.symbol,
      shares: 0,
      averageCostBasis: 0,
    };

    switch (transaction.transactionType) {
      case 'BUY':
      case 'DIVIDEND_REINVEST':
        const totalCost = existing.shares * existing.averageCostBasis +
                         transaction.shares * (transaction.pricePerShare || 0);
        const totalShares = existing.shares + transaction.shares;

        holdings.set(transaction.symbol, {
          symbol: transaction.symbol,
          shares: totalShares,
          averageCostBasis: totalShares > 0 ? totalCost / totalShares : 0,
          lastTransactionId: transaction.id,
        });
        break;

      case 'SELL':
        holdings.set(transaction.symbol, {
          symbol: transaction.symbol,
          shares: existing.shares - transaction.shares,
          averageCostBasis: existing.averageCostBasis, // Cost basis remains the same for remaining shares
          lastTransactionId: transaction.id,
        });
        break;

      case 'SPLIT':
        // For splits, shares multiply but cost basis adjusts proportionally
        const splitRatio = transaction.shares; // Assuming shares field contains split ratio
        holdings.set(transaction.symbol, {
          symbol: transaction.symbol,
          shares: existing.shares * splitRatio,
          averageCostBasis: existing.averageCostBasis / splitRatio,
          lastTransactionId: transaction.id,
        });
        break;
    }

    // Remove holdings with zero shares
    if (holdings.get(transaction.symbol)?.shares === 0) {
      holdings.delete(transaction.symbol);
    }
  }

  /**
   * Enrich holdings with current market data
   */
  private async enrichWithMarketData(holdings: HoldingCalculation[], asOfDate: string): Promise<SecurityHolding[]> {
    const enriched: SecurityHolding[] = [];

    for (const holding of holdings) {
      if (holding.shares <= 0) continue;

      try {
        // Get current price for the symbol
        const price = await this.getMarketData().getPriceAtDate(holding.symbol, new Date(asOfDate));

        // TODO: Get security details from securities service
        const security = {
          symbol: holding.symbol,
          name: holding.symbol, // Placeholder
          type: 'ETF' as const,
          assetClass: 'STOCK' as const,
          riskMultiplier: 1.0,
          underlyingAllocations: { stocks: 1.0, bonds: 0.0 },
        };

        enriched.push({
          accountId: '', // Will be set by caller
          symbol: holding.symbol,
          totalShares: holding.shares,
          averageCostBasis: holding.averageCostBasis,
          currentValue: holding.shares * price,
          currentPrice: price,
          asOfDate,
          security,
        });
      } catch (error) {
        console.warn(`Failed to get price for ${holding.symbol}:`, error);
        // Skip this holding if we can't get price data
      }
    }

    return enriched;
  }

  /**
   * Get transactions since a specific date
   */
  private async getTransactionsSince(accountId: string, sinceDate: string): Promise<AccountTransaction[]> {
    const allTransactions = await this.database.getAccountTransactions(accountId);
    return allTransactions.filter(t => t.transactionDate > sinceDate);
  }

  /**
   * Generate monthly snapshot dates between start and end
   */
  private generateMonthlyDates(startDate: Date, endDate: Date): Date[] {
    const dates: Date[] = [];
    const current = new Date(startDate.getFullYear(), startDate.getMonth(), 1); // First of month

    while (current <= endDate) {
      dates.push(new Date(current));
      current.setMonth(current.getMonth() + 1);
    }

    return dates;
  }
}

// Singleton instance
let holdingsService: HoldingsService | null = null;

export function getHoldingsService(): HoldingsService {
  if (!holdingsService) {
    holdingsService = new HoldingsService();
  }
  return holdingsService;
}