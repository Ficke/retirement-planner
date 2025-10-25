/**
 * Cache Invalidation System for Holdings-Based Architecture
 *
 * Handles automatic cache invalidation when transactions change,
 * ensuring holdings cache remains consistent and performant.
 */

import type { AccountTransaction, HoldingsSnapshot } from '@/domain/types';
import { getHoldingsService } from './holdings-service';
import { getUnifiedDatabaseService } from './database';

interface InvalidationRule {
  accountId: string;
  fromDate?: string;
  reason: 'transaction_added' | 'transaction_updated' | 'transaction_deleted' | 'manual';
}

interface InvalidationEvent {
  rule: InvalidationRule;
  timestamp: string;
  affectedSnapshots: number;
}

export class CacheInvalidationService {
  private database = getUnifiedDatabaseService();
  private holdingsService = getHoldingsService();
  private invalidationLog: InvalidationEvent[] = [];

  /**
   * Invalidate cache when a new transaction is added
   */
  async onTransactionAdded(transaction: AccountTransaction): Promise<void> {
    const rule: InvalidationRule = {
      accountId: transaction.accountId,
      fromDate: transaction.transactionDate,
      reason: 'transaction_added',
    };

    await this.invalidateCache(rule);
  }

  /**
   * Invalidate cache when a transaction is updated
   */
  async onTransactionUpdated(
    oldTransaction: AccountTransaction,
    newTransaction: AccountTransaction
  ): Promise<void> {
    // Invalidate from the earliest date affected
    const earliestDate = oldTransaction.transactionDate < newTransaction.transactionDate
      ? oldTransaction.transactionDate
      : newTransaction.transactionDate;

    const rule: InvalidationRule = {
      accountId: newTransaction.accountId,
      fromDate: earliestDate,
      reason: 'transaction_updated',
    };

    await this.invalidateCache(rule);
  }

  /**
   * Invalidate cache when a transaction is deleted
   */
  async onTransactionDeleted(transaction: AccountTransaction): Promise<void> {
    const rule: InvalidationRule = {
      accountId: transaction.accountId,
      fromDate: transaction.transactionDate,
      reason: 'transaction_deleted',
    };

    await this.invalidateCache(rule);
  }

  /**
   * Manual cache invalidation for specific account
   */
  async invalidateAccount(accountId: string, fromDate?: string): Promise<void> {
    const rule: InvalidationRule = {
      accountId,
      fromDate,
      reason: 'manual',
    };

    await this.invalidateCache(rule);
  }

  /**
   * Smart cache refresh strategy
   *
   * Instead of just deleting cache, we can be smarter:
   * 1. For recent changes, recalculate and update cache
   * 2. For older changes, invalidate and let lazy loading handle it
   */
  async smartRefresh(accountId: string, changedTransactionDate: string): Promise<void> {
    const changeDate = new Date(changedTransactionDate);
    const now = new Date();
    const daysSinceChange = (now.getTime() - changeDate.getTime()) / (1000 * 60 * 60 * 24);

    // If the change is recent (within 30 days), proactively recalculate
    if (daysSinceChange <= 30) {
      await this.proactiveRecalculation(accountId, changedTransactionDate);
    } else {
      // For older changes, just invalidate and let lazy loading handle it
      await this.invalidateAccount(accountId, changedTransactionDate);
    }
  }

  /**
   * Proactively recalculate cache for recent changes
   */
  private async proactiveRecalculation(accountId: string, fromDate: string): Promise<void> {
    try {
      // First, invalidate the existing cache
      await this.invalidateAccount(accountId, fromDate);

      // Then, proactively recalculate key dates
      const today = new Date().toISOString().split('T')[0];
      const endOfLastMonth = new Date();
      endOfLastMonth.setDate(0); // Last day of previous month
      const lastMonthEnd = endOfLastMonth.toISOString().split('T')[0];

      // Recalculate current holdings (this will cache them)
      await this.holdingsService.getCurrentHoldings(accountId, today);

      // Recalculate end-of-month holdings if different from today
      if (lastMonthEnd !== today) {
        await this.holdingsService.getCurrentHoldings(accountId, lastMonthEnd);
      }
    } catch (error) {
      console.error('Failed proactive recalculation for account', accountId, error);
      // Fallback to simple invalidation
      await this.invalidateAccount(accountId, fromDate);
    }
  }

  /**
   * Execute cache invalidation based on rule
   */
  private async invalidateCache(rule: InvalidationRule): Promise<void> {
    try {
      // Count affected snapshots before deletion (for logging)
      const existingSnapshots = await this.database.getHoldingsSnapshots(rule.accountId);
      const affectedSnapshots = rule.fromDate
        ? existingSnapshots.filter(s => s.asOfDate >= rule.fromDate!).length
        : existingSnapshots.length;

      // Perform the invalidation
      await this.holdingsService.invalidateCache(rule.accountId, rule.fromDate);

      // Log the invalidation event
      const event: InvalidationEvent = {
        rule,
        timestamp: new Date().toISOString(),
        affectedSnapshots,
      };

      this.invalidationLog.push(event);

      // Keep log size manageable (last 1000 events)
      if (this.invalidationLog.length > 1000) {
        this.invalidationLog = this.invalidationLog.slice(-1000);
      }

      console.log(`Cache invalidated for account ${rule.accountId}`, {
        reason: rule.reason,
        fromDate: rule.fromDate,
        affectedSnapshots,
      });
    } catch (error) {
      console.error('Failed to invalidate cache:', error);
      throw error;
    }
  }

