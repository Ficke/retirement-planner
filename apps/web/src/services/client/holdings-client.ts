/**
 * Holdings Client Service - Browser-safe HTTP client for holdings-based API
 *
 * Provides client-side access to holdings and transactions APIs
 * with automatic cache invalidation integration.
 */

import type {
  SecurityHolding,
  AccountTransaction,
  TransactionType,
} from '@/domain/types';
import { authenticatedFetch } from '@/lib/firebase/api-client';

interface HoldingsResponse {
  accountId: string;
  asOfDate: string;
  holdings: SecurityHolding[];
  calculationMethod: 'cached' | 'calculated';
}

interface TransactionsResponse {
  accountId: string;
  filters: {
    symbol?: string;
    fromDate?: string;
    toDate?: string;
  };
  transactions: AccountTransaction[];
  count: number;
}

interface CreateTransactionData {
  symbol: string;
  shares: number;
  transactionDate: string;
  transactionType: TransactionType;
  pricePerShare?: number;
  description?: string;
}

interface UpdateTransactionData {
  symbol?: string;
  shares?: number;
  transactionDate?: string;
  transactionType?: TransactionType;
  pricePerShare?: number;
  description?: string;
}

export class HoldingsClient {
  private baseUrl: string;

  constructor(baseUrl: string = '/api') {
    this.baseUrl = baseUrl;
  }

  /**
   * Get current holdings for an account
   */
  async getHoldings(accountId: string, asOfDate?: string): Promise<HoldingsResponse> {
    const params = new URLSearchParams();
    if (asOfDate) {
      params.set('asOfDate', asOfDate);
    }

    const url = `${this.baseUrl}/accounts/${accountId}/holdings${params.toString() ? `?${params}` : ''}`;
    const response = await authenticatedFetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch holdings: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Create a holdings snapshot for caching
   */
  async createSnapshot(accountId: string, asOfDate: string): Promise<{ snapshots: number; message: string }> {
    const response = await authenticatedFetch(`${this.baseUrl}/accounts/${accountId}/holdings/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asOfDate }),
    });

    if (!response.ok) {
      throw new Error(`Failed to create snapshot: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Invalidate holdings cache
   */
  async invalidateCache(accountId: string, fromDate?: string): Promise<{ message: string }> {
    const params = new URLSearchParams();
    if (fromDate) {
      params.set('fromDate', fromDate);
    }

    const url = `${this.baseUrl}/accounts/${accountId}/holdings/cache${params.toString() ? `?${params}` : ''}`;
    const response = await authenticatedFetch(url, { method: 'DELETE' });

    if (!response.ok) {
      throw new Error(`Failed to invalidate cache: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get transactions for an account
   */
  async getTransactions(
    accountId: string,
    filters?: {
      symbol?: string;
      fromDate?: string;
      toDate?: string;
    }
  ): Promise<TransactionsResponse> {
    const params = new URLSearchParams();
    if (filters?.symbol) params.set('symbol', filters.symbol);
    if (filters?.fromDate) params.set('fromDate', filters.fromDate);
    if (filters?.toDate) params.set('toDate', filters.toDate);

    const url = `${this.baseUrl}/accounts/${accountId}/transactions${params.toString() ? `?${params}` : ''}`;
    const response = await authenticatedFetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch transactions: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Create a new transaction
   */
  async createTransaction(accountId: string, data: CreateTransactionData): Promise<AccountTransaction> {
    const response = await authenticatedFetch(`${this.baseUrl}/accounts/${accountId}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(`Failed to create transaction: ${error.error || response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get a specific transaction
   */
  async getTransaction(accountId: string, transactionId: string): Promise<AccountTransaction> {
    const response = await authenticatedFetch(`${this.baseUrl}/accounts/${accountId}/transactions/${transactionId}`);

    if (!response.ok) {
      throw new Error(`Failed to fetch transaction: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Update a transaction
   */
  async updateTransaction(
    accountId: string,
    transactionId: string,
    updates: UpdateTransactionData
  ): Promise<AccountTransaction> {
    const response = await authenticatedFetch(`${this.baseUrl}/accounts/${accountId}/transactions/${transactionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(`Failed to update transaction: ${error.error || response.statusText}`);
    }

    return response.json();
  }

  /**
   * Delete a transaction
   */
  async deleteTransaction(accountId: string, transactionId: string): Promise<{ message: string }> {
    const response = await authenticatedFetch(`${this.baseUrl}/accounts/${accountId}/transactions/${transactionId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error(`Failed to delete transaction: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Bulk transaction operations
   */
  async createMultipleTransactions(
    accountId: string,
    transactions: CreateTransactionData[]
  ): Promise<AccountTransaction[]> {
    const results: AccountTransaction[] = [];
    const errors: string[] = [];

    // Process transactions sequentially to maintain cache consistency
    for (let i = 0; i < transactions.length; i++) {
      try {
        const result = await this.createTransaction(accountId, transactions[i]);
        results.push(result);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : `Transaction ${i + 1} failed`;
        errors.push(errorMessage);
        console.error(`Failed to create transaction ${i + 1}:`, error);
      }
    }

    if (errors.length > 0) {
      console.warn(`${errors.length} out of ${transactions.length} transactions failed:`, errors);
    }

    return results;
  }

  /**
   * Get account value at a specific date
   * This is a convenience method that gets holdings and calculates total value
   */
  async getAccountValue(accountId: string, asOfDate?: string): Promise<{
    accountId: string;
    asOfDate: string;
    totalValue: number;
    holdings: SecurityHolding[];
  }> {
    const response = await this.getHoldings(accountId, asOfDate);

    const totalValue = response.holdings.reduce((sum, holding) => sum + holding.currentValue, 0);

    return {
      accountId: response.accountId,
      asOfDate: response.asOfDate,
      totalValue,
      holdings: response.holdings,
    };
  }
}

// Singleton instance
let holdingsClient: HoldingsClient | null = null;

export function getHoldingsClient(): HoldingsClient {
  if (!holdingsClient) {
    holdingsClient = new HoldingsClient();
  }
  return holdingsClient;
}

/**
 * React hooks for holdings data
 */
export const useHoldingsData = {
  /**
   * Fetch holdings with error handling
   */
  async fetchHoldings(accountId: string, asOfDate?: string): Promise<HoldingsResponse | null> {
    try {
      const client = getHoldingsClient();
      return await client.getHoldings(accountId, asOfDate);
    } catch (error) {
      console.error('Failed to fetch holdings:', error);
      return null;
    }
  },

  /**
   * Fetch transactions with error handling
   */
  async fetchTransactions(
    accountId: string,
    filters?: { symbol?: string; fromDate?: string; toDate?: string }
  ): Promise<TransactionsResponse | null> {
    try {
      const client = getHoldingsClient();
      return await client.getTransactions(accountId, filters);
    } catch (error) {
      console.error('Failed to fetch transactions:', error);
      return null;
    }
  },
};