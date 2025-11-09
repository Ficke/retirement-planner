/**
 * Account aggregation service that transforms accounts with holdings
 * into unified Account objects for projection engine usage.
 *
 * Unified architecture: Account objects include computed portfolio properties.
 */

import type {
  Account,
} from '@/domain/types';
import { getHoldingsClient } from './client/holdings-client';
import { getAccountsClient } from './client/accounts-client';
import { getSecurity, calculateEffectiveAllocation } from '@/data/securities-master';

export interface AccountAggregationService {
  // Primary method: unified accounts with computed properties from holdings
  aggregateAccountsFromHoldings(targetDate?: string): Promise<Account[]>;
  validateAggregation(accounts: Account[]): { isValid: boolean; errors: string[] };
}

class AccountAggregationServiceImpl implements AccountAggregationService {
  validateAggregation(accounts: Account[]): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const account of accounts) {
      // Check asset weights sum to 1
      const weightSum = account.assetWeights.stocks + account.assetWeights.bonds;
      if (Math.abs(weightSum - 1) > 0.001) {
        errors.push(`Account ${account.name}: Asset weights sum to ${weightSum.toFixed(3)}, expected 1.000`);
      }

      // Check for negative balances
      if (account.balance < 0) {
        errors.push(`Account ${account.name}: Balance cannot be negative (${account.balance})`);
      }

      // Check for valid asset weights
      if (account.assetWeights.stocks < 0 || account.assetWeights.stocks > 1) {
        errors.push(`Account ${account.name}: Stocks weight must be between 0 and 1 (${account.assetWeights.stocks})`);
      }

      if (account.assetWeights.bonds < 0 || account.assetWeights.bonds > 1) {
        errors.push(`Account ${account.name}: Bonds weight must be between 0 and 1 (${account.assetWeights.bonds})`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Transform accounts with holdings into unified Account objects.
   * Computes portfolio value and asset allocation from actual securities holdings.
   * Handles leveraged funds properly by using underlyingAllocations for risk calculation.
   */
  async aggregateAccountsFromHoldings(targetDate?: string): Promise<Account[]> {
    // Use the unified accounts table directly - accounts already have 'type' field
    const accountsClient = getAccountsClient();
    const accounts = await accountsClient.getAccounts();

    const holdingsClient = getHoldingsClient();
    const unifiedAccounts: Account[] = [];

    for (const account of accounts) {
      // Get current holdings for this account using the holdings client
      let holdings: any[] = [];
      try {
        const holdingsResponse = await holdingsClient.getHoldings(account.id, targetDate);
        holdings = holdingsResponse.holdings;
      } catch (error) {
        console.warn(`Failed to get holdings for account ${account.id}:`, error);
        holdings = [];
      }

      if (holdings.length === 0) {
        // Account with no holdings - use the account as-is with balance from DB
        // The account already has balance and assetWeights from mapRowToAccount
        if (account && account.id) {
          // Ensure the account has required properties
          const safeAccount = {
            ...account,
            balance: account.balance || 0,
            assetWeights: account.assetWeights || { stocks: 0.6, bonds: 0.4 },
            taxable: account.type === 'Taxable'
          };
          unifiedAccounts.push(safeAccount);
        } else {
          console.warn('Skipping invalid account:', account);
        }
        continue;
      }

      // Calculate total portfolio value and risk exposures
      let totalValue = 0;
      let totalStockExposure = 0;
      let totalBondExposure = 0;

      for (const holding of holdings) {
        const security = getSecurity(holding.symbol);

        if (security) {
          // Use actual holding value and security's underlying allocations
          const exposure = calculateEffectiveAllocation(security, holding.currentValue);
          totalStockExposure += exposure.stocks || 0;
          totalBondExposure += exposure.bonds || 0;

          // Account value is the actual dollar amount invested
          totalValue += holding.currentValue;
        } else {
          // Unknown security - treat as 100% stocks for conservative risk estimate
          console.warn(`Unknown security ${holding.symbol}, treating as 100% stocks`);
          totalStockExposure += holding.currentValue;
          totalValue += holding.currentValue;
        }
      }

      // Calculate effective allocation (normalize risk exposures to sum to 1.0)
      const totalRiskExposure = totalStockExposure + totalBondExposure;
      let effectiveStocksWeight = 0.6; // Default moderate allocation
      let effectiveBondsWeight = 0.4;

      if (totalRiskExposure > 0) {
        effectiveStocksWeight = totalStockExposure / totalRiskExposure;
        effectiveBondsWeight = totalBondExposure / totalRiskExposure;
      }

      // Validate required fields before creating account
      if (!account.type) {
        throw new Error(`Account ${account.id} (${account.name}) is missing type field. Cannot aggregate for simulation.`);
      }

      // Create unified account with computed properties from holdings
      const unifiedAccount: Account = {
        ...account, // Start with the account from DB (has id, name, institution, type, createdAt, updatedAt)
        balance: totalValue, // Override with actual portfolio value from holdings
        assetWeights: {
          stocks: effectiveStocksWeight, // Override with computed allocation from securities
          bonds: effectiveBondsWeight,
        },
        taxable: account.type === 'Taxable',
      };

      unifiedAccounts.push(unifiedAccount);
    }

    console.log('📊 Aggregated accounts for simulation:', unifiedAccounts.map(a => ({
      name: a.name,
      balance: a.balance,
      stocks: a.assetWeights.stocks,
      bonds: a.assetWeights.bonds,
      type: a.type
    })));

    return unifiedAccounts;
  }
}

// Utility functions
export async function hasSnapshotData(): Promise<boolean> {
  // Snapshots have been deprecated - always return false
  return false;
}

// Service factory
let accountAggregationService: AccountAggregationService | null = null;

export function getAccountAggregationService(): AccountAggregationService {
  if (!accountAggregationService) {
    accountAggregationService = new AccountAggregationServiceImpl();
  }
  return accountAggregationService;
}

export function setAccountAggregationService(service: AccountAggregationService): void {
  accountAggregationService = service;
}

export function resetAccountAggregationService(): void {
  accountAggregationService = null;
}
