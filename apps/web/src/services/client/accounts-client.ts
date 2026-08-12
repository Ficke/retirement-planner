/**
 * Client-side HTTP service for account operations.
 * This service runs in the browser and communicates with API routes.
 */

import type {
  Account,
  CreateAccountData,
  UpdateAccountData,
} from '@/domain/types';
import { accountSchema } from '@/domain/schemas';
import { authenticatedFetch } from '@/lib/firebase/api-client';

function parseAccount(value: unknown): Account {
  const result = accountSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`Cloud account data is invalid: ${result.error.issues[0]?.message}`);
  }
  return result.data;
}

export class AccountsClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string = '/api') {
    this.baseUrl = baseUrl;
  }

  async createAccount(data: CreateAccountData, expectedUserId?: string): Promise<Account> {
    const response = await authenticatedFetch(`${this.baseUrl}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }, expectedUserId);

    if (!response.ok) {
      throw new Error(`Failed to create account: ${response.statusText}`);
    }

    return parseAccount(await response.json());
  }

  async getAccounts(expectedUserId?: string): Promise<Account[]> {
    const response = await authenticatedFetch(`${this.baseUrl}/accounts`, {}, expectedUserId);

    if (!response.ok) {
      throw new Error(`Failed to fetch accounts: ${response.statusText}`);
    }

    const body: unknown = await response.json();
    if (!Array.isArray(body)) throw new Error('Cloud account collection is invalid');
    return body.map(parseAccount);
  }

  async getAccount(id: string, expectedUserId?: string): Promise<Account | null> {
    const response = await authenticatedFetch(`${this.baseUrl}/accounts/${id}`, {}, expectedUserId);

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch account: ${response.statusText}`);
    }

    return parseAccount(await response.json());
  }

  async updateAccount(
    id: string,
    updates: UpdateAccountData,
    expectedUserId?: string,
  ): Promise<Account> {
    const response = await authenticatedFetch(`${this.baseUrl}/accounts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    }, expectedUserId);

    if (!response.ok) {
      throw new Error(`Failed to update account: ${response.statusText}`);
    }

    return parseAccount(await response.json());
  }

  async deleteAccount(id: string, expectedUserId?: string): Promise<void> {
    const response = await authenticatedFetch(`${this.baseUrl}/accounts/${id}`, {
      method: 'DELETE',
    }, expectedUserId);

    if (!response.ok) {
      throw new Error(`Failed to delete account: ${response.statusText}`);
    }
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
