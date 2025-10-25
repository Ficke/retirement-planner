import { NextRequest, NextResponse } from 'next/server';
import { getUnifiedDatabaseService } from '@/services/server/database';
import { transactionCacheManager } from '@/services/server/cache-invalidation';
import type { TransactionType } from '@/domain/types';

/**
 * GET /api/accounts/[id]/transactions/[transactionId]
 * Get a specific account transaction
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; transactionId: string }> }
) {
  try {
    const { id: accountId, transactionId } = await params;

    const database = getUnifiedDatabaseService();
    const transactions = await database.getAccountTransactions(accountId);
    const transaction = transactions.find(t => t.id === transactionId);

    if (!transaction) {
      return NextResponse.json(
        { error: 'Transaction not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(transaction);
  } catch (error) {
    console.error('Transaction fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch transaction' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/accounts/[id]/transactions/[transactionId]
 * Update an account transaction
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; transactionId: string }> }
) {
  try {
    const { id: accountId, transactionId } = await params;
    const updates = await request.json();

    // Get the existing transaction for cache invalidation
    const database = getUnifiedDatabaseService();
    const existingTransactions = await database.getAccountTransactions(accountId);
    const oldTransaction = existingTransactions.find(t => t.id === transactionId);

    if (!oldTransaction) {
      return NextResponse.json(
        { error: 'Transaction not found' },
        { status: 404 }
      );
    }

    // Validate transaction type if provided
    if (updates.transactionType) {
      const validTypes: TransactionType[] = ['BUY', 'SELL', 'SPLIT', 'DIVIDEND_REINVEST'];
      if (!validTypes.includes(updates.transactionType)) {
        return NextResponse.json(
          { error: `Invalid transaction type. Must be one of: ${validTypes.join(', ')}` },
          { status: 400 }
        );
      }
    }

    // Convert numeric fields
    if (updates.shares !== undefined) {
      updates.shares = Number(updates.shares);
    }
    if (updates.pricePerShare !== undefined) {
      updates.pricePerShare = Number(updates.pricePerShare);
    }

    // Update transaction
    const updatedTransaction = await database.updateAccountTransaction(transactionId, updates);

    // Invalidate holdings cache
    await transactionCacheManager.handleTransactionMutation('update', updatedTransaction, oldTransaction);

    return NextResponse.json(updatedTransaction);
  } catch (error) {
    console.error('Transaction update error:', error);
    return NextResponse.json(
      { error: 'Failed to update transaction' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/accounts/[id]/transactions/[transactionId]
 * Delete an account transaction
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; transactionId: string }> }
) {
  try {
    const { id: accountId, transactionId } = await params;

    // Get the existing transaction for cache invalidation
    const database = getUnifiedDatabaseService();
    const existingTransactions = await database.getAccountTransactions(accountId);
    const transaction = existingTransactions.find(t => t.id === transactionId);

    if (!transaction) {
      return NextResponse.json(
        { error: 'Transaction not found' },
        { status: 404 }
      );
    }

    // Delete transaction
    await database.deleteAccountTransaction(transactionId);

    // Invalidate holdings cache
    await transactionCacheManager.handleTransactionMutation('delete', transaction);

    return NextResponse.json({
      message: 'Transaction deleted',
      transactionId,
      accountId,
    });
  } catch (error) {
    console.error('Transaction deletion error:', error);
    return NextResponse.json(
      { error: 'Failed to delete transaction' },
      { status: 500 }
    );
  }
}