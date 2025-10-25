import type { Account, AssetWeights } from '@/domain/types';

/**
 * Calculate aggregate portfolio allocation across all accounts.
 * Weights each account's allocation by its balance.
 */
export function calculateAggregateAllocation(accounts: Account[]): AssetWeights {
  const totalBalance = accounts.reduce((sum, account) => sum + account.balance, 0);
  
  if (totalBalance === 0) {
    return { stocks: 0.6, bonds: 0.4 }; // Default moderate allocation
  }
  
  let totalStocks = 0;
  let totalBonds = 0;
  
  for (const account of accounts) {
    const weight = account.balance / totalBalance;
    totalStocks += account.assetWeights.stocks * weight;
    totalBonds += account.assetWeights.bonds * weight;
  }
  
  return {
    stocks: totalStocks,
    bonds: totalBonds,
  };
}

/**
 * Get account balances by type for withdrawal ordering.
 */
export function getAccountBalancesByType(accounts: Account[]): Record<string, number> {
  const balances: Record<string, number> = {
    Taxable: 0,
    Traditional: 0,
    Roth: 0,
    HSA: 0,
  };
  
  for (const account of accounts) {
    balances[account.type] += account.balance;
  }
  
  return balances;
}