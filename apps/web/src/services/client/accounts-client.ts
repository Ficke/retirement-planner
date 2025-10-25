/**
 * Client-side HTTP service for account operations.
 * This service runs in the browser and communicates with API routes.
 */

import type {
  Account,
  CreateAccountData,
  AccountSnapshot,
  CreateSnapshotData,
  AccountTransaction,
  TransactionType,
} from '@/domain/types';
import { authenticatedFetch } from '@/lib/firebase/api-client';

export class AccountsClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string = '/api') {
    this.baseUrl = baseUrl;
  }

  async createAccount(data: CreateAccountData): Promise<Account> {
    const response = await authenticatedFetch(`${this.baseUrl}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`Failed to create account: ${response.statusText}`);
    }

    return response.json();
  }

  async getAccounts(): Promise<Account[]> {
    const response = await authenticatedFetch(`${this.baseUrl}/accounts`);

    if (!response.ok) {
      throw new Error(`Failed to fetch accounts: ${response.statusText}`);
    }

    return response.json();
  }

  async getAccount(id: string): Promise<Account | null> {
    const response = await authenticatedFetch(`${this.baseUrl}/accounts/${id}`);

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch account: ${response.statusText}`);
    }

    return response.json();
  }

  async updateAccount(
    id: string,
    updates: Partial<Omit<Account, 'id' | 'createdAt'>>
  ): Promise<Account> {
    const response = await authenticatedFetch(`${this.baseUrl}/accounts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      throw new Error(`Failed to update account: ${response.statusText}`);
    }

    return response.json();
  }

  async deleteAccount(id: string): Promise<void> {
    const response = await authenticatedFetch(`${this.baseUrl}/accounts/${id}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error(`Failed to delete account: ${response.statusText}`);
    }
  }

  // Snapshots operations
  async createSnapshot(
    accountId: string,
    data: Omit<CreateSnapshotData, 'accountId'>
  ): Promise<AccountSnapshot> {
    const response = await authenticatedFetch(`${this.baseUrl}/accounts/${accountId}/snapshots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`Failed to create snapshot: ${response.statusText}`);
    }

    return response.json();
  }

  async getSnapshots(accountId: string): Promise<AccountSnapshot[]> {
    const response = await authenticatedFetch(`${this.baseUrl}/accounts/${accountId}/snapshots`);

    if (!response.ok) {
      throw new Error(`Failed to fetch snapshots: ${response.statusText}`);
    }

    return response.json();
  }

  async getSnapshot(accountId: string, snapshotId: string): Promise<AccountSnapshot | null> {
    const response = await authenticatedFetch(`${this.baseUrl}/accounts/${accountId}/snapshots/${snapshotId}`);

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch snapshot: ${response.statusText}`);
    }

    return response.json();
  }

  async deleteSnapshot(accountId: string, snapshotId: string): Promise<void> {
    const response = await authenticatedFetch(`${this.baseUrl}/accounts/${accountId}/snapshots/${snapshotId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error(`Failed to delete snapshot: ${response.statusText}`);
    }
  }

  // Security Transactions operations
  async addAccountTransaction(transaction: {
    accountId: string;
    symbol: string;
    shares: number;
    transactionDate: string;
    transactionType: TransactionType;
    pricePerShare?: number;
    description?: string;
  }): Promise<AccountTransaction> {
    const response = await authenticatedFetch(`${this.baseUrl}/accounts/${transaction.accountId}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: transaction.symbol,
        shares: transaction.shares,
        transactionDate: transaction.transactionDate,
        transactionType: transaction.transactionType,
        pricePerShare: transaction.pricePerShare,
        description: transaction.description,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to add security transaction: ${response.statusText}`);
    }

    return response.json();
  }

  async getTransactions(accountId: string): Promise<AccountTransaction[]> {
    const response = await authenticatedFetch(`${this.baseUrl}/accounts/${accountId}/transactions`);

    if (!response.ok) {
      throw new Error(`Failed to fetch transactions: ${response.statusText}`);
    }

    const data = await response.json();
    return data.transactions || [];
  }

  async updateTransaction(
    accountId: string,
    transactionId: string,
    updates: Partial<Omit<AccountTransaction, 'id' | 'accountId' | 'createdAt'>>
  ): Promise<AccountTransaction> {
    const response = await authenticatedFetch(`${this.baseUrl}/accounts/${accountId}/transactions/${transactionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      throw new Error(`Failed to update transaction: ${response.statusText}`);
    }

    return response.json();
  }

  async deleteTransaction(accountId: string, transactionId: string): Promise<void> {
    const response = await authenticatedFetch(`${this.baseUrl}/accounts/${accountId}/transactions/${transactionId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error(`Failed to delete transaction: ${response.statusText}`);
    }
  }

  // Holdings operations
  async getHoldings(accountId: string, asOfDate?: string): Promise<any> {
    // Construct URL more safely to avoid parsing errors
    const path = `/accounts/${encodeURIComponent(accountId)}/holdings`;
    let url = `${this.baseUrl}${path}`;

    if (asOfDate) {
      url += `?asOfDate=${encodeURIComponent(asOfDate)}`;
    }

    const response = await authenticatedFetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch holdings: ${response.statusText}`);
    }

    return response.json();
  }
}

// Singleton instance
let accountsClient: AccountsClient | null = null;

export function getAccountsClient(): AccountsClient {
  if (!accountsClient) {
    accountsClient = new AccountsClient();
  }
  return accountsClient;
}

export function setAccountsClient(client: AccountsClient): void {
  accountsClient = client;
}

export function resetAccountsClient(): void {
  accountsClient = null;
}