  /**
   * Get recent invalidation events for debugging
   */
  getInvalidationLog(limit: number = 50): InvalidationEvent[] {
    return this.invalidationLog.slice(-limit);
  }

  /**
   * Batch invalidation for multiple accounts
   * Useful for system-wide cache refreshes
   */
  async batchInvalidate(accountIds: string[], reason: string = 'manual'): Promise<void> {
    const promises = accountIds.map(accountId =>
      this.invalidateAccount(accountId).catch(error => {
        console.error(`Failed to invalidate cache for account ${accountId}:`, error);
        return null; // Continue with other accounts even if one fails
      })
    );

    await Promise.allSettled(promises);

    console.log(`Batch invalidation completed for ${accountIds.length} accounts`);
  }

  /**
   * Scheduled cache maintenance
   * Can be run as a cron job to clean up old snapshots and optimize cache
   */
  async scheduledMaintenance(): Promise<void> {
    try {
      // Get all accounts with snapshots
      const accounts = await this.database.getAccounts();

      for (const account of accounts) {
        // Pre-calculate monthly snapshots for performance
        await this.holdingsService.preCalculateMonthlySnapshots(account.id);

        // Clean up very old daily snapshots (keep only monthly after 6 months)
        await this.cleanupOldSnapshots(account.id);
      }

      console.log('Scheduled cache maintenance completed');
    } catch (error) {
      console.error('Scheduled maintenance failed:', error);
    }
  }

  /**
   * Clean up old snapshots to manage storage
   * Keep daily snapshots for recent months, monthly for older data
   */
  private async cleanupOldSnapshots(accountId: string): Promise<void> {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const cutoffDate = sixMonthsAgo.toISOString().split('T')[0];

    // Get all old snapshots
    const allSnapshots = await this.database.getHoldingsSnapshots(accountId);
    const oldSnapshots = allSnapshots.filter(s => s.asOfDate < cutoffDate);

    // Group by symbol and month
    const monthlyGroups = new Map<string, HoldingsSnapshot[]>();

    for (const snapshot of oldSnapshots) {
      const monthKey = `${snapshot.symbol}-${snapshot.asOfDate.substring(0, 7)}`; // YYYY-MM
      if (!monthlyGroups.has(monthKey)) {
        monthlyGroups.set(monthKey, []);
      }
      monthlyGroups.get(monthKey)!.push(snapshot);
    }

    // For each month/symbol group, keep only the latest snapshot
    for (const [monthKey, snapshots] of monthlyGroups) {
      if (snapshots.length <= 1) continue; // Nothing to clean up

      // Sort by date and keep the latest
      const sorted = snapshots.sort((a, b) => b.asOfDate.localeCompare(a.asOfDate));
      const toDelete = sorted.slice(1); // Delete all except the first (latest)

      // Delete old snapshots
      for (const snapshot of toDelete) {
        try {
          await this.database.deleteHoldingsSnapshots(accountId, snapshot.symbol);
        } catch (error) {
          console.error(`Failed to delete old snapshot ${snapshot.id}:`, error);
        }
      }
    }
  }
}

// Singleton instance
let cacheInvalidationService: CacheInvalidationService | null = null;

export function getCacheInvalidationService(): CacheInvalidationService {
  if (!cacheInvalidationService) {
    cacheInvalidationService = new CacheInvalidationService();
  }
  return cacheInvalidationService;
}

/**
 * Convenience wrapper for common invalidation scenarios
 */
export class TransactionCacheManager {
  private invalidationService = getCacheInvalidationService();

  /**
   * Handle cache invalidation for transaction mutations
   * Use this in API routes when transactions are modified
   */
  async handleTransactionMutation(
    operation: 'create' | 'update' | 'delete',
    transaction: AccountTransaction,
    oldTransaction?: AccountTransaction
  ): Promise<void> {
    switch (operation) {
      case 'create':
        await this.invalidationService.onTransactionAdded(transaction);
        break;
      case 'update':
        if (!oldTransaction) {
          throw new Error('oldTransaction required for update operation');
        }
        await this.invalidationService.onTransactionUpdated(oldTransaction, transaction);
        break;
      case 'delete':
        await this.invalidationService.onTransactionDeleted(transaction);
        break;
    }
  }

  /**
   * Smart refresh after bulk transaction operations
   */
  async handleBulkTransactionMutation(accountId: string): Promise<void> {
    // For bulk operations, it's often better to just invalidate everything
    // and let the system recalculate on demand
    await this.invalidationService.invalidateAccount(accountId);
  }
}

export const transactionCacheManager = new TransactionCacheManager();