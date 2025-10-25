import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/firebase/server';
import { getUnifiedDatabaseService } from '@/services/server/database';
import { transactionCacheManager } from '@/services/server/cache-invalidation';
import type { AccountTransaction, TransactionType } from '@/domain/types';

/**
 * GET /api/accounts/[id]/transactions
 * Get account transactions for an account
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: accountId } = await params;
    const { searchParams } = new URL(request.url);

    const database = getUnifiedDatabaseService();

    // Verify account belongs to user
    const account = await database.getAccount(accountId);
    if (!account || account.user_id !== user.id) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const symbol = searchParams.get('symbol');
    const fromDate = searchParams.get('fromDate');
    const toDate = searchParams.get('toDate');

    let transactions = await database.getAccountTransactions(accountId);

    // Apply filters
    if (symbol) {
      transactions = transactions.filter(t => t.symbol === symbol);
    }
    if (fromDate) {
      transactions = transactions.filter(t => t.transactionDate >= fromDate);
    }
    if (toDate) {
      transactions = transactions.filter(t => t.transactionDate <= toDate);
    }

    // Sort by date (newest first)
    transactions.sort((a, b) => new Date(b.transactionDate).getTime() - new Date(a.transactionDate).getTime());

    return NextResponse.json({
      accountId,
      filters: { symbol, fromDate, toDate },
      transactions,
      count: transactions.length,
    });
  } catch (error) {
    console.error('Transactions API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch transactions' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/accounts/[id]/transactions
 * Create a new account transaction
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: accountId } = await params;

    const database = getUnifiedDatabaseService();

    // Verify account belongs to user
    const account = await database.getAccount(accountId);
    if (!account || account.user_id !== user.id) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const transactionData = await request.json();

    // Validate required fields
    const { symbol, shares, transactionDate, transactionType } = transactionData;
    if (!symbol || shares === undefined || !transactionDate || !transactionType) {
      return NextResponse.json(
        { error: 'Missing required fields: symbol, shares, transactionDate, transactionType' },
        { status: 400 }
      );
    }

    // Validate transaction type
    const validTypes: TransactionType[] = ['BUY', 'SELL', 'SPLIT', 'DIVIDEND_REINVEST'];
    if (!validTypes.includes(transactionType)) {
      return NextResponse.json(
        { error: `Invalid transaction type. Must be one of: ${validTypes.join(', ')}` },
        { status: 400 }
      );
    }

    // Check for duplicate transaction
    const duplicate = await database.findDuplicateTransaction(
      accountId,
      symbol,
      Number(shares),
      transactionDate,
      transactionType
    );

    if (duplicate) {
      console.log('Duplicate transaction detected:', {
        existingId: duplicate.id,
        existingCreatedAt: duplicate.createdAt,
        attempted: { symbol, shares, transactionDate, transactionType }
      });
      return NextResponse.json(
        {
          error: 'Duplicate transaction detected',
          message: `A transaction with the same details already exists (created ${new Date(duplicate.createdAt).toLocaleString()})`,
          existingTransaction: duplicate
        },
        { status: 409 }
      );
    }

    // Create transaction
    const newTransaction = await database.createAccountTransaction({
      accountId,
      symbol,
      shares: Number(shares),
      transactionDate,
      transactionType,
      pricePerShare: transactionData.pricePerShare ? Number(transactionData.pricePerShare) : undefined,
      description: transactionData.description,
    });

    // If user provided a price, save it to historical_prices for future use
    if (transactionData.pricePerShare) {
      const price = Number(transactionData.pricePerShare);
      await database.insertHistoricalPrice({
        symbol: symbol.toUpperCase(),
        date: transactionDate,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 0,
        source: 'transaction', // Mark as user-provided
        fetched_at: new Date().toISOString()
      });
      console.log(`💾 Saved user-provided price for ${symbol} on ${transactionDate}: $${price}`);
    }

    // No complex cache invalidation needed - holdings calculated directly from transactions

    return NextResponse.json(newTransaction, { status: 201 });
  } catch (error) {
    console.error('Transaction creation error:', error);
    return NextResponse.json(
      { error: 'Failed to create transaction' },
      { status: 500 }
    );
  }
}