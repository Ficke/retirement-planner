/**
 * Securities management service for handling transactions and calculating holdings.
 * Integrates with the individual accounts system to track securities-based positions.
 */

import type {
  AccountTransaction,
  SecurityHolding,
  SecurityPosition,
  AssetWeights,
  TransactionType,
} from '@/domain/types';
import { getSecurity, calculateEffectiveAllocation } from '@/data/securities-master';
import { getMarketDataService } from './market-data';

export interface SecuritiesService {
  // Transaction management
  addTransaction(transaction: Omit<AccountTransaction, 'id' | 'createdAt'>): Promise<AccountTransaction>;
  updateTransaction(id: string, updates: Partial<AccountTransaction>): Promise<AccountTransaction>;
  deleteTransaction(id: string): Promise<void>;
  getTransactions(accountId: string): Promise<AccountTransaction[]>;
  getTransactionsBySymbol(accountId: string, symbol: string): Promise<AccountTransaction[]>;

  // Holdings calculation
  getHoldings(accountId: string, asOfDate?: string): Promise<SecurityHolding[]>;
  getPositions(accountId: string, asOfDate?: string): Promise<SecurityPosition[]>;
  calculateTotalValue(accountId: string, asOfDate?: string): Promise<number>;

  // Asset allocation calculation
  calculateAssetWeights(accountId: string, asOfDate?: string): Promise<AssetWeights>;
  calculateDetailedAllocations(accountId: string, asOfDate?: string): Promise<{
    stocks: number;
    bonds: number;
    cash: number;
    reit: number;
    other: number;
    totalValue: number;
  }>;

  // Validation
  validateTransaction(transaction: Omit<AccountTransaction, 'id' | 'createdAt'>): { isValid: boolean; errors: string[] };
}

class SecuritiesServiceImpl implements SecuritiesService {
  private transactions: Map<string, AccountTransaction[]> = new Map();
  private nextId = 1;

  async addTransaction(transaction: Omit<AccountTransaction, 'id' | 'createdAt'>): Promise<AccountTransaction> {
    const validation = this.validateTransaction(transaction);
    if (!validation.isValid) {
      throw new Error(`Invalid transaction: ${validation.errors.join(', ')}`);
    }

    const newTransaction: AccountTransaction = {
      ...transaction,
      id: `tx_${this.nextId++}`,
      createdAt: new Date().toISOString(),
    };

    const accountTransactions = this.transactions.get(transaction.accountId) || [];
    accountTransactions.push(newTransaction);
    this.transactions.set(transaction.accountId, accountTransactions);

    return newTransaction;
  }

  async updateTransaction(id: string, updates: Partial<AccountTransaction>): Promise<AccountTransaction> {
    for (const [accountId, transactions] of this.transactions) {
      const index = transactions.findIndex(tx => tx.id === id);
      if (index !== -1) {
        const updatedTransaction = { ...transactions[index], ...updates };

        const validation = this.validateTransaction(updatedTransaction);
        if (!validation.isValid) {
          throw new Error(`Invalid transaction update: ${validation.errors.join(', ')}`);
        }

        transactions[index] = updatedTransaction;
        return updatedTransaction;
      }
    }
    throw new Error(`Transaction ${id} not found`);
  }

  async deleteTransaction(id: string): Promise<void> {
    for (const [accountId, transactions] of this.transactions) {
      const index = transactions.findIndex(tx => tx.id === id);
      if (index !== -1) {
        transactions.splice(index, 1);
        return;
      }
    }
    throw new Error(`Transaction ${id} not found`);
  }

  async getTransactions(accountId: string): Promise<AccountTransaction[]> {
    return [...(this.transactions.get(accountId) || [])].sort(
      (a, b) => new Date(b.transactionDate).getTime() - new Date(a.transactionDate).getTime()
    );
  }

  async getTransactionsBySymbol(accountId: string, symbol: string): Promise<AccountTransaction[]> {
    const transactions = await this.getTransactions(accountId);
    return transactions.filter(tx => tx.symbol.toUpperCase() === symbol.toUpperCase());
  }

