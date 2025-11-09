import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/firebase/server';
import { getSecurity } from '@/data/securities-master';
import { getMarketDataService } from '@/services/server/market-data';
import { getYahooFinanceService } from '@/services/server/yahoo-finance';
import { getUnifiedDatabaseService } from '@/services/server/database';
import { getMostRecentBusinessDay } from '@/lib/utils';
import type { Security } from '@/domain/types';

// Price fetching with proper routing to Polygon or Yahoo Finance
// Returns cached price immediately, optionally triggers background refresh
async function getPrice(symbol: string, allowBackgroundRefresh = false): Promise<number | null> {
  try {
    const priceDate = getMostRecentBusinessDay();
    const dateString = priceDate.toISOString().split('T')[0];

    // Always check database first
    const db = getUnifiedDatabaseService();
    const dbPrice = await db.getHistoricalPrice(symbol, dateString);

    if (dbPrice) {
      console.log(`📊 Found ${symbol} price for ${dateString} in database: $${dbPrice.close}`);

      // Check if price is stale (older than 24 hours)
      if (allowBackgroundRefresh) {
        const age = Date.now() - new Date(dbPrice.fetched_at).getTime();
        const STALE_THRESHOLD = 24 * 60 * 60 * 1000;

        if (age > STALE_THRESHOLD) {
          // Trigger background refresh (don't await)
          refreshPriceInBackground(symbol, priceDate, dateString).catch(err => {
            console.warn(`Background refresh failed for ${symbol}:`, err);
          });
        }
      }

      return dbPrice.close;
    }

    // No cached price - try to fetch with timeout
    const security = getSecurity(symbol);
    const isMutualFund = security?.type === 'MUTUAL_FUND';

    if (isMutualFund) {
      console.log(`🔍 Fetching ${symbol} (mutual fund) from Yahoo Finance...`);
      const yahooFinance = getYahooFinanceService();
      const price = await Promise.race([
        yahooFinance.getPriceAtDate(symbol, priceDate),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000))
      ]);

      if (price) {
        await db.insertHistoricalPrice({
          symbol: symbol.toUpperCase(),
          date: dateString,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: 0,
          source: 'yahoo-finance',
          fetched_at: new Date().toISOString()
        });
      }

      return price;
    } else {
      console.log(`🔍 Fetching ${symbol} (ETF/stock) from Polygon...`);
      const marketData = getMarketDataService();
      const price = await Promise.race([
        marketData.getPriceAtDate(symbol, priceDate),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000))
      ]);
      return price;
    }
  } catch (error) {
    console.warn(`Error fetching price for ${symbol}:`, error);
    return null;
  }
}

// Background refresh - never blocks the response
async function refreshPriceInBackground(symbol: string, priceDate: Date, dateString: string) {
  const db = getUnifiedDatabaseService();
  const security = getSecurity(symbol);
  const isMutualFund = security?.type === 'MUTUAL_FUND';

  if (isMutualFund) {
    const yahooFinance = getYahooFinanceService();
    const price = await yahooFinance.getPriceAtDate(symbol, priceDate);

    if (price) {
      await db.insertHistoricalPrice({
        symbol: symbol.toUpperCase(),
        date: dateString,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 0,
        source: 'yahoo-finance',
        fetched_at: new Date().toISOString()
      });
      console.log(`🔄 Background refresh complete for ${symbol}: $${price}`);
    }
  } else {
    const marketData = getMarketDataService();
    await marketData.getPriceAtDate(symbol, priceDate);
    console.log(`🔄 Background refresh complete for ${symbol}`);
  }
}

