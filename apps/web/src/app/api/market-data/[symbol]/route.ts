import { NextRequest, NextResponse } from 'next/server';
import { getMarketDataService } from '@/services/server/market-data';
import { getUnifiedDatabaseService } from '@/services/server/database';
import { getYahooFinanceService } from '@/services/server/yahoo-finance';
import { getSecurity } from '@/data/securities-master';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    const { symbol: originalSymbol } = await params;
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');

    if (!date) {
      return NextResponse.json(
        { error: 'Date parameter is required' },
        { status: 400 }
      );
    }

    // Check if this is a mutual fund
    const security = getSecurity(originalSymbol);
    const isMutualFund = security?.type === 'MUTUAL_FUND';

    // Use different pricing source based on security type
    const fetchedPrice = isMutualFund
      ? await getMutualFundPrice(originalSymbol, date)
      : await getPriceWithDatabaseFallback(originalSymbol, date);

    // Return error if no price found
    if (fetchedPrice === null) {
      return NextResponse.json(
        {
          error: 'Price not available',
          message: `No price data found for ${originalSymbol} on ${date}. Historical data may not be available for this date.`,
          symbol: originalSymbol,
          date
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      symbol: originalSymbol,
      date,
      price: fetchedPrice,
      ...(isMutualFund && security && {
        isMutualFund: true,
        securityName: security.name,
        source: 'yahoo-finance'
      })
    });
  } catch (error) {
    console.error('Market data API error:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch market data',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * Gets mutual fund NAV price using Yahoo Finance with database caching.
 *
 * @param symbol - Mutual fund symbol
 * @param date - Date string (YYYY-MM-DD)
 * @returns NAV price or null
 */
async function getMutualFundPrice(symbol: string, date: string): Promise<number | null> {
  const db = getUnifiedDatabaseService();
  const normalizedDate = new Date(date).toISOString().split('T')[0];

  // Step 1: Check database cache first
  const existingPrice = await db.getHistoricalPrice(symbol.toUpperCase(), normalizedDate);
  if (existingPrice) {
    console.log(`📊 Found cached mutual fund NAV for ${symbol} on ${date}: $${existingPrice.close}`);
    return existingPrice.close;
  }

  // Step 2: Fetch from Yahoo Finance
  try {
    const yahooFinance = getYahooFinanceService();
    const price = await yahooFinance.getPriceAtDate(symbol, new Date(date));

    if (price !== null) {
      // Step 3: Store in database for future use
      await db.insertHistoricalPrice({
        symbol: symbol.toUpperCase(),
        date: normalizedDate,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 0,
        source: 'yahoo-finance',
        fetched_at: new Date().toISOString()
      });
      console.log(`🔄 Fetched from Yahoo Finance and cached: ${symbol} on ${normalizedDate}: $${price}`);
      return price;
    }
  } catch (error) {
    console.error(`❌ Yahoo Finance fetch failed for ${symbol}:`, error);
  }

  // Step 4: Return null if no price found
  console.warn(`🚫 No mutual fund NAV found for ${symbol} on ${normalizedDate}`);
  return null;
}

/**
 * Gets price with database-first architecture:
 * 1. Check database for existing historical price
 * 2. If not found, fetch from Polygon API
 * 3. Store result in database for future use
 * 4. Return the price
 */
async function getPriceWithDatabaseFallback(symbol: string, date: string): Promise<number | null> {
  const db = getUnifiedDatabaseService();

  // Normalize date to YYYY-MM-DD format
  const normalizedDate = new Date(date).toISOString().split('T')[0];

  // Step 1: Check database first
  const existingPrice = await db.getHistoricalPrice(symbol.toUpperCase(), normalizedDate);
  if (existingPrice) {
    console.log(`📊 Found cached price for ${symbol} on ${date}: $${existingPrice.close}`);
    return existingPrice.close;
  }

  // Step 2: Try to fetch from Polygon API if available
  try {
    const apiKey = process.env.POLYGON_API_KEY;
    console.log(`🔑 DEBUG: POLYGON_API_KEY=${apiKey ? 'SET' : 'NOT SET'}, length=${apiKey?.length || 0}`);
    if (apiKey) {
      const marketData = getMarketDataService();
      const price = await marketData.getPriceAtDate(symbol, new Date(date));

      if (price !== null) {
        // Step 3: Store in database for future use
        // Since we only have the single price from the API, we'll use it for all OHLC values
        await db.insertHistoricalPrice({
          symbol: symbol.toUpperCase(),
          date: normalizedDate,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: 0, // We don't have volume data from the simple price API
          source: 'polygon',
          fetched_at: new Date().toISOString()
        });
        console.log(`🔄 Fetched from Polygon and cached: ${symbol} on ${normalizedDate}: $${price}`);
        return price;
      }
    } else {
      console.warn('⚠️  POLYGON_API_KEY not set, skipping external API fetch');
    }
  } catch (error) {
    console.error('❌ Polygon API fetch failed:', error);
    // Continue to fallback options below
  }

  // Step 4: Return null if no price found anywhere
  console.warn(`🚫 No price found for ${symbol} on ${normalizedDate}`);
  return null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    const { symbol: originalSymbol } = await params;
    const { date } = await request.json();

    if (!date) {
      return NextResponse.json(
        { error: 'Date is required' },
        { status: 400 }
      );
    }

    // Check if this is a mutual fund
    const security = getSecurity(originalSymbol);
    const isMutualFund = security?.type === 'MUTUAL_FUND';

    // Use different pricing source based on security type
    const fetchedPrice = isMutualFund
      ? await getMutualFundPrice(originalSymbol, date)
      : await getPriceWithDatabaseFallback(originalSymbol, date);

    // Return error if no price found
    if (fetchedPrice === null) {
      return NextResponse.json(
        {
          error: 'Price not available',
          message: `No price data found for ${originalSymbol} on ${date}. Historical data may not be available for this date.`,
          symbol: originalSymbol,
          date
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      symbol: originalSymbol,
      date,
      price: fetchedPrice,
      ...(isMutualFund && security && {
        isMutualFund: true,
        securityName: security.name,
        source: 'yahoo-finance'
      })
    }, { status: 201 });
  } catch (error) {
    console.error('Market data fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch market data' },
      { status: 500 }
    );
  }
}