  async getHoldings(accountId: string, asOfDate?: string): Promise<SecurityHolding[]> {
    const transactions = await this.getTransactions(accountId);
    const cutoffDate = asOfDate ? new Date(asOfDate) : new Date();

    // Filter transactions up to the cutoff date and sort chronologically
    const relevantTransactions = transactions
      .filter(tx => new Date(tx.transactionDate) <= cutoffDate)
      .sort((a, b) => new Date(a.transactionDate).getTime() - new Date(b.transactionDate).getTime());

    // Group by symbol and calculate net positions
    const positionMap = new Map<string, { shares: number; totalCost: number; transactions: AccountTransaction[] }>();

    for (const tx of relevantTransactions) {
      const symbol = tx.symbol.toUpperCase();
      const position = positionMap.get(symbol) || { shares: 0, totalCost: 0, transactions: [] };

      position.transactions.push(tx);

      if (tx.transactionType === 'BUY' || tx.transactionType === 'DIVIDEND_REINVEST') {
        position.shares += tx.shares;
        position.totalCost += tx.shares * (tx.pricePerShare || 0);
      } else if (tx.transactionType === 'SELL') {
        position.shares -= tx.shares;
        // For sells, reduce cost basis proportionally
        if (position.shares > 0) {
          const sellRatio = tx.shares / (position.shares + tx.shares);
          position.totalCost -= position.totalCost * sellRatio;
        }
      } else if (tx.transactionType === 'SPLIT') {
        // Assumes shares field contains the split ratio (e.g., 2 for 2:1 split)
        position.shares *= tx.shares;
        // Cost basis per share is reduced by the split ratio, but total cost basis stays the same
      }

      positionMap.set(symbol, position);
    }

    // Convert to holdings array with batch price fetching for efficiency
    const symbolsWithPositions = Array.from(positionMap.entries()).filter(([, position]) => position.shares > 0.001);
    const symbols = symbolsWithPositions.map(([symbol]) => symbol);

    // Batch fetch current market prices for all symbols
    const marketPrices = await this.getBatchCurrentPrices(symbols);

    const holdings: SecurityHolding[] = [];
    for (const [symbol, position] of symbolsWithPositions) {
      const security = getSecurity(symbol);
      if (!security) {
        console.warn(`Security ${symbol} not found in master database`);
        continue;
      }

      const averageCostBasis = position.totalCost > 0 ? position.totalCost / position.shares : undefined;

      // Use batched market price or fallback to transaction history
      const currentPrice = marketPrices[symbol] || this.getFallbackPrice(symbol, position.transactions);
      const currentValue = position.shares * currentPrice;

      holdings.push({
        accountId,
        symbol,
        totalShares: position.shares,
        averageCostBasis,
        currentValue,
        currentPrice,
        asOfDate: cutoffDate.toISOString().split('T')[0],
        security,
      });
    }

    return holdings.sort((a, b) => b.currentValue - a.currentValue);
  }

  async getPositions(accountId: string, asOfDate?: string): Promise<SecurityPosition[]> {
    const holdings = await this.getHoldings(accountId, asOfDate);

    return holdings.map(holding => ({
      symbol: holding.symbol,
      shares: holding.totalShares,
      currentValue: holding.currentValue,
      allocation: calculateEffectiveAllocation(holding.security, holding.currentValue),
      security: holding.security,
    }));
  }

  async calculateTotalValue(accountId: string, asOfDate?: string): Promise<number> {
    const holdings = await this.getHoldings(accountId, asOfDate);
    return holdings.reduce((total, holding) => total + holding.currentValue, 0);
  }

  async calculateAssetWeights(accountId: string, asOfDate?: string): Promise<AssetWeights> {
    const positions = await this.getPositions(accountId, asOfDate);
    const totalValue = positions.reduce((sum, pos) => sum + pos.currentValue, 0);

    if (totalValue === 0) {
      return { stocks: 0, bonds: 0 };
    }

    let totalStocks = 0;
    let totalBonds = 0;

    for (const position of positions) {
      totalStocks += position.allocation.stocks;
      totalBonds += position.allocation.bonds;
    }

    return {
      stocks: totalStocks / totalValue,
      bonds: totalBonds / totalValue,
    };
  }