/**
 * GET /api/accounts/[id]/holdings
 * Simplified holdings calculation with direct SQL
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
    console.log(`🚀 Getting holdings for account ${accountId} (simplified)`);

    const db = getUnifiedDatabaseService();

    // Verify account belongs to user (using same pattern as accounts API)
    const accountCheckResult = await db.query(`
      SELECT a.id FROM accounts a
      JOIN users u ON a.user_id = u.id
      WHERE a.id = $1 AND u.firebase_uid = $2
    `, [accountId, user.id]);
    
    if (accountCheckResult.rows.length === 0) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    // Direct SQL query to calculate holdings from transactions
    const holdingsQuery = `
      SELECT
        symbol,
        SUM(CASE
          WHEN transaction_type IN ('BUY', 'DIVIDEND_REINVEST') THEN shares
          WHEN transaction_type = 'SELL' THEN -shares
          WHEN transaction_type = 'SPLIT' THEN shares * price_per_share - shares
          ELSE 0
        END) as total_shares,
        SUM(CASE
          WHEN transaction_type IN ('BUY', 'DIVIDEND_REINVEST') THEN shares * price_per_share
          WHEN transaction_type = 'SELL' THEN 0
          ELSE 0
        END) / NULLIF(SUM(CASE
          WHEN transaction_type IN ('BUY', 'DIVIDEND_REINVEST') THEN shares
          ELSE 0
        END), 0) as average_cost_basis
      FROM account_transactions
      WHERE account_id = $1
      GROUP BY symbol
      HAVING SUM(CASE
        WHEN transaction_type IN ('BUY', 'DIVIDEND_REINVEST') THEN shares
        WHEN transaction_type = 'SELL' THEN -shares
        WHEN transaction_type = 'SPLIT' THEN shares * price_per_share - shares
        ELSE 0
      END) > 0
    `;

    const result = await db.query(holdingsQuery, [accountId]);
    console.log(`💎 Found ${result.rows.length} holdings from direct SQL query`);

    // Fetch prices - prioritize cached data, allow background refresh
    // Process all symbols with aggressive timeout to prevent hanging
    const REQUEST_TIMEOUT = 10000; // 10 second max for entire request
    const startTime = Date.now();

    const holdings = await Promise.race([
      Promise.all(
        result.rows.map(async (row) => {
          const currentPrice = await getPrice(row.symbol, true); // Enable background refresh
          const totalShares = parseFloat(row.total_shares);
          const averageCostBasis = parseFloat(row.average_cost_basis || '0');

          // Get security metadata from securities master
          const securityMetadata = getSecurity(row.symbol);
          const security: Security = securityMetadata || {
            symbol: row.symbol,
            name: row.symbol,
            type: 'ETF' as const,
            assetClass: 'STOCK' as const,
            riskMultiplier: 1.0,
            underlyingAllocations: { stocks: 1.0, bonds: 0.0 },
          };

          return {
            symbol: row.symbol,
            totalShares,
            averageCostBasis,
            currentPrice: currentPrice ?? null,
            currentValue: currentPrice ? totalShares * currentPrice : null,
            asOfDate: new Date().toISOString().split('T')[0],
            security,
          };
        })
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout')), REQUEST_TIMEOUT)
      )
    ]).catch(error => {
      console.warn('⚠️  Holdings request timed out, returning partial data');
      // Return whatever we have so far
      return result.rows.map(row => ({
        symbol: row.symbol,
        totalShares: parseFloat(row.total_shares),
        averageCostBasis: parseFloat(row.average_cost_basis || '0'),
        currentPrice: null,
        currentValue: null,
        asOfDate: new Date().toISOString().split('T')[0],
        security: getSecurity(row.symbol) || {
          symbol: row.symbol,
          name: row.symbol,
          type: 'ETF' as const,
          assetClass: 'STOCK' as const,
          riskMultiplier: 1.0,
          underlyingAllocations: { stocks: 1.0, bonds: 0.0 },
        },
      }));
    });

    const totalValue = holdings.reduce((sum, holding) => sum + (holding.currentValue || 0), 0);
    console.log(`🎯 Portfolio value: $${totalValue.toLocaleString()}`);

    return NextResponse.json({
      accountId,
      asOfDate: new Date().toISOString().split('T')[0],
      holdings,
      totalValue,
      calculationMethod: 'direct_sql',
    });

  } catch (error) {
    console.error('Holdings API error:', error);
    return NextResponse.json(
      { error: 'Failed to calculate holdings', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