  async calculateDetailedAllocations(accountId: string, asOfDate?: string): Promise<{
    stocks: number;
    bonds: number;
    cash: number;
    reit: number;
    other: number;
    totalValue: number;
  }> {
    const positions = await this.getPositions(accountId, asOfDate);
    const totalValue = positions.reduce((sum, pos) => sum + pos.currentValue, 0);

    const allocations = {
      stocks: 0,
      bonds: 0,
      cash: 0,
      reit: 0,
      other: 0,
      totalValue,
    };

    for (const position of positions) {
      allocations.stocks += position.allocation.stocks;
      allocations.bonds += position.allocation.bonds;
      allocations.cash += position.allocation.cash || 0;
      allocations.reit += position.allocation.reit || 0;
      allocations.other += position.allocation.other || 0;
    }

    return allocations;
  }

  /**
   * Batch fetch current market prices for multiple symbols efficiently
   */
  private async getBatchCurrentPrices(symbols: string[]): Promise<Record<string, number>> {
    if (symbols.length === 0) {
      return {};
    }

    try {
      // Note: getLatestPrices was removed - would need individual calls
      // For now, return empty object as this method isn't implemented
      const validPrices: Record<string, number> = {};
      
      // TODO: Implement with individual getPriceAtDate calls if needed
      console.warn('getLatestPrices not implemented - returning empty prices');

      return validPrices;
    } catch (error) {
      console.warn('Failed to batch fetch current market prices:', error);
      return {};
    }
  }

  /**
   * Get fallback price from transaction history or default estimates
   */
  private getFallbackPrice(symbol: string, transactions: AccountTransaction[]): number {
    // Try to get most recent transaction price
    const transactionsWithPrice = transactions
      .filter(tx => tx.pricePerShare && tx.pricePerShare > 0)
      .sort((a, b) => new Date(b.transactionDate).getTime() - new Date(a.transactionDate).getTime());

    if (transactionsWithPrice.length > 0) {
      return transactionsWithPrice[0].pricePerShare!;
    }

    // Final fallback to updated default prices (current market estimates)
    const defaultPrices: Record<string, number> = {
      'VTI': 330,   // Updated VTI price estimate
      'BND': 80,    // Updated BND price estimate
      'NTSX': 98,   // Updated NTSX price estimate
      'VOO': 460,   // Updated VOO price estimate
      'SPY': 470,   // Updated SPY price estimate
    };

    return defaultPrices[symbol.toUpperCase()] || 100;
  }

  private async getCurrentPrice(symbol: string, transactions: AccountTransaction[]): Promise<number> {
    try {
      // Note: getQuote was removed - would need getPriceAtDate with current date
      // For now, skip market price fetch and use fallback
      console.warn(`getQuote not implemented for ${symbol} - using fallback price`);
    } catch (error) {
      console.warn(`Failed to get current market price for ${symbol}:`, error);
    }

    // Fallback to transaction history or defaults
    return this.getFallbackPrice(symbol, transactions);
  }

  validateTransaction(transaction: Omit<AccountTransaction, 'id' | 'createdAt'>): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check required fields
    if (!transaction.accountId) {
      errors.push('Account ID is required');
    }
    if (!transaction.symbol) {
      errors.push('Symbol is required');
    }
    if (!transaction.transactionDate) {
      errors.push('Transaction date is required');
    }
    if (transaction.shares <= 0) {
      errors.push('Shares must be positive');
    }

    // Check security exists
    if (transaction.symbol && !getSecurity(transaction.symbol)) {
      errors.push(`Security ${transaction.symbol} not found in master database`);
    }

    // Check date is valid
    if (transaction.transactionDate) {
      const date = new Date(transaction.transactionDate);
      if (isNaN(date.getTime())) {
        errors.push('Invalid transaction date');
      }
      if (date > new Date()) {
        errors.push('Transaction date cannot be in the future');
      }
    }

    // Check transaction type specific rules
    if (transaction.transactionType === 'SELL') {
      // TODO: Check that we have enough shares to sell
      // This would require checking existing holdings
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}

// Singleton service
let securitiesService: SecuritiesService | null = null;

export function getSecuritiesService(): SecuritiesService {
  if (!securitiesService) {
    securitiesService = new SecuritiesServiceImpl();
  }
  return securitiesService;
}

// Export for testing
export { SecuritiesServiceImpl };